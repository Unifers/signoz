package implproject

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/SigNoz/signoz/pkg/errors"
	"github.com/SigNoz/signoz/pkg/http/render"
	"github.com/SigNoz/signoz/pkg/modules/project"
	"github.com/SigNoz/signoz/pkg/types"
	"github.com/SigNoz/signoz/pkg/types/authtypes"
	"github.com/SigNoz/signoz/pkg/valuer"
	"github.com/gorilla/mux"
)

// bindingHandler serves the per-project member-access management endpoints.
// All methods are gated by admin-role authz at the route layer; the handler
// itself only validates inputs and delegates to the Binder.
type bindingHandler struct {
	binder project.Binder
}

func NewBindingHandler(binder project.Binder) project.BindingHandler {
	return &bindingHandler{binder: binder}
}

const (
	bindingHandlerTimeout = 10 * time.Second
)

func (h *bindingHandler) AddMember(rw http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), bindingHandlerTimeout)
	defer cancel()

	claims, err := authtypes.ClaimsFromContext(ctx)
	if err != nil {
		render.Error(rw, err)
		return
	}

	orgID, err := valuer.NewUUID(claims.OrgID)
	if err != nil {
		render.Error(rw, errors.Newf(errors.TypeInvalidInput, errors.CodeInvalidInput, "orgId is invalid"))
		return
	}

	projectSlug := mux.Vars(r)["id"]
	if !types.IsValidProjectID(projectSlug) {
		render.Error(rw, errors.Newf(errors.TypeInvalidInput, types.ErrInvalidProjectID, "invalid project id: %s", projectSlug))
		return
	}

	var req types.PostableProjectMember
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		render.Error(rw, errors.Newf(errors.TypeInvalidInput, errors.CodeInvalidInput, "invalid request body"))
		return
	}

	if err := req.Validate(); err != nil {
		render.Error(rw, err)
		return
	}

	userID, err := valuer.NewUUID(req.UserID)
	if err != nil {
		render.Error(rw, errors.Newf(errors.TypeInvalidInput, errors.CodeInvalidInput, "invalid userId: %s", req.UserID))
		return
	}

	if err := h.binder.GrantProjectMemberAccess(ctx, orgID, projectSlug, req.LogType, req.Signal, userID); err != nil {
		render.Error(rw, err)
		return
	}

	render.Success(rw, http.StatusNoContent, nil)
}

func (h *bindingHandler) RemoveMember(rw http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), bindingHandlerTimeout)
	defer cancel()

	claims, err := authtypes.ClaimsFromContext(ctx)
	if err != nil {
		render.Error(rw, err)
		return
	}

	orgID, err := valuer.NewUUID(claims.OrgID)
	if err != nil {
		render.Error(rw, errors.Newf(errors.TypeInvalidInput, errors.CodeInvalidInput, "orgId is invalid"))
		return
	}

	vars := mux.Vars(r)
	projectSlug, userIDStr, logType, signal := vars["id"], vars["userId"], vars["logType"], vars["signal"]

	if !types.IsValidProjectID(projectSlug) {
		render.Error(rw, errors.Newf(errors.TypeInvalidInput, types.ErrInvalidProjectID, "invalid project id: %s", projectSlug))
		return
	}

	userID, err := valuer.NewUUID(userIDStr)
	if err != nil {
		render.Error(rw, errors.Newf(errors.TypeInvalidInput, errors.CodeInvalidInput, "invalid userId: %s", userIDStr))
		return
	}

	if !types.IsValidProjectLogType(logType) {
		render.Error(rw, errors.Newf(errors.TypeInvalidInput, types.ErrInvalidLogType, "invalid log type: %s", logType))
		return
	}
	if signal != "logs" && signal != "traces" && signal != "metrics" {
		render.Error(rw, errors.Newf(errors.TypeInvalidInput, errors.CodeInvalidInput, "invalid signal: %s", signal))
		return
	}

	if err := h.binder.RevokeProjectMemberAccess(ctx, orgID, projectSlug, logType, signal, userID); err != nil {
		render.Error(rw, err)
		return
	}

	render.Success(rw, http.StatusNoContent, nil)
}

// ListMembers enumerates every (logType, signal) grant the project exposes
// and unions the results. The response is intentionally flat — one entry
// per (user, logType, signal) — so the binding UI can render a denormalized
// grid without further client-side expansion.
func (h *bindingHandler) ListMembers(rw http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), bindingHandlerTimeout)
	defer cancel()

	claims, err := authtypes.ClaimsFromContext(ctx)
	if err != nil {
		render.Error(rw, err)
		return
	}

	orgID, err := valuer.NewUUID(claims.OrgID)
	if err != nil {
		render.Error(rw, errors.Newf(errors.TypeInvalidInput, errors.CodeInvalidInput, "orgId is invalid"))
		return
	}

	projectSlug := mux.Vars(r)["id"]
	if !types.IsValidProjectID(projectSlug) {
		render.Error(rw, errors.Newf(errors.TypeInvalidInput, types.ErrInvalidProjectID, "invalid project id: %s", projectSlug))
		return
	}

	signals := []string{"logs", "traces", "metrics"}
	out := make([]*types.ProjectMemberResponse, 0)
	for _, lt := range types.ProjectLogTypes {
		for _, signal := range signals {
			members, err := h.binder.ListProjectMembersWithAccess(ctx, orgID, projectSlug, lt, signal)
			if err != nil {
				render.Error(rw, err)
				return
			}
			for _, m := range members {
				out = append(out, &types.ProjectMemberResponse{
					UserID:      m.UserID.StringValue(),
					Email:       m.Email,
					DisplayName: m.DisplayName,
					LogType:     m.LogType,
					Signal:      m.Signal,
				})
			}
		}
	}

	render.Success(rw, http.StatusOK, out)
}
