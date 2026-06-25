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

type handler struct {
	projectGetter project.Getter
	projectSetter project.Setter
}

func NewHandler(projectGetter project.Getter, projectSetter project.Setter) project.Handler {
	return &handler{projectGetter: projectGetter, projectSetter: projectSetter}
}

func (handler *handler) Create(rw http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
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

	createdBy, err := valuer.NewUUID(claims.UserID)
	if err != nil {
		render.Error(rw, errors.Newf(errors.TypeInvalidInput, errors.CodeInvalidInput, "userId is invalid"))
		return
	}

	var req types.PostableProject
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		render.Error(rw, errors.Newf(errors.TypeInvalidInput, errors.CodeInvalidInput, "invalid request body"))
		return
	}

	if err := req.Validate(); err != nil {
		render.Error(rw, err)
		return
	}

	p := types.NewProject(valuer.GenerateUUID(), orgID, createdBy, req.Name, req.Description, req.LogTypes)
	if err := handler.projectSetter.Create(ctx, p); err != nil {
		render.Error(rw, err)
		return
	}

	render.Success(rw, http.StatusCreated, p)
}

func (handler *handler) Get(rw http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
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

	name := mux.Vars(r)["id"]
	if !types.IsValidProjectID(name) {
		render.Error(rw, errors.Newf(errors.TypeInvalidInput, types.ErrInvalidProjectID, "invalid project id: %s", name))
		return
	}

	p, err := handler.projectGetter.Get(ctx, orgID, name)
	if err != nil {
		render.Error(rw, err)
		return
	}

	render.Success(rw, http.StatusOK, p)
}

func (handler *handler) List(rw http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
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

	projects, err := handler.projectGetter.List(ctx, orgID)
	if err != nil {
		render.Error(rw, err)
		return
	}

	if projects == nil {
		projects = []*types.Project{}
	}
	render.Success(rw, http.StatusOK, projects)
}

func (handler *handler) Update(rw http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
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

	name := mux.Vars(r)["id"]
	if !types.IsValidProjectID(name) {
		render.Error(rw, errors.Newf(errors.TypeInvalidInput, types.ErrInvalidProjectID, "invalid project id: %s", name))
		return
	}

	var req types.UpdatableProject
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		render.Error(rw, errors.Newf(errors.TypeInvalidInput, errors.CodeInvalidInput, "invalid request body"))
		return
	}

	if err := req.Validate(); err != nil {
		render.Error(rw, err)
		return
	}

	existing, err := handler.projectGetter.Get(ctx, orgID, name)
	if err != nil {
		render.Error(rw, err)
		return
	}

	if req.Description != nil {
		existing.Description = *req.Description
	}
	if req.LogTypes != nil {
		existing.LogTypes = req.LogTypes
	}
	existing.UpdatedAt = time.Now()

	if err := handler.projectSetter.Update(ctx, existing); err != nil {
		render.Error(rw, err)
		return
	}

	render.Success(rw, http.StatusNoContent, nil)
}

func (handler *handler) Delete(rw http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
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

	name := mux.Vars(r)["id"]
	if !types.IsValidProjectID(name) {
		render.Error(rw, errors.Newf(errors.TypeInvalidInput, types.ErrInvalidProjectID, "invalid project id: %s", name))
		return
	}

	if err := handler.projectSetter.Delete(ctx, orgID, name); err != nil {
		render.Error(rw, err)
		return
	}

	render.Success(rw, http.StatusNoContent, nil)
}
