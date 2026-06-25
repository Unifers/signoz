package signozapiserver

import (
	"net/http"

	"github.com/SigNoz/signoz/pkg/http/handler"
	"github.com/SigNoz/signoz/pkg/types"
	"github.com/SigNoz/signoz/pkg/types/authtypes"
	"github.com/SigNoz/signoz/pkg/types/coretypes"
	"github.com/gorilla/mux"
)

// addProjectBindingRoutes mounts the per-project member-access management
// endpoints. All routes require admin role; the authz middleware is
// configured with SigNozAdminRoleName so non-admins get a 403 before the
// handler runs. A BasicResourceDef is attached to the project resource
// itself (not the telemetryresource) so the authz middleware can verify
// the operator has the right to update the project's access lists.
func (provider *provider) addProjectBindingRoutes(router *mux.Router) error {
	if err := router.Handle("/api/v1/projects/{id}/members", handler.New(
		provider.authzMiddleware.CheckResources(provider.projectBindingHandler.AddMember, authtypes.SigNozAdminRoleName),
		handler.OpenAPIDef{
			ID:                  "AddProjectMember",
			Tags:                []string{"project"},
			Summary:             "Grant a user read access to a (project, signal, logType) tuple",
			Description:         "Adds an FGA tuple granting the user read access to the specified signal and log type within the project.",
			Request:             new(types.PostableProjectMember),
			RequestContentType:  "application/json",
			Response:            nil,
			ResponseContentType: "application/json",
			SuccessStatusCode:   http.StatusNoContent,
			ErrorStatusCodes:    []int{http.StatusBadRequest, http.StatusNotFound},
			Deprecated:          false,
			SecuritySchemes:     newScopedSecuritySchemes([]string{coretypes.ResourceProject.Scope(coretypes.VerbUpdate)}),
		},
		handler.WithResourceDefs(handler.BasicResourceDef{
			Resource: coretypes.ResourceProject,
			Verb:     coretypes.VerbUpdate,
			Category: coretypes.ActionCategoryAccessControl,
			ID:       coretypes.PathParam("id"),
			Selector: coretypes.IDSelector,
		}),
	)).Methods(http.MethodPost).GetError(); err != nil {
		return err
	}

	if err := router.Handle("/api/v1/projects/{id}/members/{userId}/{logType}/{signal}", handler.New(
		provider.authzMiddleware.CheckResources(provider.projectBindingHandler.RemoveMember, authtypes.SigNozAdminRoleName),
		handler.OpenAPIDef{
			ID:                  "RemoveProjectMember",
			Tags:                []string{"project"},
			Summary:             "Revoke a user's read access to a (project, signal, logType) tuple",
			Description:         "Removes the FGA tuple granting the user read access to the specified signal and log type within the project.",
			Request:             nil,
			RequestContentType:  "",
			Response:            nil,
			ResponseContentType: "application/json",
			SuccessStatusCode:   http.StatusNoContent,
			ErrorStatusCodes:    []int{http.StatusBadRequest, http.StatusNotFound},
			Deprecated:          false,
			SecuritySchemes:     newScopedSecuritySchemes([]string{coretypes.ResourceProject.Scope(coretypes.VerbUpdate)}),
		},
		handler.WithResourceDefs(handler.BasicResourceDef{
			Resource: coretypes.ResourceProject,
			Verb:     coretypes.VerbUpdate,
			Category: coretypes.ActionCategoryAccessControl,
			ID:       coretypes.PathParam("id"),
			Selector: coretypes.IDSelector,
		}),
	)).Methods(http.MethodDelete).GetError(); err != nil {
		return err
	}

	if err := router.Handle("/api/v1/projects/{id}/members", handler.New(
		provider.authzMiddleware.CheckResources(provider.projectBindingHandler.ListMembers, authtypes.SigNozAdminRoleName),
		handler.OpenAPIDef{
			ID:                  "ListProjectMembers",
			Tags:                []string{"project"},
			Summary:             "List users with access to a project",
			Description:         "Returns every (user, signal, logType) tuple the project exposes. The list is denormalized — one entry per triple — so the binding UI can render a grid without further expansion.",
			Request:             nil,
			RequestContentType:  "",
			Response:            []*types.ProjectMemberResponse{},
			ResponseContentType: "application/json",
			SuccessStatusCode:   http.StatusOK,
			ErrorStatusCodes:    []int{http.StatusBadRequest, http.StatusNotFound},
			Deprecated:          false,
			SecuritySchemes:     newScopedSecuritySchemes([]string{coretypes.ResourceProject.Scope(coretypes.VerbRead)}),
		},
		handler.WithResourceDefs(handler.BasicResourceDef{
			Resource: coretypes.ResourceProject,
			Verb:     coretypes.VerbRead,
			Category: coretypes.ActionCategoryAccessControl,
			ID:       coretypes.PathParam("id"),
			Selector: coretypes.IDSelector,
		}),
	)).Methods(http.MethodGet).GetError(); err != nil {
		return err
	}

	return nil
}
