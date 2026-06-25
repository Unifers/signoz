package implproject

import (
	"context"
	"testing"

	"github.com/SigNoz/signoz/pkg/authz"
	"github.com/SigNoz/signoz/pkg/errors"
	rootuser "github.com/SigNoz/signoz/pkg/modules/user"
	"github.com/SigNoz/signoz/pkg/types"
	"github.com/SigNoz/signoz/pkg/valuer"
	openfgav1 "github.com/openfga/api/proto/openfga/v1"
)

// fakeAuthZ records calls to Write so tests can assert the exact tuples
// the binding service produces. It returns canned data from ReadTuples so
// ListProjectMembersWithAccess tests can exercise the join path without a
// live FGA server. Other authz.AuthZ methods are unimplemented (panics)
// and not exercised by these tests.
type fakeAuthZ struct {
	authz.AuthZ
	additions []*openfgav1.TupleKey
	deletions []*openfgav1.TupleKey
	readOut   []*openfgav1.TupleKey
	readErr   error
}

func (f *fakeAuthZ) Write(_ context.Context, additions, deletions []*openfgav1.TupleKey) error {
	f.additions = append(f.additions, additions...)
	f.deletions = append(f.deletions, deletions...)
	return nil
}

func (f *fakeAuthZ) ReadTuples(_ context.Context, _ *openfgav1.ReadRequestTupleKey) ([]*openfgav1.TupleKey, error) {
	return f.readOut, f.readErr
}

func newTestUser(id valuer.UUID) *types.User {
	return &types.User{
		Identifiable: types.Identifiable{ID: id},
		DisplayName:  "Test User",
		Email:        valuer.MustNewEmail("test@example.com"),
		OrgID:        id, // any non-zero UUID; tests don't cross-check
	}
}

func newTestBinding(readOut []*openfgav1.TupleKey, readErr error) (*binding, *fakeAuthZ) {
	authz := &fakeAuthZ{readOut: readOut, readErr: readErr}
	userGetter := &fakeUserGetter{users: map[valuer.UUID]*types.User{}}
	return &binding{authz: authz, userGetter: userGetter}, authz
}

func TestBinding_Grant_WritesComposedTuple(t *testing.T) {
	orgID := valuer.GenerateUUID()
	userID := valuer.GenerateUUID()
	b, authz := newTestBinding(nil, nil)

	err := b.GrantProjectMemberAccess(context.Background(), orgID, "frontend-app", "application", "logs", userID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(authz.additions) != 1 {
		t.Fatalf("expected 1 addition, got %d", len(authz.additions))
	}
	if len(authz.deletions) != 0 {
		t.Fatalf("expected 0 deletions, got %d", len(authz.deletions))
	}

	got := authz.additions[0]
	wantObject := "telemetryresource:organization/" + orgID.StringValue() + "/logs/frontend-app/application"
	if got.Object != wantObject {
		t.Errorf("object mismatch: got %q want %q", got.Object, wantObject)
	}
	wantUser := "user:organization/" + orgID.StringValue() + "/user/" + userID.StringValue()
	if got.User != wantUser {
		t.Errorf("user mismatch: got %q want %q", got.User, wantUser)
	}
	if got.Relation != "read" {
		t.Errorf("relation mismatch: got %q want %q", got.Relation, "read")
	}
}

func TestBinding_Grant_DifferentSignalsProduceDifferentObjects(t *testing.T) {
	orgID := valuer.GenerateUUID()
	userID := valuer.GenerateUUID()
	b, authz := newTestBinding(nil, nil)

	for _, signal := range []string{"logs", "traces", "metrics"} {
		if err := b.GrantProjectMemberAccess(context.Background(), orgID, "frontend-app", "application", signal, userID); err != nil {
			t.Fatalf("signal %s: unexpected error: %v", signal, err)
		}
	}
	if len(authz.additions) != 3 {
		t.Fatalf("expected 3 additions, got %d", len(authz.additions))
	}
	wantKinds := map[string]string{
		"logs":    "/logs/",
		"traces":  "/traces/",
		"metrics": "/metrics/",
	}
	for _, a := range authz.additions {
		found := false
		for signal, kind := range wantKinds {
			if contains(a.Object, kind+"frontend-app/application") {
				found = true
				delete(wantKinds, signal)
				break
			}
		}
		if !found {
			t.Errorf("unexpected object: %q", a.Object)
		}
	}
	if len(wantKinds) > 0 {
		t.Errorf("missing object kinds: %v", wantKinds)
	}
}

func TestBinding_Revoke_DeletesComposedTuple(t *testing.T) {
	orgID := valuer.GenerateUUID()
	userID := valuer.GenerateUUID()
	b, authz := newTestBinding(nil, nil)

	err := b.RevokeProjectMemberAccess(context.Background(), orgID, "frontend-app", "application", "logs", userID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(authz.additions) != 0 {
		t.Fatalf("expected 0 additions, got %d", len(authz.additions))
	}
	if len(authz.deletions) != 1 {
		t.Fatalf("expected 1 deletion, got %d", len(authz.deletions))
	}
	wantObject := "telemetryresource:organization/" + orgID.StringValue() + "/logs/frontend-app/application"
	if authz.deletions[0].Object != wantObject {
		t.Errorf("object mismatch: got %q want %q", authz.deletions[0].Object, wantObject)
	}
	if authz.deletions[0].Relation != "read" {
		t.Errorf("relation mismatch: got %q want %q", authz.deletions[0].Relation, "read")
	}
}

func TestBinding_Grant_RejectsInvalidProjectID(t *testing.T) {
	orgID := valuer.GenerateUUID()
	userID := valuer.GenerateUUID()
	b, _ := newTestBinding(nil, nil)

	err := b.GrantProjectMemberAccess(context.Background(), orgID, "Bad-ID", "application", "logs", userID)
	if err == nil {
		t.Fatal("expected error for invalid project id")
	}
	if !errors.Asc(err, types.ErrInvalidProjectID) {
		t.Errorf("expected ErrInvalidProjectID, got %v", err)
	}
}

func TestBinding_Grant_RejectsInvalidLogType(t *testing.T) {
	orgID := valuer.GenerateUUID()
	userID := valuer.GenerateUUID()
	b, _ := newTestBinding(nil, nil)

	err := b.GrantProjectMemberAccess(context.Background(), orgID, "frontend-app", "not-a-real-log-type", "logs", userID)
	if err == nil {
		t.Fatal("expected error for invalid log type")
	}
	if !errors.Asc(err, types.ErrInvalidLogType) {
		t.Errorf("expected ErrInvalidLogType, got %v", err)
	}
}

func TestBinding_Grant_RejectsInvalidSignal(t *testing.T) {
	orgID := valuer.GenerateUUID()
	userID := valuer.GenerateUUID()
	b, _ := newTestBinding(nil, nil)

	err := b.GrantProjectMemberAccess(context.Background(), orgID, "frontend-app", "application", "audit", userID)
	if err == nil {
		t.Fatal("expected error for invalid signal")
	}
	// ResourceForSignal surfaces its own error code; just confirm we get
	// an error (callers will translate to 400 at the route layer).
}

func TestBinding_ListMembers_ParsesTuples(t *testing.T) {
	orgID := valuer.GenerateUUID()
	userA := valuer.GenerateUUID()
	userB := valuer.GenerateUUID()

	readOut := []*openfgav1.TupleKey{
		{
			Object:   "telemetryresource:organization/" + orgID.StringValue() + "/logs/frontend-app/application",
			Relation: "read",
			User:     "user:organization/" + orgID.StringValue() + "/user/" + userA.StringValue(),
		},
		{
			Object:   "telemetryresource:organization/" + orgID.StringValue() + "/logs/frontend-app/application",
			Relation: "read",
			User:     "user:organization/" + orgID.StringValue() + "/user/" + userB.StringValue(),
		},
		{
			// Same subject, different relation — must NOT produce a member
			// row (the join should filter on relation == "read").
			Object:   "telemetryresource:organization/" + orgID.StringValue() + "/logs/frontend-app/application",
			Relation: "write",
			User:     "user:organization/" + orgID.StringValue() + "/user/" + userA.StringValue(),
		},
	}

	b, _ := newTestBinding(readOut, nil)
	b.userGetter = &fakeUserGetter{users: map[valuer.UUID]*types.User{
		userA: newTestUser(userA),
		userB: newTestUser(userB),
	}}

	members, err := b.ListProjectMembersWithAccess(context.Background(), orgID, "frontend-app", "application", "logs")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(members) != 2 {
		t.Fatalf("expected 2 members, got %d", len(members))
	}
	gotIDs := map[valuer.UUID]bool{}
	for _, m := range members {
		gotIDs[m.UserID] = true
		if m.LogType != "application" || m.Signal != "logs" {
			t.Errorf("member %v: expected (application, logs), got (%s, %s)", m.UserID, m.LogType, m.Signal)
		}
	}
	if !gotIDs[userA] || !gotIDs[userB] {
		t.Errorf("missing users: got %v, want %v and %v", gotIDs, userA, userB)
	}
}

func TestBinding_ListMembers_SkipsUnknownUsers(t *testing.T) {
	orgID := valuer.GenerateUUID()
	userA := valuer.GenerateUUID()
	unknownUser := valuer.GenerateUUID()

	readOut := []*openfgav1.TupleKey{
		{
			Object:   "telemetryresource:organization/" + orgID.StringValue() + "/logs/frontend-app/application",
			Relation: "read",
			User:     "user:organization/" + orgID.StringValue() + "/user/" + userA.StringValue(),
		},
		{
			Object:   "telemetryresource:organization/" + orgID.StringValue() + "/logs/frontend-app/application",
			Relation: "read",
			User:     "user:organization/" + orgID.StringValue() + "/user/" + unknownUser.StringValue(),
		},
	}

	b, _ := newTestBinding(readOut, nil)
	b.userGetter = &fakeUserGetter{
		users: map[valuer.UUID]*types.User{
			userA: newTestUser(userA),
			// unknownUser intentionally missing — tuple must be skipped.
		},
	}

	members, err := b.ListProjectMembersWithAccess(context.Background(), orgID, "frontend-app", "application", "logs")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(members) != 1 {
		t.Fatalf("expected 1 member (unknown user skipped), got %d", len(members))
	}
	if members[0].UserID != userA {
		t.Errorf("expected userA, got %v", members[0].UserID)
	}
}

func TestBinding_ListMembers_RejectsInvalidInputs(t *testing.T) {
	orgID := valuer.GenerateUUID()
	b, _ := newTestBinding(nil, nil)

	if _, err := b.ListProjectMembersWithAccess(context.Background(), orgID, "Bad-ID", "application", "logs"); err == nil {
		t.Error("expected error for invalid project id")
	}
	if _, err := b.ListProjectMembersWithAccess(context.Background(), orgID, "frontend-app", "not-a-real-log-type", "logs"); err == nil {
		t.Error("expected error for invalid log type")
	}
	if _, err := b.ListProjectMembersWithAccess(context.Background(), orgID, "frontend-app", "application", "audit"); err == nil {
		t.Error("expected error for invalid signal")
	}
}

func TestUserIDFromSubject(t *testing.T) {
	orgID := valuer.GenerateUUID()
	userID := valuer.GenerateUUID()
	subject := "user:organization/" + orgID.StringValue() + "/user/" + userID.StringValue()

	got, ok := userIDFromSubject(subject)
	if !ok {
		t.Fatal("expected ok")
	}
	if got != userID {
		t.Errorf("got %v, want %v", got, userID)
	}

	bad := []string{
		"",
		"just-two/parts",
		"three/parts/here",
		"user:organization/" + orgID.StringValue() + "/user/not-a-uuid",
		"role:organization/" + orgID.StringValue() + "/role/admin", // wrong prefix
	}
	for _, s := range bad {
		if _, ok := userIDFromSubject(s); ok {
			t.Errorf("expected !ok for %q", s)
		}
	}
}

func contains(haystack, needle string) bool {
	if len(needle) == 0 {
		return true
	}
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}

// fakeUserGetter is a stub implementation of rootuser.Getter that returns
// users from an in-memory map. Only GetUserByOrgIDAndID is exercised by the
// binding tests; other methods panic so an unexpected call is loud, not
// silent.
type fakeUserGetter struct {
	rootuser.Getter
	users map[valuer.UUID]*types.User
}

func (f *fakeUserGetter) GetUserByOrgIDAndID(_ context.Context, _ valuer.UUID, id valuer.UUID) (*types.User, error) {
	u, ok := f.users[id]
	if !ok {
		return nil, errors.Newf(errors.TypeNotFound, errors.CodeNotFound, "user %s not found", id.StringValue())
	}
	return u, nil
}
