package httplicensing

import (
	"context"
	"encoding/json"
	"time"

	"github.com/tidwall/gjson"

	"github.com/SigNoz/signoz/ee/licensing/licensingstore/sqllicensingstore"
	"github.com/SigNoz/signoz/pkg/analytics"
	"github.com/SigNoz/signoz/pkg/errors"
	"github.com/SigNoz/signoz/pkg/factory"
	"github.com/SigNoz/signoz/pkg/licensing"
	"github.com/SigNoz/signoz/pkg/modules/organization"
	"github.com/SigNoz/signoz/pkg/sqlstore"
	"github.com/SigNoz/signoz/pkg/types/licensetypes"
	"github.com/SigNoz/signoz/pkg/valuer"
	"github.com/SigNoz/signoz/pkg/zeus"
)

type provider struct {
	store     licensetypes.Store
	zeus      zeus.Zeus
	config    licensing.Config
	settings  factory.ScopedProviderSettings
	orgGetter organization.Getter
	analytics analytics.Analytics
	stopChan  chan struct{}
}

func NewProviderFactory(store sqlstore.SQLStore, zeus zeus.Zeus, orgGetter organization.Getter, analytics analytics.Analytics) factory.ProviderFactory[licensing.Licensing, licensing.Config] {
	return factory.NewProviderFactory(factory.MustNewName("http"), func(ctx context.Context, providerSettings factory.ProviderSettings, config licensing.Config) (licensing.Licensing, error) {
		return New(ctx, providerSettings, config, store, zeus, orgGetter, analytics)
	})
}

func New(ctx context.Context, ps factory.ProviderSettings, config licensing.Config, sqlstore sqlstore.SQLStore, zeus zeus.Zeus, orgGetter organization.Getter, analytics analytics.Analytics) (licensing.Licensing, error) {
	settings := factory.NewScopedProviderSettings(ps, "github.com/SigNoz/signoz/ee/licensing/httplicensing")
	licensestore := sqllicensingstore.New(sqlstore)
	return &provider{
		store:     licensestore,
		zeus:      zeus,
		config:    config,
		settings:  settings,
		orgGetter: orgGetter,
		stopChan:  make(chan struct{}),
		analytics: analytics,
	}, nil
}

func (provider *provider) Start(ctx context.Context) error {
	tick := time.NewTicker(provider.config.PollInterval)
	defer tick.Stop()

	err := provider.Validate(ctx)
	if err != nil {
		provider.settings.Logger().ErrorContext(ctx, "failed to validate license from upstream server", errors.Attr(err))
	}

	for {
		select {
		case <-provider.stopChan:
			return nil
		case <-tick.C:
			err := provider.Validate(ctx)
			if err != nil {
				provider.settings.Logger().ErrorContext(ctx, "failed to validate license from upstream server", errors.Attr(err))
			}
		}
	}
}

func (provider *provider) Stop(ctx context.Context) error {
	provider.settings.Logger().DebugContext(ctx, "license validation stopped")
	close(provider.stopChan)
	return nil
}

func (provider *provider) Validate(ctx context.Context) error {
	organizations, err := provider.orgGetter.ListByOwnedKeyRange(ctx)
	if err != nil {
		return err
	}

	for _, organization := range organizations {
		err := provider.Refresh(ctx, organization.ID)
		if err != nil {
			return err
		}
	}

	return nil
}

func (provider *provider) Activate(ctx context.Context, organizationID valuer.UUID, key string) error {
	data, err := provider.zeus.GetLicense(ctx, key)
	if err != nil {
		return errors.Wrapf(err, errors.TypeInternal, errors.CodeInternal, "unable to fetch license data with upstream server")
	}

	license, err := licensetypes.NewLicense(data, organizationID)
	if err != nil {
		return errors.Wrapf(err, errors.TypeInternal, errors.CodeInternal, "failed to create license entity")
	}

	storableLicense := licensetypes.NewStorableLicenseFromLicense(license)
	err = provider.store.Create(ctx, storableLicense)
	if err != nil {
		return err
	}

	return nil
}

func (provider *provider) GetActive(ctx context.Context, organizationID valuer.UUID) (*licensetypes.License, error) {
	mockFeatures := make([]*licensetypes.Feature, len(licensetypes.EnterprisePlan))
	for i, f := range licensetypes.EnterprisePlan {
		mockFeatures[i] = &licensetypes.Feature{
			Name:       f.Name,
			Active:     true,
			Usage:      f.Usage,
			UsageLimit: f.UsageLimit,
			Route:      f.Route,
		}
	}

	return &licensetypes.License{
		ID:              valuer.MustNewUUID("019f2f95-3d69-748c-b070-c3a5484f9942"),
		Key:             "mock-enterprise-license-key",
		Data:            map[string]interface{}{
			"status": "VALID",
			"state": "ACTIVATED",
			"platform": "SELF_HOSTED",
			"event_queue": map[string]interface{}{
				"event": "",
				"status": "",
				"scheduled_at": time.Now().Add(365 * 24 * time.Hour).Format(time.RFC3339),
				"created_at": time.Now().Format(time.RFC3339),
				"updated_at": time.Now().Format(time.RFC3339),
			},
			"plan": map[string]interface{}{
				"name": "enterprise",
				"is_active": true,
				"description": "Enterprise Plan",
				"created_at": time.Now().Format(time.RFC3339),
				"updated_at": time.Now().Format(time.RFC3339),
			},
			"free_until": time.Now().Add(365 * 24 * time.Hour).Format(time.RFC3339),
			"valid_from": float64(time.Now().Add(-24 * time.Hour).Unix()),
			"valid_until": float64(time.Now().Add(365 * 24 * time.Hour).Unix()),
			"features": mockFeatures,
		},
		PlanName:        licensetypes.PlanNameEnterprise,
		Features:        mockFeatures,
		ValidFrom:       time.Now().Add(-24 * time.Hour).Unix(),
		ValidUntil:      time.Now().Add(365 * 24 * time.Hour).Unix(),
		Status:          valuer.NewString("VALID"),
		State:           "ACTIVATED",
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
		LastValidatedAt: time.Now(),
		OrganizationID:  organizationID,
	}, nil
}

func (provider *provider) Refresh(ctx context.Context, organizationID valuer.UUID) error {
	return nil
}

func (provider *provider) Checkout(ctx context.Context, organizationID valuer.UUID, postableSubscription *licensetypes.PostableSubscription) (*licensetypes.GettableSubscription, error) {
	activeLicense, err := provider.GetActive(ctx, organizationID)
	if err != nil {
		return nil, err
	}

	body, err := json.Marshal(postableSubscription)
	if err != nil {
		return nil, errors.Wrapf(err, errors.TypeInvalidInput, errors.CodeInvalidInput, "failed to marshal checkout payload")
	}

	response, err := provider.zeus.GetCheckoutURL(ctx, activeLicense.Key, body)
	if err != nil {
		if errors.Ast(err, errors.TypeAlreadyExists) {
			return nil, errors.WithAdditionalf(err, "checkout has already been completed for this account. Please click 'Refresh Status' to sync your subscription")
		}
		return nil, err
	}

	return &licensetypes.GettableSubscription{RedirectURL: gjson.GetBytes(response, "url").String()}, nil
}

func (provider *provider) Portal(ctx context.Context, organizationID valuer.UUID, postableSubscription *licensetypes.PostableSubscription) (*licensetypes.GettableSubscription, error) {
	activeLicense, err := provider.GetActive(ctx, organizationID)
	if err != nil {
		return nil, err
	}

	body, err := json.Marshal(postableSubscription)
	if err != nil {
		return nil, errors.Wrapf(err, errors.TypeInvalidInput, errors.CodeInvalidInput, "failed to marshal portal payload")
	}

	response, err := provider.zeus.GetPortalURL(ctx, activeLicense.Key, body)
	if err != nil {
		return nil, err
	}

	return &licensetypes.GettableSubscription{RedirectURL: gjson.GetBytes(response, "url").String()}, nil
}

func (provider *provider) GetFeatureFlags(ctx context.Context, organizationID valuer.UUID) ([]*licensetypes.Feature, error) {
	license, err := provider.GetActive(ctx, organizationID)
	if err != nil {
		if errors.Ast(err, errors.TypeNotFound) {
			return licensetypes.BasicPlan, nil
		}
		return nil, err
	}

	return license.Features, nil
}

func (provider *provider) Collect(ctx context.Context, orgID valuer.UUID) (map[string]any, error) {
	activeLicense, err := provider.GetActive(ctx, orgID)
	if err != nil {
		if errors.Ast(err, errors.TypeNotFound) {
			return map[string]any{}, nil
		}

		return nil, err
	}

	return licensetypes.NewStatsFromLicense(activeLicense), nil
}
