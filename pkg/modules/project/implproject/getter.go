package implproject

import (
	"context"

	"github.com/SigNoz/signoz/pkg/modules/project"
	"github.com/SigNoz/signoz/pkg/types"
	"github.com/SigNoz/signoz/pkg/valuer"
)

type getter struct {
	store types.ProjectStore
}

func NewGetter(store types.ProjectStore) project.Getter {
	return &getter{store: store}
}

func (module *getter) Get(ctx context.Context, orgID valuer.UUID, name string) (*types.Project, error) {
	return module.store.Get(ctx, orgID, name)
}

func (module *getter) List(ctx context.Context, orgID valuer.UUID) ([]*types.Project, error) {
	return module.store.List(ctx, orgID)
}
