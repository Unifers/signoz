package ruleselector

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"

	"github.com/gorilla/mux"

	"github.com/SigNoz/signoz/pkg/errors"
	"github.com/SigNoz/signoz/pkg/http/render"
	"github.com/SigNoz/signoz/pkg/modules/user"
	"github.com/SigNoz/signoz/pkg/types/authtypes"
	"github.com/SigNoz/signoz/pkg/types/ruletypes"
	"github.com/SigNoz/signoz/pkg/valuer"
)

// RuleGetter is the narrow contract EnforceServiceAccess needs from the rule
// manager. The production ruler.Ruler satisfies it.
type RuleGetter interface {
	GetRule(ctx context.Context, id valuer.UUID) (*ruletypes.GettableRule, error)
}

// EnforceServiceAccess returns middleware that gates a rule-mutating endpoint
// on whether the caller's project permissions cover the services the rule is
// scoped to. It supports two request shapes:
//
//  1. Routes with an {id} path param: the rule is fetched from RuleGetter and
//     its services are inspected.
//  2. Body-driven routes (POST /rules and POST /testRule): the request body
//     is unmarshalled into a PostableRule and inspected. The body is restored
//     for the inner handler.
//
// Unrestricted users (managed roles, "All Services" record) always pass
// through. Service-agnostic rules (no service.name references) are denied
// unless the caller has the "All Services" escape hatch.
func EnforceServiceAccess(rules RuleGetter, users user.Getter) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()

			allowed, err := authtypes.GetUserAllowedProjects(ctx, users)
			if err != nil {
				render.Error(w, err)
				return
			}
			if allowed.Unrestricted {
				next(w, r)
				return
			}

			services, err := servicesFromRequest(ctx, rules, r)
			if err != nil {
				render.Error(w, err)
				return
			}
			if len(services) == 0 {
				// Service-agnostic rules are only allowed for users with
				// the "All Services" escape hatch.
				if allowed.Includes(authtypes.AllProjectsMarker) {
					next(w, r)
					return
				}
				render.Error(w, errors.NewForbiddenf(errors.CodeForbidden,
					"rule is not scoped to any specific service"))
				return
			}
			for _, s := range services {
				if allowed.Includes(s) {
					next(w, r)
					return
				}
			}
			render.Error(w, errors.NewForbiddenf(errors.CodeForbidden,
				"user does not have access to services referenced by rule: %v", services))
		}
	}
}

// servicesFromRequest inspects the rule referenced by the request and
// returns the set of services it is scoped to. For body-driven requests, the
// body is replaced with a fresh reader that the inner handler can still read.
func servicesFromRequest(ctx context.Context, rules RuleGetter, r *http.Request) ([]string, error) {
	if id := mux.Vars(r)["id"]; id != "" {
		ruleID, err := valuer.NewUUID(id)
		if err != nil {
			return nil, errors.NewInvalidInputf(errors.CodeInvalidInput, "invalid rule id: %s", id)
		}
		g, err := rules.GetRule(ctx, ruleID)
		if err != nil {
			return nil, err
		}
		return ServicesFromRulePostable(&g.PostableRule), nil
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, errors.NewInvalidInputf(errors.CodeInvalidInput, "failed to read request body: %v", err)
	}
	r.Body = io.NopCloser(bytes.NewReader(body))

	// A non-rule body (e.g. POST /testRule with a different shape) is not our
	// concern; fall through and let the inner handler produce the parse
	// error. Returning an empty list is fine — the caller treats it as
	// service-agnostic and will deny unless the user has All Services.
	var p ruletypes.PostableRule
	if err := json.Unmarshal(body, &p); err != nil {
		return nil, nil
	}
	return ServicesFromRulePostable(&p), nil
}