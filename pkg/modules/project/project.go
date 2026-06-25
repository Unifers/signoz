package project

import (
	"context"
	"net/http"

	"github.com/SigNoz/signoz/pkg/types"
	"github.com/SigNoz/signoz/pkg/valuer"
)

type Getter interface {
	// Get fetches a project by its slug within the given org.
	Get(context.Context, valuer.UUID, string) (*types.Project, error)

	// List returns all projects in the given org, ordered by name ASC.
	List(context.Context, valuer.UUID) ([]*types.Project, error)
}

type Setter interface {
	// Create persists a new project.
	Create(context.Context, *types.Project) error

	// Update updates the mutable fields (description, log types) of a project.
	Update(context.Context, *types.Project) error

	// Delete removes the project with the given slug from the given org.
	Delete(context.Context, valuer.UUID, string) error
}

// ProjectMember is a user that has been granted access to a specific
// (project, signal, logType) triple. The LogType and Signal fields echo the
// grant dimensions so the binding UI can render a denormalized listing
// without re-querying the source tuples.
type ProjectMember struct {
	UserID      valuer.UUID
	Email       string
	DisplayName string
	LogType     string
	Signal      string
}

// Binder manages per-(project, signal, logType) FGA access tuples for users.
// The tuple shape is:
//
//	user:organization/<orgID>/user/<userID>#read
//	    @ telemetryresource:organization/<orgID>/<signal>/<projectSlug>/<logType>
//
// Grant/Revoke produce one tuple per call; List returns the set of users
// that hold a tuple for the given (project, signal, logType).
type Binder interface {
	GrantProjectMemberAccess(ctx context.Context, orgID valuer.UUID, projectSlug, logType, signal string, userID valuer.UUID) error
	RevokeProjectMemberAccess(ctx context.Context, orgID valuer.UUID, projectSlug, logType, signal string, userID valuer.UUID) error
	ListProjectMembersWithAccess(ctx context.Context, orgID valuer.UUID, projectSlug, logType, signal string) ([]*ProjectMember, error)
}

type Handler interface {
	Create(http.ResponseWriter, *http.Request)
	Get(http.ResponseWriter, *http.Request)
	List(http.ResponseWriter, *http.Request)
	Update(http.ResponseWriter, *http.Request)
	Delete(http.ResponseWriter, *http.Request)
}

// BindingHandler exposes the per-project member-access management endpoints.
// All methods assume the caller has already passed an admin-role authz
// gate at the route level.
type BindingHandler interface {
	AddMember(http.ResponseWriter, *http.Request)
	RemoveMember(http.ResponseWriter, *http.Request)
	ListMembers(http.ResponseWriter, *http.Request)
}
