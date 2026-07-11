// Copyright (c) 2026 SigNoz, Inc.
// Copyright 2021 Prometheus Team
// SPDX-License-Identifier: Apache-2.0

package discord

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/SigNoz/signoz/pkg/alertmanager/alertmanagertemplate"
	"github.com/SigNoz/signoz/pkg/errors"
	"github.com/SigNoz/signoz/pkg/types/alertmanagertypes"
	commoncfg "github.com/prometheus/common/config"
	"github.com/prometheus/common/model"

	"github.com/prometheus/alertmanager/config"
	"github.com/prometheus/alertmanager/notify"
	"github.com/prometheus/alertmanager/template"
	"github.com/prometheus/alertmanager/types"
)

const (
	// https://discord.com/developers/docs/resources/channel#embed-object-embed-limits - 256 characters or runes.
	maxTitleLenRunes = 256
	// https://discord.com/developers/docs/resources/channel#embed-object-embed-limits - 4096 characters or runes.
	maxDescriptionLenRunes = 4096

	maxContentLenRunes = 2000
)

const (
	colorRed   = 0x992D22
	colorGreen = 0x2ECC71
	colorGrey  = 0x95A5A6
)

const Integration = "discord"

// Notifier implements a Notifier for Discord notifications.
type Notifier struct {
	conf         *config.DiscordConfig
	tmpl         *template.Template
	logger       *slog.Logger
	client       *http.Client
	retrier      *notify.Retrier
	webhookURL   *config.SecretURL
	postJSONFunc func(ctx context.Context, client *http.Client, url string, body io.Reader) (*http.Response, error)
	templater    alertmanagertypes.Templater
}

// discordWebhook is the request body posted to a Discord webhook URL.
// https://discord.com/developers/docs/resources/webhook#execute-webhook
type discordWebhook struct {
	Content   string         `json:"content,omitempty"`
	Username  string         `json:"username,omitempty"`
	AvatarURL string         `json:"avatar_url,omitempty"`
	Embeds    []discordEmbed `json:"embeds"`
}

type discordEmbed struct {
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	Color       int    `json:"color"`
}

// New returns a new Discord notification handler wired into the SigNoz
// templater so user-authored title/body annotations override defaults.
func New(c *config.DiscordConfig, t *template.Template, l *slog.Logger, templater alertmanagertypes.Templater, httpOpts ...commoncfg.HTTPClientOption) (*Notifier, error) {
	client, err := notify.NewClientWithTracing(*c.HTTPConfig, Integration, httpOpts...)
	if err != nil {
		return nil, err
	}

	return &Notifier{
		conf:         c,
		tmpl:         t,
		logger:       l,
		client:       client,
		retrier:      &notify.Retrier{},
		webhookURL:   c.WebhookURL,
		postJSONFunc: notify.PostJSON,
		templater:    templater,
	}, nil
}

// Notify implements the Notifier interface.
func (n *Notifier) Notify(ctx context.Context, as ...*types.Alert) (bool, error) {
	key, err := notify.ExtractGroupKey(ctx)
	if err != nil {
		return false, err
	}
	n.logger.DebugContext(ctx, "extracted group key", slog.Any("group_key", key))

	var (
		data     = notify.GetTemplateData(ctx, n.tmpl, as, n.logger)
		tmplText = notify.TmplText(n.tmpl, data, &err)
	)
	if err != nil {
		return false, err
	}

	payload, color, err := n.prepareContent(ctx, as, tmplText)
	if err != nil {
		n.logger.ErrorContext(ctx, "failed to prepare discord notification content", errors.Attr(err))
		return false, err
	}

	// Resolve webhook URL: prefer WebhookURL, fall back to WebhookURLFile.
	var webhookURL string
	if n.conf.WebhookURL != nil {
		webhookURL = n.conf.WebhookURL.String()
	} else {
		content, err := os.ReadFile(n.conf.WebhookURLFile)
		if err != nil {
			return false, errors.WrapInternalf(err, errors.CodeInternal, "read webhook_url_file")
		}
		webhookURL = strings.TrimSpace(string(content))
	}

	if n.conf.AvatarURL != "" {
		if _, err := url.Parse(tmplText(n.conf.AvatarURL)); err != nil {
			n.logger.WarnContext(ctx, "bad avatar url, dropping", slog.Any("group_key", key))
			payload.AvatarURL = ""
		} else {
			payload.AvatarURL = tmplText(n.conf.AvatarURL)
		}
	}

	// Apply per-alert / overall color to embeds. prepareContent seeds the
	// title embed with the overall status color so a mixed firing+resolved
	// group renders the title in the dominant color while per-alert body
	// embeds retain their own color.
	for i := range payload.Embeds {
		// First embed is the title — keep the overall color chosen in prepareContent.
		// Other embeds already carry their per-alert color baked in.
		if i == 0 {
			payload.Embeds[i].Color = color
		}
	}

	payload.Username = tmplText(n.conf.Username)

	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(payload); err != nil {
		return false, err
	}

	resp, err := n.postJSONFunc(ctx, n.client, webhookURL, &buf) //nolint:bodyclose
	if err != nil {
		return true, notify.RedactURL(err)
	}
	defer notify.Drain(resp)

	shouldRetry, err := n.retrier.Check(resp.StatusCode, resp.Body)
	if err != nil {
		return shouldRetry, notify.NewErrorWithReason(notify.GetFailureReasonFromStatusCode(resp.StatusCode), err)
	}
	return shouldRetry, nil
}

// prepareContent renders templates and builds the Discord webhook payload
// (content + embeds). The returned color is the overall status color used
// for the title embed.
func (n *Notifier) prepareContent(ctx context.Context, alerts []*types.Alert, tmplText func(string) string) (*discordWebhook, int, error) {
	customTitle, customBody := alertmanagertemplate.ExtractTemplatesFromAnnotations(alerts)
	result, err := n.templater.Expand(ctx, alertmanagertypes.ExpandRequest{
		TitleTemplate:        customTitle,
		BodyTemplate:         customBody,
		DefaultTitleTemplate: n.conf.Title,
		DefaultBodyTemplate:  n.conf.Message,
	}, alerts)
	if err != nil {
		return nil, colorGrey, err
	}

	title, truncated := notify.TruncateInRunes(result.Title, maxTitleLenRunes)
	if truncated {
		n.logger.WarnContext(ctx, "truncated discord title", slog.Int("max_runes", maxTitleLenRunes))
	}

	content, truncated := notify.TruncateInRunes(tmplText(n.conf.Content), maxContentLenRunes)
	if truncated {
		n.logger.WarnContext(ctx, "truncated discord content", slog.Int("max_runes", maxContentLenRunes))
	}

	overallColor := colorGrey
	switch types.Alerts(alerts...).Status() {
	case model.AlertFiring:
		overallColor = colorRed
	case model.AlertResolved:
		overallColor = colorGreen
	}

	payload := &discordWebhook{
		Content: content,
	}

	if result.IsDefaultBody {
		// Default body: render the aggregated message body once into a
		// single embed whose description is the default Body[0].
		description, truncated := notify.TruncateInRunes(result.Body[0], maxDescriptionLenRunes)
		if truncated {
			n.logger.WarnContext(ctx, "truncated discord description", slog.Int("max_runes", maxDescriptionLenRunes))
		}
		payload.Embeds = []discordEmbed{
			{
				Title:       title,
				Description: description,
			},
		}
		return payload, overallColor, nil
	}

	// Custom body: title-only embed + one body embed per non-empty entry.
	payload.Embeds = []discordEmbed{
		{Title: title},
	}
	for i, body := range result.Body {
		if body == "" || i >= len(alerts) {
			continue
		}
		perAlertColor := colorRed
		if alerts[i].Resolved() {
			perAlertColor = colorGreen
		}
		description, truncated := notify.TruncateInRunes(body, maxDescriptionLenRunes)
		if truncated {
			n.logger.WarnContext(ctx, "truncated discord description", slog.Int("max_runes", maxDescriptionLenRunes))
		}
		payload.Embeds = append(payload.Embeds, discordEmbed{
			Description: description,
			Color:       perAlertColor,
		})
	}
	return payload, overallColor, nil
}
