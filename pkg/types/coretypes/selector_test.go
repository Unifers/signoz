package coretypes

import (
	"context"
	"net/http/httptest"
	"testing"

	"github.com/SigNoz/signoz/pkg/valuer"
)

func TestProjectLogTypeSelector_Valid(t *testing.T) {
	cases := []struct {
		id           string
		wantComposed string
		resource     Resource
	}{
		{"frontend-app:logs:application", "frontend-app/application", ResourceTelemetryResourceLogs},
		{"frontend-app:traces:audit", "frontend-app/audit", ResourceTelemetryResourceTraces},
		{"backend-svc:metrics:system", "backend-svc/system", ResourceTelemetryResourceMetrics},
		{"frontend-app:logs:access", "frontend-app/access", ResourceTelemetryResourceLogs},
	}
	for _, c := range cases {
		t.Run(c.id, func(t *testing.T) {
			got, err := ProjectLogTypeSelector(
				context.Background(),
				c.resource,
				c.id,
				valuer.GenerateUUID(),
			)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(got) != 2 {
				t.Fatalf("expected 2 selectors, got %d", len(got))
			}
			if got[0].String() != c.wantComposed {
				t.Errorf("expected first selector %q, got %q", c.wantComposed, got[0].String())
			}
			if got[1].String() != WildCardSelectorString {
				t.Errorf("expected wildcard fallback, got %q", got[1].String())
			}
		})
	}
}

func TestProjectLogTypeSelector_RejectsEmpty(t *testing.T) {
	_, err := ProjectLogTypeSelector(
		context.Background(),
		ResourceTelemetryResourceLogs,
		"",
		valuer.GenerateUUID(),
	)
	if err == nil {
		t.Error("expected error for empty id")
	}
}

func TestProjectLogTypeSelector_RejectsMalformed(t *testing.T) {
	cases := []string{
		"only-project",
		":missing-project",
		"missing-suffix:",
		"no-colon-here",
		"a:b",                       // only two segments
		"frontend-app:logs:",        // empty log type
		":logs:application",         // empty project slug
		"frontend-app::application", // empty signal
	}
	for _, c := range cases {
		t.Run(c, func(t *testing.T) {
			_, err := ProjectLogTypeSelector(
				context.Background(),
				ResourceTelemetryResourceLogs,
				c,
				valuer.GenerateUUID(),
			)
			if err == nil {
				t.Errorf("expected error for %q", c)
			}
		})
	}
}

func TestProjectLogTypeSelector_RejectsInvalidProjectID(t *testing.T) {
	// Uppercase is not allowed by IsValidProjectID.
	_, err := ProjectLogTypeSelector(
		context.Background(),
		ResourceTelemetryResourceLogs,
		"Bad-ID:logs:application",
		valuer.GenerateUUID(),
	)
	if err == nil {
		t.Error("expected error for invalid project id")
	}
}

func TestProjectLogTypeSelector_RejectsInvalidLogType(t *testing.T) {
	// "not-a-real-log-type" is not in the hard-coded allowlist.
	_, err := ProjectLogTypeSelector(
		context.Background(),
		ResourceTelemetryResourceLogs,
		"frontend-app:logs:not-a-real-log-type",
		valuer.GenerateUUID(),
	)
	if err == nil {
		t.Error("expected error for invalid log type")
	}
}

func TestTypeTelemetryResource_Selector_AcceptsProjectID(t *testing.T) {
	// The widened regex on TypeTelemetryResource accepts:
	//   - "*" (admin / role wildcard)
	//   - "<slug>/<logType>" (per-(project, logType) — strictest scoping)
	// Bare "<slug>" is no longer accepted at the type level — per-(project,
	// logType) checks must use the composed form via ProjectLogTypeSelector.
	_, err := TypeTelemetryResource.Selector(WildCardSelectorString)
	if err != nil {
		t.Errorf("expected wildcard to be accepted, got %v", err)
	}
	_, err = TypeTelemetryResource.Selector("frontend-app/application")
	if err != nil {
		t.Errorf("expected composed selector to be accepted, got %v", err)
	}
	_, err = TypeTelemetryResource.Selector("Bad-ID")
	if err == nil {
		t.Error("expected invalid id to be rejected")
	}

	composedValid := []string{
		"frontend-app/application",
		"frontend-app/system",
		"frontend-app/audit",
		"frontend-app/access",
		"backend-svc/application",
	}
	for _, s := range composedValid {
		t.Run(s, func(t *testing.T) {
			if _, err := TypeTelemetryResource.Selector(s); err != nil {
				t.Errorf("expected composed selector %q to be accepted, got %v", s, err)
			}
		})
	}

	composedInvalid := []string{
		"frontend-app",          // bare slug — deprecated, must compose with log type
		"frontend-app/",         // empty log type
		"frontend-app/INVALID",  // upper-case log type
		"Bad-ID/application",    // upper-case project slug
		"/application",          // empty project slug
		"frontend-app/audit/v2", // extra path segment
	}
	for _, s := range composedInvalid {
		t.Run(s, func(t *testing.T) {
			if _, err := TypeTelemetryResource.Selector(s); err == nil {
				t.Errorf("expected composed selector %q to be rejected", s)
			}
		})
	}
}

func TestResourceForSignal(t *testing.T) {
	tests := []struct {
		signal string
		want   Resource
	}{
		{"logs", ResourceTelemetryResourceLogs},
		{"traces", ResourceTelemetryResourceTraces},
		{"metrics", ResourceTelemetryResourceMetrics},
	}
	for _, tt := range tests {
		t.Run(tt.signal, func(t *testing.T) {
			got, err := ResourceForSignal(tt.signal)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Errorf("got %v, want %v", got, tt.want)
			}
		})
	}
	_, err := ResourceForSignal("unknown")
	if err == nil {
		t.Error("expected error for unknown signal")
	}
}

func TestHeaderExtractor(t *testing.T) {
	req := httptest.NewRequest("GET", "/x", nil)
	req.Header.Set("X-Signoz-Project", "frontend-app")

	got, ok := HeaderExtractor("X-Signoz-Project").RunFor(PhaseRequest, ExtractorContext{Request: req})
	if !ok {
		t.Error("expected ok")
	}
	if got != "frontend-app" {
		t.Errorf("expected 'frontend-app', got %q", got)
	}

	missing, ok := HeaderExtractor("X-Does-Not-Exist").RunFor(PhaseRequest, ExtractorContext{Request: req})
	if !ok {
		t.Error("expected ok for missing header")
	}
	if missing != "" {
		t.Errorf("expected empty for missing header, got %q", missing)
	}
}

func TestQueryParamExtractor(t *testing.T) {
	req := httptest.NewRequest("GET", "/x?logType=application", nil)

	got, ok := QueryParamExtractor("logType").RunFor(PhaseRequest, ExtractorContext{Request: req})
	if !ok {
		t.Error("expected ok")
	}
	if got != "application" {
		t.Errorf("expected 'application', got %q", got)
	}
}
