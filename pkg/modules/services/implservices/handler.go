package implservices

import (
	"context"
	"net/http"

	"github.com/SigNoz/signoz/pkg/errors"
	"github.com/SigNoz/signoz/pkg/http/binding"
	"github.com/SigNoz/signoz/pkg/http/render"
	"github.com/SigNoz/signoz/pkg/modules/services"
	"github.com/SigNoz/signoz/pkg/modules/user"
	"github.com/SigNoz/signoz/pkg/types/authtypes"
	"github.com/SigNoz/signoz/pkg/types/servicetypes/servicetypesv1"
	"github.com/SigNoz/signoz/pkg/valuer"
)

type handler struct {
	Module     services.Module
	userGetter user.Getter
}

func NewHandler(m services.Module, userGetter user.Getter) services.Handler {
	return &handler{
		Module:     m,
		userGetter: userGetter,
	}
}

func (h *handler) Get(rw http.ResponseWriter, req *http.Request) {
	claims, err := authtypes.ClaimsFromContext(req.Context())
	if err != nil {
		render.Error(rw, err)
		return
	}

	var in servicetypesv1.Request
	if err := binding.JSON.BindBody(req.Body, &in); err != nil {
		render.Error(rw, err)
		return
	}

	orgUUID, err := valuer.NewUUID(claims.OrgID)
	if err != nil {
		render.Error(rw, err)
		return
	}
	out, err := h.Module.Get(req.Context(), orgUUID, &in)
	if err != nil {
		render.Error(rw, err)
		return
	}

	access, err := authtypes.GetUserAllowedProjects(req.Context(), h.userGetter)
	if err == nil && !access.Unrestricted && out != nil {
		filtered := make([]*servicetypesv1.ResponseItem, 0, len(out))
		for _, item := range out {
			if access.Includes(item.ServiceName) {
				filtered = append(filtered, item)
			}
		}
		out = filtered
	}

	render.Success(rw, http.StatusOK, out)
}

func (h *handler) GetTopOperations(rw http.ResponseWriter, req *http.Request) {
	claims, err := authtypes.ClaimsFromContext(req.Context())
	if err != nil {
		render.Error(rw, err)
		return
	}

	var in servicetypesv1.OperationsRequest
	if err := binding.JSON.BindBody(req.Body, &in); err != nil {
		render.Error(rw, err)
		return
	}

	if err := enforceServiceAccess(req.Context(), h.userGetter, in.Service); err != nil {
		render.Error(rw, err)
		return
	}

	orgUUID, err := valuer.NewUUID(claims.OrgID)
	if err != nil {
		render.Error(rw, err)
		return
	}
	out, err := h.Module.GetTopOperations(req.Context(), orgUUID, &in)
	if err != nil {
		render.Error(rw, err)
		return
	}
	render.Success(rw, http.StatusOK, out)
}

func (h *handler) GetEntryPointOperations(rw http.ResponseWriter, req *http.Request) {
	claims, err := authtypes.ClaimsFromContext(req.Context())
	if err != nil {
		render.Error(rw, err)
		return
	}

	var in servicetypesv1.OperationsRequest
	if err := binding.JSON.BindBody(req.Body, &in); err != nil {
		render.Error(rw, err)
		return
	}

	if err := enforceServiceAccess(req.Context(), h.userGetter, in.Service); err != nil {
		render.Error(rw, err)
		return
	}

	orgUUID, err := valuer.NewUUID(claims.OrgID)
	if err != nil {
		render.Error(rw, err)
		return
	}
	out, err := h.Module.GetEntryPointOperations(req.Context(), orgUUID, &in)
	if err != nil {
		render.Error(rw, err)
		return
	}
	render.Success(rw, http.StatusOK, out)
}

// enforceServiceAccess returns an errors.TypeForbidden when a user with a
// restricted custom role targets a service they have not been granted access
// to. An empty service name is treated as unrestricted (no specific service
// was targeted) so existing flows that operate over the whole org are not
// broken.
func enforceServiceAccess(ctx context.Context, getter user.Getter, serviceName string) error {
	if serviceName == "" {
		return nil
	}

	access, err := authtypes.GetUserAllowedProjects(ctx, getter)
	if err != nil {
		return err
	}

	if access.Includes(serviceName) {
		return nil
	}

	return errors.NewForbiddenf(errors.CodeForbidden, "user does not have access to service: %s", serviceName)
}
