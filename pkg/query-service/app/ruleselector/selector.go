// Package ruleselector extracts service names from alerting rules so callers
// can enforce per-service access control on alert CRUD endpoints.
//
// A rule may declare the services it is scoped to explicitly via the
// `serviceNames` field on PostableRule, in which case that list is
// authoritative. Otherwise the package falls back to the legacy convention
// of `service.name = '...'` inside the composite-query filter expression.
package ruleselector

import (
	"regexp"

	"github.com/SigNoz/signoz/pkg/types/ruletypes"
)

// serviceNameRegex matches the three literal forms of `service.name` that
// appear in SigNoz rule filter expressions:
//
//	service.name = 'foo'
//	service.name IN ['foo', 'bar']
//	service.name CONTAINS 'foo'
//
// Quoted values may use single or double quotes. The trailing
// `(?:\s*,|\s*\]|$)` is intentionally absent — we rely on the closing quote to
// terminate the match, since service names themselves never contain quotes.
var serviceNameRegex = regexp.MustCompile(`service\.name\s*(?:=|IN|CONTAINS)\s*(?:\[\s*)?['"]([^'"]+)['"]`)

// ServicesFromRulePostable returns the unique set of service names the rule
// is scoped to. The explicit ServiceNames field on the rule is authoritative
// when present; otherwise the function falls back to walking the rule's
// composite-query filter expressions and pulling out any `service.name = '...'`
// references. An empty result means the rule is service-agnostic — callers
// should treat that as a stricter case (the rule has no service boundary and
// may fan out across every service).
func ServicesFromRulePostable(rule *ruletypes.PostableRule) []string {
	if rule == nil {
		return nil
	}
	seen := map[string]struct{}{}
	out := make([]string, 0)
	add := func(name string) {
		if name == "" {
			return
		}
		if _, ok := seen[name]; ok {
			return
		}
		seen[name] = struct{}{}
		out = append(out, name)
	}
	if len(rule.ServiceNames) > 0 {
		for _, s := range rule.ServiceNames {
			add(s)
		}
		return out
	}
	if rule.RuleCondition == nil || rule.RuleCondition.CompositeQuery == nil {
		return nil
	}
	for i := range rule.RuleCondition.CompositeQuery.Queries {
		q := &rule.RuleCondition.CompositeQuery.Queries[i]
		if f := q.GetFilter(); f != nil && f.Expression != "" {
			for _, m := range serviceNameRegex.FindAllStringSubmatch(f.Expression, -1) {
				add(m[1])
			}
		}
	}
	return out
}
