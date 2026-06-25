package implproject

import (
	"context"

	"github.com/SigNoz/signoz/pkg/modules/project"
	"github.com/SigNoz/signoz/pkg/types"
	"github.com/SigNoz/signoz/pkg/valuer"
)

type setter struct {
	store types.ProjectStore
}

func NewSetter(store types.ProjectStore) project.Setter {
	return &setter{store: store}
}

func (module *setter) Create(ctx context.Context, project *types.Project) error {
	return module.store.Create(ctx, project)
}

func (module *setter) Update(ctx context.Context, project *types.Project) error {
	return module.store.Update(ctx, project)
}

func (module *setter) Delete(ctx context.Context, orgID valuer.UUID, name string) error {
	return module.store.Delete(ctx, orgID, name)
}
