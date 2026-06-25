package coretypes

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/SigNoz/signoz/pkg/errors"
	"github.com/SigNoz/signoz/pkg/types"
	"github.com/SigNoz/signoz/pkg/valuer"
)

const (
	WildCardSelectorString string = "*"
)

var errCodeInvalidResourceID = errors.MustNewCode("invalid_resource_id")

var WildcardSelector SelectorFunc = func(_ context.Context, resource Resource, _ string, _ valuer.UUID) ([]Selector, error) {
	return []Selector{resource.Type().MustSelector(WildCardSelectorString)}, nil
}

var IDSelector SelectorFunc = func(_ context.Context, resource Resource, id string, _ valuer.UUID) ([]Selector, error) {
	if id == "" {
		return nil, errors.Newf(
			errors.TypeInvalidInput,
			errCodeInvalidResourceID,
			"resource id is required for %s",
			resource.Kind().String(),
		)
	}

	selector, err := resource.Type().Selector(id)
	if err != nil {
		return nil, err
	}

	return []Selector{selector, resource.Type().MustSelector(WildCardSelectorString)}, nil
}

// ProjectLogTypeSelector resolves a "<projectSlug>:<signal>:<logType>" id
// into per-(project, logType) FGA selectors plus the wildcard fallback.
// Used to gate telemetryresource reads by (project, signal, logType) on v5
// query endpoints. The composed selector format is "<projectSlug>/<logType>";
// the signal segment is required so each (signal, logType) combination is
// independently grantable.
//
// Both returned selectors are evaluated — access is granted if either
// matches an existing tuple. The wildcard fallback covers admin role
// tuples (role:org/<org>/role/signoz-admin#assignee#read@telemetryresource:
// org/<org>/<signal>/*) which still use the bare "*" form.
var ProjectLogTypeSelector SelectorFunc = func(_ context.Context, resource Resource, id string, _ valuer.UUID) ([]Selector, error) {
	if id == "" {
		return nil, errors.Newf(
			errors.TypeInvalidInput,
			errCodeInvalidResourceID,
			"resource id is required for %s",
			resource.Kind().String(),
		)
	}

	parts := strings.SplitN(id, ":", 3)
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return nil, errors.Newf(
			errors.TypeInvalidInput,
			errCodeInvalidResourceID,
			"resource id %q is not a valid project:signal:logType tuple",
			id,
		)
	}

	projectSlug, logType := parts[0], parts[2]
	if !types.IsValidProjectID(projectSlug) || !types.IsValidProjectLogType(logType) {
		return nil, errors.Newf(
			errors.TypeInvalidInput,
			errCodeInvalidResourceID,
			"resource id %q contains invalid project slug or log type",
			id,
		)
	}

	composed := projectSlug + "/" + logType
	composedSelector, err := resource.Type().Selector(composed)
	if err != nil {
		return nil, err
	}

	return []Selector{composedSelector, resource.Type().MustSelector(WildCardSelectorString)}, nil
}

type Selector struct {
	val string
}

// SelectorFunc maps a resolved id (+ its resource) to authz FGA selectors.
type SelectorFunc func(ctx context.Context, resource Resource, id string, orgID valuer.UUID) ([]Selector, error)

func (selector *Selector) MarshalJSON() ([]byte, error) {
	return json.Marshal(selector.val)
}

func (selector Selector) String() string {
	return selector.val
}

func (typed *Selector) UnmarshalJSON(data []byte) error {
	str := ""
	err := json.Unmarshal(data, &str)
	if err != nil {
		return err
	}

	alias := Selector{val: str}
	*typed = alias

	return nil
}

func (selector Selector) MarshalText() ([]byte, error) {
	return []byte(selector.val), nil
}

func (selector *Selector) UnmarshalText(text []byte) error {
	*selector = Selector{val: string(text)}
	return nil
}
