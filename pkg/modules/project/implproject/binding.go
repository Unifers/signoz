package implproject

import (
	"context"
	"strings"

	"github.com/SigNoz/signoz/pkg/authz"
	"github.com/SigNoz/signoz/pkg/errors"
	"github.com/SigNoz/signoz/pkg/modules/project"
	rootuser "github.com/SigNoz/signoz/pkg/modules/user"
	"github.com/SigNoz/signoz/pkg/types"
	"github.com/SigNoz/signoz/pkg/types/authtypes"
	"github.com/SigNoz/signoz/pkg/types/coretypes"
	"github.com/SigNoz/signoz/pkg/valuer"
	openfgav1 "github.com/openfga/api/proto/openfga/v1"
)

// binding writes and reads per-(project, signal, logType) FGA tuples. The
// authorization model treats every (project, signal, logType) triple as an
// independent grantable unit; admins compose roles that include specific
// triples, and individual users get direct read tuples for the (project,
// signal, logType) combinations they should access.
//
// The tuple produced by GrantProjectMemberAccess has the shape:
//
//	user:organization/<orgID>/user/<userID>#read
//	    @ telemetryresource:organization/<orgID>/<signal>/<projectSlug>/<logType>
//
// The composed selector format (<slug>/<logType>) matches
// ProjectLogTypeSelector, which the v5 query middleware uses to gate
// /api/v5/query_range and /api/v5/substitute_vars.
type binding struct {
	authz      authz.AuthZ
	userGetter rootuser.Getter
}

func NewBinding(authz authz.AuthZ, userGetter rootuser.Getter) project.Binder {
	return &binding{authz: authz, userGetter: userGetter}
}

// composeSelector returns the FGA selector string for a (project, logType)
// pair, e.g. "frontend-app/application". Returns an error if either input
// is invalid so callers can surface 400s rather than silently producing
// malformed tuples.
func composeSelector(projectSlug, logType string) (string, error) {
	if !types.IsValidProjectID(projectSlug) {
		return "", errors.Newf(errors.TypeInvalidInput, types.ErrInvalidProjectID, "invalid project slug %q", projectSlug)
	}
	if !types.IsValidProjectLogType(logType) {
		return "", errors.Newf(errors.TypeInvalidInput, types.ErrInvalidLogType, "invalid log type %q", logType)
	}
	return projectSlug + "/" + logType, nil
}

// buildTuple produces the single FGA TupleKey that represents a user's
// read access to (project, signal, logType). The selector is composed; the
// object is constructed via the Resource's standard Object() helper so the
// resulting string matches what the authz middleware expects.
func (b *binding) buildTuple(orgID valuer.UUID, projectSlug, logType, signal string, userID valuer.UUID) (*openfgav1.TupleKey, error) {
	resource, err := coretypes.ResourceForSignal(signal)
	if err != nil {
		return nil, err
	}
	composed, err := composeSelector(projectSlug, logType)
	if err != nil {
		return nil, err
	}
	selector, err := resource.Type().Selector(composed)
	if err != nil {
		return nil, err
	}
	tuples := authtypes.NewTuples(
		resource,
		authtypes.MustNewSubject(coretypes.NewResourceUser(), userID.StringValue(), orgID, nil),
		authtypes.Relation{Verb: coretypes.VerbRead},
		[]coretypes.Selector{selector},
		orgID,
	)
	return tuples[0], nil
}

func (b *binding) GrantProjectMemberAccess(ctx context.Context, orgID valuer.UUID, projectSlug, logType, signal string, userID valuer.UUID) error {
	tuple, err := b.buildTuple(orgID, projectSlug, logType, signal, userID)
	if err != nil {
		return err
	}
	return b.authz.Write(ctx, []*openfgav1.TupleKey{tuple}, nil)
}

func (b *binding) RevokeProjectMemberAccess(ctx context.Context, orgID valuer.UUID, projectSlug, logType, signal string, userID valuer.UUID) error {
	tuple, err := b.buildTuple(orgID, projectSlug, logType, signal, userID)
	if err != nil {
		return err
	}
	return b.authz.Write(ctx, nil, []*openfgav1.TupleKey{tuple})
}

// ListProjectMembersWithAccess reads the tuples that grant read access on
// the (project, signal, logType) object and joins them to user records. The
// returned slice is de-duplicated by user id so callers can render a single
// row per user even if multiple tuples reference the same subject.
//
// Returns an empty slice (not nil) when no members exist, so JSON encoders
// produce "[]" rather than "null".
func (b *binding) ListProjectMembersWithAccess(ctx context.Context, orgID valuer.UUID, projectSlug, logType, signal string) ([]*project.ProjectMember, error) {
	composed, err := composeSelector(projectSlug, logType)
	if err != nil {
		return nil, err
	}
	resource, err := coretypes.ResourceForSignal(signal)
	if err != nil {
		return nil, err
	}
	selector := resource.Type().MustSelector(composed)
	objectStr := resource.Object(orgID, selector.String())

	tuples, err := b.authz.ReadTuples(ctx, &openfgav1.ReadRequestTupleKey{
		Object:   objectStr,
		Relation: coretypes.VerbRead.StringValue(),
	})
	if err != nil {
		return nil, err
	}

	seen := map[valuer.UUID]struct{}{}
	out := make([]*project.ProjectMember, 0, len(tuples))
	for _, t := range tuples {
		userID, ok := userIDFromSubject(t.GetUser())
		if !ok {
			continue
		}
		if _, dup := seen[userID]; dup {
			continue
		}
		seen[userID] = struct{}{}

		u, err := b.userGetter.GetUserByOrgIDAndID(ctx, orgID, userID)
		if err != nil {
			// Skip users that no longer exist; the tuple is stale and the
			// next admin operation will reconcile it.
			continue
		}

		out = append(out, &project.ProjectMember{
			UserID:      u.ID,
			Email:       u.Email.StringValue(),
			DisplayName: u.DisplayName,
			LogType:     logType,
			Signal:      signal,
		})
	}
	return out, nil
}

// userIDFromSubject extracts the user-id suffix from an FGA subject string
// of the form "user:organization/<orgID>/user/<userID>". Returns ok=false
// when the subject does not match the expected shape; callers should skip
// such tuples silently rather than abort the listing.
func userIDFromSubject(subject string) (valuer.UUID, bool) {
	parts := strings.Split(subject, "/")
	if len(parts) < 4 {
		return valuer.UUID{}, false
	}
	uid, err := valuer.NewUUID(parts[len(parts)-1])
	if err != nil {
		return valuer.UUID{}, false
	}
	return uid, true
}
