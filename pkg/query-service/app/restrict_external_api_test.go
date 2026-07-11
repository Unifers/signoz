package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/SigNoz/signoz/pkg/modules/user"
	"github.com/SigNoz/signoz/pkg/signoz"
	"github.com/SigNoz/signoz/pkg/types/authtypes"
	"github.com/SigNoz/signoz/pkg/types/telemetrytypes"
	"github.com/SigNoz/signoz/pkg/valuer"

	qbtypes "github.com/SigNoz/signoz/pkg/types/querybuildertypes/querybuildertypesv5"
)

type mockUserGetter struct {
	user.Getter
	roles []*authtypes.UserRole
}

func (m *mockUserGetter) GetRolesByUserID(ctx context.Context, userID valuer.UUID) ([]*authtypes.UserRole, error) {
	return m.roles, nil
}

func mustUUID(t *testing.T, s string) valuer.UUID {
	t.Helper()
	id, err := valuer.NewUUID(s)
	if err != nil {
		t.Fatalf("invalid uuid %q: %v", s, err)
	}
	return id
}

func TestRestrictExternalApiQuery(t *testing.T) {
	userIDStr := "00000000-0000-0000-0000-000000000002"
	orgIDStr := "00000000-0000-0000-0000-000000000001"
	ctx := authtypes.NewContextWithClaims(context.Background(), authtypes.Claims{
		UserID: userIDStr,
		OrgID:  orgIDStr,
	})

	meta := authtypes.SignozMetadata{
		ProjectPermissions: []authtypes.ProjectPermissionRecord{
			{Project: "traky-api", APM: "read", Traces: "read", Logs: "read", Alerts: "write", ExternalApi: "none"},
			{Project: "billing", APM: "read", Traces: "read", Logs: "read", Alerts: "write", ExternalApi: "read"},
		},
	}
	metaBytes, _ := json.Marshal(meta)
	customRole := &authtypes.Role{
		Name:        "traky-api-role",
		Description: "role desc [signoz_metadata:" + string(metaBytes) + "]",
		Type:        authtypes.RoleTypeCustom,
		OrgID:       mustUUID(t, orgIDStr),
	}

	userRole := &authtypes.UserRole{
		UserID: mustUUID(t, userIDStr),
		RoleID: customRole.ID,
		Role:   customRole,
	}

	mockGetter := &mockUserGetter{
		roles: []*authtypes.UserRole{userRole},
	}

	aH := &APIHandler{
		Signoz: &signoz.SigNoz{
			Modules: signoz.Modules{
				UserGetter: mockGetter,
			},
		},
	}

	// Create a dummy QueryRangeRequest representing domain listing query
	req := &qbtypes.QueryRangeRequest{
		CompositeQuery: qbtypes.CompositeQuery{
			Queries: []qbtypes.QueryEnvelope{
				{
					Type: qbtypes.QueryTypeBuilder,
					Spec: qbtypes.QueryBuilderQuery[qbtypes.TraceAggregation]{
						Name:   "endpoints",
						Signal: telemetrytypes.SignalTraces,
						Filter: &qbtypes.Filter{Expression: "http_url EXISTS"},
					},
				},
			},
		},
	}

	err := aH.restrictExternalApiQuery(ctx, req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify that the filter is updated
	q := req.CompositeQuery.Queries[0]
	spec, ok := q.Spec.(qbtypes.QueryBuilderQuery[qbtypes.TraceAggregation])
	if !ok {
		t.Fatalf("unexpected spec type: %T", q.Spec)
	}

	if spec.Filter == nil {
		t.Fatalf("expected filter to be set")
	}

	expected := "service.name = 'billing'"
	if !strings.Contains(spec.Filter.Expression, expected) {
		t.Fatalf("expected expression to contain %q, got %q", expected, spec.Filter.Expression)
	}

	t.Logf("Updated filter expression: %s", spec.Filter.Expression)
}
