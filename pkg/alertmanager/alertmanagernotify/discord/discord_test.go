// Copyright (c) 2026 SigNoz, Inc.
// Copyright 2021 Prometheus Team
// SPDX-License-Identifier: Apache-2.0

package discord

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/SigNoz/signoz/pkg/alertmanager/alertmanagertemplate"
	"github.com/SigNoz/signoz/pkg/types/alertmanagertypes"
	"github.com/SigNoz/signoz/pkg/types/ruletypes"
	commoncfg "github.com/prometheus/common/config"
	"github.com/prometheus/common/model"
	"github.com/prometheus/common/promslog"
	"github.com/stretchr/testify/require"

	test "github.com/SigNoz/signoz/pkg/alertmanager/alertmanagernotify/alertmanagernotifytest"
	"github.com/prometheus/alertmanager/config"
	"github.com/prometheus/alertmanager/notify"
	"github.com/prometheus/alertmanager/template"
	"github.com/prometheus/alertmanager/types"
)

func newTestTemplater(tmpl *template.Template) alertmanagertypes.Templater {
	return alertmanagertemplate.New(tmpl, slog.New(slog.DiscardHandler))
}

var testWebhookURL, _ = url.Parse("https://discord.com/api/webhooks/000000000000000000/dummy_token")

func TestDiscordRetry(t *testing.T) {
	tmpl := test.CreateTmpl(t)
	notifier, err := New(
		&config.DiscordConfig{
			WebhookURL: &config.SecretURL{URL: testWebhookURL},
			HTTPConfig: &commoncfg.HTTPClientConfig{},
		},
		tmpl,
		promslog.NewNopLogger(),
		newTestTemplater(tmpl),
	)
	require.NoError(t, err)

	for statusCode, expected := range test.RetryTests(test.DefaultRetryCodes()) {
		actual, _ := notifier.retrier.Check(statusCode, nil)
		require.Equal(t, expected, actual, "retry - error on status %d", statusCode)
	}
}

func TestNotifier_Notify_WithReason(t *testing.T) {
	tests := []struct {
		name            string
		statusCode      int
		responseContent string
		expectedReason  notify.Reason
		noError         bool
	}{
		{
			name:            "with a 2xx status code and response 1",
			statusCode:      http.StatusNoContent,
			responseContent: "",
			noError:         true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tmpl := test.CreateTmpl(t)
			notifier, err := New(
				&config.DiscordConfig{
					WebhookURL: &config.SecretURL{URL: testWebhookURL},
					HTTPConfig: &commoncfg.HTTPClientConfig{},
				},
				tmpl,
				promslog.NewNopLogger(),
				newTestTemplater(tmpl),
			)
			require.NoError(t, err)

			notifier.postJSONFunc = func(ctx context.Context, client *http.Client, url string, body io.Reader) (*http.Response, error) {
				resp := httptest.NewRecorder()
				_, err := resp.WriteString(tt.responseContent)
				require.NoError(t, err)
				resp.WriteHeader(tt.statusCode)
				return resp.Result(), nil
			}
			ctx := context.Background()
			ctx = notify.WithGroupKey(ctx, "1")

			alert1 := &types.Alert{
				Alert: model.Alert{
					StartsAt: time.Now(),
					EndsAt:   time.Now().Add(time.Hour),
				},
			}
			_, err = notifier.Notify(ctx, alert1)
			if tt.noError {
				require.NoError(t, err)
			} else {
				var reasonError *notify.ErrorWithReason
				require.ErrorAs(t, err, &reasonError)
				require.Equal(t, tt.expectedReason, reasonError.Reason)
			}
		})
	}
}

func TestDiscordTemplating(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		dec := json.NewDecoder(r.Body)
		out := make(map[string]any)
		err := dec.Decode(&out)
		if err != nil {
			panic(err)
		}
	}))
	defer srv.Close()
	u, _ := url.Parse(srv.URL)

	for _, tc := range []struct {
		title  string
		cfg    *config.DiscordConfig
		retry  bool
		errMsg string
	}{
		{
			title: "full-blown message",
			cfg: &config.DiscordConfig{
				Title:   `{{ template "discord.default.title" . }}`,
				Message: `{{ template "discord.default.message" . }}`,
			},
			retry: false,
		},
		{
			title: "title with templating errors",
			cfg: &config.DiscordConfig{
				Title: "{{ ",
			},
			errMsg: "template: :1: unclosed action",
		},
	} {
		t.Run(tc.title, func(t *testing.T) {
			tc.cfg.WebhookURL = &config.SecretURL{URL: u}
			tc.cfg.HTTPConfig = &commoncfg.HTTPClientConfig{}
			tmpl := test.CreateTmpl(t)
			pd, err := New(tc.cfg, tmpl, promslog.NewNopLogger(), newTestTemplater(tmpl))
			require.NoError(t, err)

			ctx := context.Background()
			ctx = notify.WithGroupKey(ctx, "1")

			ok, err := pd.Notify(ctx, []*types.Alert{
				{
					Alert: model.Alert{
						Labels: model.LabelSet{
							"lbl1": "val1",
						},
						StartsAt: time.Now(),
						EndsAt:   time.Now().Add(time.Hour),
					},
				},
			}...)
			if tc.errMsg == "" {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
				require.Contains(t, err.Error(), tc.errMsg)
			}
			require.Equal(t, tc.retry, ok)
		})
	}
}

func TestDiscordRedactedURL(t *testing.T) {
	ctx, u, fn := test.GetContextWithCancelingURL()
	defer fn()

	secret := "secret"
	tmpl := test.CreateTmpl(t)
	notifier, err := New(
		&config.DiscordConfig{
			WebhookURL: &config.SecretURL{URL: u},
			HTTPConfig: &commoncfg.HTTPClientConfig{},
		},
		tmpl,
		promslog.NewNopLogger(),
		newTestTemplater(tmpl),
	)
	require.NoError(t, err)

	test.AssertNotifyLeaksNoSecret(ctx, t, notifier, secret)
}

func TestPrepareContent(t *testing.T) {
	t.Run("default template - firing alerts", func(t *testing.T) {
		tmpl := test.CreateTmpl(t)
		notifier, err := New(
			&config.DiscordConfig{
				WebhookURL: &config.SecretURL{URL: testWebhookURL},
				HTTPConfig: &commoncfg.HTTPClientConfig{},
				Title:      "Alertname: {{ .CommonLabels.alertname }}",
				Message:    "Default message: {{ .CommonLabels.alertname }}",
			},
			tmpl,
			promslog.NewNopLogger(),
			newTestTemplater(tmpl),
		)
		require.NoError(t, err)

		ctx := context.Background()

		alerts := []*types.Alert{
			{
				Alert: model.Alert{
					Labels: model.LabelSet{"alertname": "test"},
					StartsAt: time.Now(),
					EndsAt:   time.Now().Add(time.Hour),
				},
			},
		}
		payload, color, err := notifier.prepareContent(ctx, alerts, func(s string) string { return s })
		require.NoError(t, err)
		require.NotNil(t, payload)
		// Firing alert → red color for the title embed.
		require.Equal(t, colorRed, color)
		// Single embed with title + description (default body path).
		require.Len(t, payload.Embeds, 1)
		require.Equal(t, "Alertname: test", payload.Embeds[0].Title)
		require.Equal(t, "Default message: test", payload.Embeds[0].Description)
	})

	t.Run("custom template - per-alert color", func(t *testing.T) {
		tmpl := test.CreateTmpl(t)
		notifier, err := New(
			&config.DiscordConfig{
				WebhookURL: &config.SecretURL{URL: testWebhookURL},
				HTTPConfig: &commoncfg.HTTPClientConfig{},
			},
			tmpl,
			promslog.NewNopLogger(),
			newTestTemplater(tmpl),
		)
		require.NoError(t, err)

		ctx := context.Background()

		alerts := []*types.Alert{
			{
				Alert: model.Alert{
					Labels: model.LabelSet{"alertname": "test1"},
					Annotations: model.LabelSet{
						"summary":                         "test",
						ruletypes.AnnotationTitleTemplate: "Custom Title",
						ruletypes.AnnotationBodyTemplate:  "custom body $alertname",
					},
					StartsAt: time.Now(),
					EndsAt:   time.Now().Add(time.Hour),
				},
			},
			{
				Alert: model.Alert{
					Labels: model.LabelSet{"alertname": "test2"},
					Annotations: model.LabelSet{
						"summary":                         "test",
						ruletypes.AnnotationTitleTemplate: "Custom Title",
						ruletypes.AnnotationBodyTemplate:  "custom body $alertname",
					},
					StartsAt: time.Now().Add(-time.Hour),
					EndsAt:   time.Now().Add(-time.Minute),
				},
			},
		}
		payload, color, err := notifier.prepareContent(ctx, alerts, func(s string) string { return s })
		require.NoError(t, err)
		require.NotNil(t, payload)
		// Overall status of mixed alerts (one firing, one resolved) is "firing"
		// (alertmanager treats any firing alert as firing).
		require.Equal(t, colorRed, color)
		// 3 embeds: title + 2 body embeds (one per alert).
		require.Len(t, payload.Embeds, 3)
		require.Equal(t, "Custom Title", payload.Embeds[0].Title)
		require.Equal(t, "custom body test1", payload.Embeds[1].Description)
		require.Equal(t, colorRed, payload.Embeds[1].Color)
		require.Equal(t, "custom body test2", payload.Embeds[2].Description)
		require.Equal(t, colorGreen, payload.Embeds[2].Color)
	})
}

func TestDiscordReadingURLFromFile(t *testing.T) {
	ctx, u, fn := test.GetContextWithCancelingURL()
	defer fn()

	f, err := os.CreateTemp("", "webhook_url")
	require.NoError(t, err, "creating temp file failed")
	_, err = f.WriteString(u.String() + "\n")
	require.NoError(t, err, "writing to temp file failed")

	tmpl := test.CreateTmpl(t)
	notifier, err := New(
		&config.DiscordConfig{
			WebhookURLFile: f.Name(),
			HTTPConfig:     &commoncfg.HTTPClientConfig{},
		},
		tmpl,
		promslog.NewNopLogger(),
		newTestTemplater(tmpl),
	)
	require.NoError(t, err)

	test.AssertNotifyLeaksNoSecret(ctx, t, notifier, u.String())
}