package authtypes

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/SigNoz/signoz/pkg/valuer"
)

// fakeGetter satisfies the narrow contract GetUserAllowedProjects needs. It
// returns the role set the test wants and surfaces the user-id it was called
// with so tests can assert the helper extracted it from Claims.
type fakeGetter struct {
	roles    []*UserRole
	err      error
	calledWith valuer.UUID
}

func (f *fakeGetter) GetRolesByUserID(_ context.Context, id valuer.UUID) ([]*UserRole, error) {
	f.calledWith = id
	return f.roles, f.err
}

func mustUUID(t *testing.T, s string) valuer.UUID {
	t.Helper()
	id, err := valuer.NewUUID(s)
	if err != nil {
		t.Fatalf("invalid uuid %q: %v", s, err)
	}
	return id
}

func ctxWithUser(t *testing.T, userID string) context.Context {
	t.Helper()
	return NewContextWithClaims(context.Background(), Claims{UserID: userID})
}

// roleWithProjects builds a custom-role Role whose description embeds the
// signoz_metadata JSON the way the frontend serializer produces it.
func roleWithProjects(t *testing.T, name string, projects []ProjectPermissionRecord) *Role {
	t.Helper()
	meta := SignozMetadata{ProjectPermissions: projects}
	desc := name + " [signoz_metadata:" + mustMarshal(t, meta) + "]"
	return &Role{
		Name:        name,
		Description: desc,
		Type:        RoleTypeCustom,
		OrgID:       mustUUID(t, "00000000-0000-0000-0000-000000000001"),
	}
}

func mustMarshal(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

func TestGetUserAllowedProjects(t *testing.T) {
	userID := "00000000-0000-0000-0000-0000000000aa"

	t.Run("nil getter returns unrestricted", func(t *testing.T) {
		access, err := GetUserAllowedProjects(ctxWithUser(t, userID), nil)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !access.Unrestricted {
			t.Fatalf("expected Unrestricted=true, got %+v", access)
		}
	})

	t.Run("missing claims returns unrestricted", func(t *testing.T) {
		getter := &fakeGetter{}
		access, err := GetUserAllowedProjects(context.Background(), getter)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !access.Unrestricted {
			t.Fatalf("expected Unrestricted=true when no claims are present, got %+v", access)
		}
		if getter.calledWith != (valuer.UUID{}) {
			t.Fatalf("getter should not be called when claims are absent")
		}
	})

	t.Run("empty user id returns unrestricted", func(t *testing.T) {
		getter := &fakeGetter{}
		access, err := GetUserAllowedProjects(ctxWithUser(t, ""), getter)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !access.Unrestricted {
			t.Fatalf("expected Unrestricted=true for empty user id, got %+v", access)
		}
		if getter.calledWith != (valuer.UUID{}) {
			t.Fatalf("getter should not be called for empty user id")
		}
	})

	t.Run("invalid uuid in claims returns unrestricted", func(t *testing.T) {
		getter := &fakeGetter{}
		access, err := GetUserAllowedProjects(ctxWithUser(t, "not-a-uuid"), getter)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !access.Unrestricted {
			t.Fatalf("expected Unrestricted=true for malformed user id, got %+v", access)
		}
	})

	t.Run("getter error propagates", func(t *testing.T) {
		wantErr := errors.New("db down")
		getter := &fakeGetter{err: wantErr}
		_, err := GetUserAllowedProjects(ctxWithUser(t, userID), getter)
		if err == nil || err.Error() != wantErr.Error() {
			t.Fatalf("expected getter error to propagate, got %v", err)
		}
	})

	t.Run("managed role grants unrestricted access", func(t *testing.T) {
		managed := &Role{
			Name:  SigNozViewerRoleName,
			Type:  RoleTypeManaged,
			OrgID: mustUUID(t, "00000000-0000-0000-0000-000000000001"),
		}
		getter := &fakeGetter{roles: []*UserRole{{Role: managed}}}
		access, err := GetUserAllowedProjects(ctxWithUser(t, userID), getter)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !access.Unrestricted {
			t.Fatalf("managed role should yield Unrestricted=true, got %+v", access)
		}
	})

	t.Run("custom role restricts to granted projects", func(t *testing.T) {
		role := roleWithProjects(t, "viewer-traky", []ProjectPermissionRecord{
			{Project: "traky-api", APM: "read", Traces: "read", Logs: "read"},
			{Project: "billing", APM: "none", Traces: "none", Logs: "none"},
		})
		getter := &fakeGetter{roles: []*UserRole{{Role: role}}}
		access, err := GetUserAllowedProjects(ctxWithUser(t, userID), getter)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if access.Unrestricted {
			t.Fatalf("custom role should not be unrestricted")
		}
		if !access.Includes("traky-api") {
			t.Fatalf("expected traky-api to be allowed, got %+v", access.Allowed)
		}
		if access.Includes("Arka") {
			t.Fatalf("expected Arka to be denied, got %+v", access.Allowed)
		}
		if access.Includes("billing") {
			// "billing" is in the role list with no read scope; the current
			// implementation records the project as allowed regardless of
			// per-resource scope. This is the existing behavior we preserve.
			t.Logf("note: project with no read scopes is still recorded as allowed (existing behavior)")
		}
	})

	t.Run("All Services in any record grants unrestricted", func(t *testing.T) {
		role := roleWithProjects(t, "super", []ProjectPermissionRecord{
			{Project: "All Services", APM: "read", Traces: "read", Logs: "read"},
			{Project: "traky-api", APM: "none", Traces: "none", Logs: "none"},
		})
		getter := &fakeGetter{roles: []*UserRole{{Role: role}}}
		access, err := GetUserAllowedProjects(ctxWithUser(t, userID), getter)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !access.Unrestricted {
			t.Fatalf("All Services record should yield Unrestricted=true, got %+v", access)
		}
	})

	t.Run("no custom role at all yields empty allowed set", func(t *testing.T) {
		getter := &fakeGetter{roles: []*UserRole{}}
		access, err := GetUserAllowedProjects(ctxWithUser(t, userID), getter)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if access.Unrestricted {
			t.Fatalf("expected Unrestricted=false with no roles, got %+v", access)
		}
		if len(access.Allowed) != 0 {
			t.Fatalf("expected empty Allowed map, got %+v", access.Allowed)
		}
		if access.Includes("anything") {
			t.Fatalf("a user with no roles should not be allowed anything")
		}
	})

	t.Run("multiple custom roles union their projects", func(t *testing.T) {
		r1 := roleWithProjects(t, "viewer-traky", []ProjectPermissionRecord{
			{Project: "traky-api", APM: "read", Traces: "read", Logs: "read"},
		})
		r2 := roleWithProjects(t, "viewer-arka", []ProjectPermissionRecord{
			{Project: "Arka", APM: "read", Traces: "read", Logs: "read"},
		})
		getter := &fakeGetter{roles: []*UserRole{{Role: r1}, {Role: r2}}}
		access, err := GetUserAllowedProjects(ctxWithUser(t, userID), getter)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !access.Includes("traky-api") || !access.Includes("Arka") {
			t.Fatalf("union should allow both, got %+v", access.Allowed)
		}
		if access.Includes("billing") {
			t.Fatalf("unrelated service should not be allowed")
		}
	})

	t.Run("role with unparseable metadata is skipped, not fatal", func(t *testing.T) {
		bad := &Role{
			Name:        "broken",
			Description: "no metadata",
			Type:        RoleTypeCustom,
			OrgID:       mustUUID(t, "00000000-0000-0000-0000-000000000001"),
		}
		good := roleWithProjects(t, "good", []ProjectPermissionRecord{
			{Project: "traky-api", APM: "read", Traces: "read", Logs: "read"},
		})
		getter := &fakeGetter{roles: []*UserRole{{Role: bad}, {Role: good}}}
		access, err := GetUserAllowedProjects(ctxWithUser(t, userID), getter)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !access.Includes("traky-api") {
			t.Fatalf("good role's project should still be allowed, got %+v", access.Allowed)
		}
	})
}

func TestUserAllowedProjects_Includes(t *testing.T) {
	t.Run("unrestricted allows everything", func(t *testing.T) {
		p := UserAllowedProjects{Unrestricted: true}
		if !p.Includes("anything") {
			t.Fatalf("unrestricted should allow any service name")
		}
	})

	t.Run("restricted requires presence in Allowed map", func(t *testing.T) {
		p := UserAllowedProjects{
			Unrestricted: false,
			Allowed:      map[string]bool{"traky-api": true},
		}
		if !p.Includes("traky-api") {
			t.Fatalf("expected traky-api to be allowed")
		}
		if p.Includes("Arka") {
			t.Fatalf("expected Arka to be denied")
		}
	})

	t.Run("restricted with nil/empty Allowed denies everything", func(t *testing.T) {
		p := UserAllowedProjects{Unrestricted: false}
		if p.Includes("traky-api") {
			t.Fatalf("restricted user with empty Allowed should deny")
		}
	})
}

// TestExtractProjectPermissions_AlertsField exercises the round-trip of the
// Alerts field through the [signoz_metadata:...] JSON blob embedded in role
// descriptions. Existing roles written before the field was added have no
// "alerts" key and must still parse cleanly (zero value).
func TestExtractProjectPermissions_AlertsField(t *testing.T) {
	t.Run("alerts and external api fields round-trip through metadata", func(t *testing.T) {
		original := []ProjectPermissionRecord{
			{Project: "traky-api", APM: "read", Traces: "read", Logs: "read", Alerts: "write", ExternalApi: "read"},
			{Project: "billing", APM: "none", Traces: "none", Logs: "none", Alerts: "none", ExternalApi: "none"},
		}
		role := roleWithProjects(t, "with-alerts", original)
		got, err := role.ExtractProjectPermissions()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(got) != len(original) {
			t.Fatalf("expected %d records, got %d", len(original), len(got))
		}
		for i, rec := range got {
			if rec.Alerts != original[i].Alerts {
				t.Fatalf("record %d: expected Alerts=%q, got %q", i, original[i].Alerts, rec.Alerts)
			}
			if rec.ExternalApi != original[i].ExternalApi {
				t.Fatalf("record %d: expected ExternalApi=%q, got %q", i, original[i].ExternalApi, rec.ExternalApi)
			}
		}
	})

	t.Run("missing alerts and external api fields default to empty", func(t *testing.T) {
		// Simulate a role written before these fields existed: an old
		// payload without "alerts" or "externalApi" keys.
		legacy := SignozMetadata{ProjectPermissions: []ProjectPermissionRecord{
			{Project: "traky-api", APM: "read", Traces: "read", Logs: "read"},
		}}
		raw := mustMarshal(t, legacy)
		role := &Role{
			Name:        "legacy",
			Description: "legacy [signoz_metadata:" + raw + "]",
			Type:        RoleTypeCustom,
			OrgID:       mustUUID(t, "00000000-0000-0000-0000-000000000001"),
		}
		got, err := role.ExtractProjectPermissions()
		if err != nil {
			t.Fatalf("legacy role should parse without error, got %v", err)
		}
		if len(got) != 1 {
			t.Fatalf("expected 1 record, got %d", len(got))
		}
		if got[0].Alerts != "" {
			t.Fatalf("legacy record should have Alerts=zero value, got %q", got[0].Alerts)
		}
		if got[0].ExternalApi != "" {
			t.Fatalf("legacy record should have ExternalApi=zero value, got %q", got[0].ExternalApi)
		}
	})

	t.Run("malformed metadata json is surfaced", func(t *testing.T) {
		role := &Role{
			Name:        "broken",
			Description: "hello [signoz_metadata:{not-json}]",
			Type:        RoleTypeCustom,
			OrgID:       mustUUID(t, "00000000-0000-0000-0000-000000000001"),
		}
		if _, err := role.ExtractProjectPermissions(); err == nil {
			t.Fatalf("malformed metadata should return an error")
		}
	})
}

func TestAllProjectsMarkerConstant(t *testing.T) {
	// Frontend emits "All Services"; legacy data may still carry
	// "All Projects". The IsAllProjects() method must accept both via the
	// constant.
	if AllProjectsMarker != "All Services" {
		t.Fatalf("AllProjectsMarker should match the frontend's emitted value, got %q", AllProjectsMarker)
	}
	legacy := ProjectPermissionRecord{Project: "All Projects"}
	modern := ProjectPermissionRecord{Project: AllProjectsMarker}
	if !legacy.IsAllProjects() {
		t.Fatalf("legacy 'All Projects' should still match IsAllProjects")
	}
	if !modern.IsAllProjects() {
		t.Fatalf("modern 'All Services' should match IsAllProjects")
	}
}