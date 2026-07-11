package ruleselector

import (
	"reflect"
	"testing"

	qbtypes "github.com/SigNoz/signoz/pkg/types/querybuildertypes/querybuildertypesv5"
	"github.com/SigNoz/signoz/pkg/types/ruletypes"
	"github.com/SigNoz/signoz/pkg/types/telemetrytypes"
)

func TestServicesFromRulePostable(t *testing.T) {
	mkRule := func(specs ...any) *ruletypes.PostableRule {
		queries := make([]qbtypes.QueryEnvelope, 0, len(specs))
		for _, s := range specs {
			queries = append(queries, qbtypes.QueryEnvelope{Type: qbtypes.QueryTypeBuilder, Spec: s})
		}
		return &ruletypes.PostableRule{
			RuleCondition: &ruletypes.RuleCondition{
				CompositeQuery: &ruletypes.AlertCompositeQuery{Queries: queries},
			},
		}
	}

	mkSpec := func(expr string) qbtypes.QueryBuilderQuery[qbtypes.MetricAggregation] {
		return qbtypes.QueryBuilderQuery[qbtypes.MetricAggregation]{
			Name:     "A",
			Signal:   telemetrytypes.SignalMetrics,
			Filter:   &qbtypes.Filter{Expression: expr},
			Disabled: false,
		}
	}

	t.Run("nil rule returns nil", func(t *testing.T) {
		if got := ServicesFromRulePostable(nil); got != nil {
			t.Fatalf("expected nil, got %v", got)
		}
	})

	t.Run("nil condition returns nil", func(t *testing.T) {
		rule := &ruletypes.PostableRule{}
		if got := ServicesFromRulePostable(rule); got != nil {
			t.Fatalf("expected nil, got %v", got)
		}
	})

	t.Run("nil composite query returns nil", func(t *testing.T) {
		rule := &ruletypes.PostableRule{RuleCondition: &ruletypes.RuleCondition{}}
		if got := ServicesFromRulePostable(rule); got != nil {
			t.Fatalf("expected nil, got %v", got)
		}
	})

	t.Run("service.name = 'foo'", func(t *testing.T) {
		rule := mkRule(mkSpec(`service.name = 'payments-api'`))
		got := ServicesFromRulePostable(rule)
		if !reflect.DeepEqual(got, []string{"payments-api"}) {
			t.Fatalf("expected [payments-api], got %v", got)
		}
	})

	t.Run("service.name IN [...] captures first value only by current regex", func(t *testing.T) {
		// The regex picks up the first quoted value after `IN`. Document
		// the current behavior so a future tightening (multi-service IN)
		// is a deliberate change.
		rule := mkRule(mkSpec(`service.name IN ['payments-api', 'billing']`))
		got := ServicesFromRulePostable(rule)
		if len(got) == 0 || got[0] != "payments-api" {
			t.Fatalf("expected [payments-api], got %v", got)
		}
	})

	t.Run("service.name CONTAINS 'foo'", func(t *testing.T) {
		rule := mkRule(mkSpec(`service.name CONTAINS 'auth'`))
		got := ServicesFromRulePostable(rule)
		if !reflect.DeepEqual(got, []string{"auth"}) {
			t.Fatalf("expected [auth], got %v", got)
		}
	})

	t.Run("no service.name references returns empty (service-agnostic)", func(t *testing.T) {
		rule := mkRule(mkSpec(`http.status_code = 500`))
		got := ServicesFromRulePostable(rule)
		if len(got) != 0 {
			t.Fatalf("service-agnostic rule should return empty, got %v", got)
		}
	})

	t.Run("multiple queries collect unique services", func(t *testing.T) {
		rule := mkRule(
			mkSpec(`service.name = 'payments-api'`),
			mkSpec(`service.name = 'payments-api'`), // duplicate
			mkSpec(`service.name = 'billing'`),
		)
		got := ServicesFromRulePostable(rule)
		want := []string{"payments-api", "billing"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("expected %v, got %v", want, got)
		}
	})

	t.Run("double-quoted value is captured", func(t *testing.T) {
		rule := mkRule(mkSpec(`service.name = "payments-api"`))
		got := ServicesFromRulePostable(rule)
		if !reflect.DeepEqual(got, []string{"payments-api"}) {
			t.Fatalf("expected [payments-api], got %v", got)
		}
	})

	t.Run("non-builder query shape returns empty (no crash)", func(t *testing.T) {
		// PromQuery has no .Filter field via GetFilter; GetFilter returns nil.
		rule := mkRule(qbtypes.PromQuery{Query: "up{service.name=\"foo\"}"})
		got := ServicesFromRulePostable(rule)
		if len(got) != 0 {
			t.Fatalf("non-builder shape should produce no services (regex only runs on Filter.Expression), got %v", got)
		}
	})

	t.Run("explicit ServiceNames takes precedence over filter expression", func(t *testing.T) {
		// Even when the filter clearly references `payments-api`, an explicit
		// declaration of `traky-api` must win.
		rule := mkRule(mkSpec(`service.name = 'payments-api'`))
		rule.ServiceNames = []string{"traky-api"}
		got := ServicesFromRulePostable(rule)
		if !reflect.DeepEqual(got, []string{"traky-api"}) {
			t.Fatalf("expected [traky-api], got %v", got)
		}
	})

	t.Run("explicit ServiceNames works when filter has no service.name clause", func(t *testing.T) {
		// A metric alert on http.status_code = 500 with no service filter,
		// but the user explicitly scoped it to `traky-api` for access control.
		rule := mkRule(mkSpec(`http.status_code = 500`))
		rule.ServiceNames = []string{"traky-api"}
		got := ServicesFromRulePostable(rule)
		if !reflect.DeepEqual(got, []string{"traky-api"}) {
			t.Fatalf("expected [traky-api], got %v", got)
		}
	})

	t.Run("explicit ServiceNames deduplicates and ignores empties", func(t *testing.T) {
		rule := mkRule(mkSpec(`service.name = 'ignored'`))
		rule.ServiceNames = []string{"traky-api", "traky-api", "", "payments-api"}
		got := ServicesFromRulePostable(rule)
		if !reflect.DeepEqual(got, []string{"traky-api", "payments-api"}) {
			t.Fatalf("expected [traky-api payments-api], got %v", got)
		}
	})

	t.Run("empty ServiceNames falls back to regex path", func(t *testing.T) {
		// Legacy rules created before this field existed.
		rule := mkRule(mkSpec(`service.name = 'payments-api'`))
		rule.ServiceNames = []string{}
		got := ServicesFromRulePostable(rule)
		if !reflect.DeepEqual(got, []string{"payments-api"}) {
			t.Fatalf("expected fallback to [payments-api], got %v", got)
		}
	})

	t.Run("empty ServiceNames and no service filter yields service-agnostic", func(t *testing.T) {
		// No explicit declaration AND no service.name in filter → empty.
		rule := mkRule(mkSpec(`http.status_code = 500`))
		rule.ServiceNames = []string{}
		got := ServicesFromRulePostable(rule)
		if len(got) != 0 {
			t.Fatalf("expected empty (service-agnostic), got %v", got)
		}
	})
}
