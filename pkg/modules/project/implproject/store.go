package implproject

import (
	"context"
	"time"

	"github.com/SigNoz/signoz/pkg/sqlstore"
	"github.com/SigNoz/signoz/pkg/types"
	"github.com/SigNoz/signoz/pkg/valuer"
)

type store struct {
	sqlstore sqlstore.SQLStore
}

func NewStore(sqlstore sqlstore.SQLStore) types.ProjectStore {
	return &store{sqlstore: sqlstore}
}

// hydrate converts the persisted LogTypesJ (JSON text) into the API-facing
// LogTypes []string. Called after every SELECT.
func hydrate(p *types.Project) error {
	if p == nil {
		return nil
	}
	out, err := types.LogTypesJSONDecode(p.LogTypesJ)
	if err != nil {
		return err
	}
	p.LogTypes = out
	return nil
}

// hydrateAll applies hydrate to a slice of projects.
func hydrateAll(ps []*types.Project) error {
	for _, p := range ps {
		if err := hydrate(p); err != nil {
			return err
		}
	}
	return nil
}

func (store *store) Create(ctx context.Context, project *types.Project) error {
	// Defensive: callers should set LogTypesJ via NewProject, but ensure
	// the persisted field is in sync with the slice in case of partial update.
	project.LogTypesJ = types.LogTypesJSONEncode(project.LogTypes)

	_, err := store.
		sqlstore.
		BunDBCtx(ctx).
		NewInsert().
		Model(project).
		Exec(ctx)
	if err != nil {
		return store.sqlstore.WrapAlreadyExistsErrf(err, types.ErrProjectAlreadyExists, "project with name: %s already exists", project.Name)
	}

	return nil
}

func (store *store) Get(ctx context.Context, orgID valuer.UUID, name string) (*types.Project, error) {
	project := new(types.Project)
	err := store.
		sqlstore.
		BunDB().
		NewSelect().
		Model(project).
		Where("org_id = ?", orgID.StringValue()).
		Where("name = ?", name).
		Scan(ctx)
	if err != nil {
		return nil, store.sqlstore.WrapNotFoundErrf(err, types.ErrProjectNotFound, "project with name: %s does not exist in org: %s", name, orgID.StringValue())
	}

	if err := hydrate(project); err != nil {
		return nil, err
	}
	return project, nil
}

func (store *store) List(ctx context.Context, orgID valuer.UUID) ([]*types.Project, error) {
	projects := make([]*types.Project, 0)
	err := store.
		sqlstore.
		BunDB().
		NewSelect().
		Model(&projects).
		Where("org_id = ?", orgID.StringValue()).
		OrderExpr("name ASC").
		Scan(ctx)
	if err != nil {
		return nil, err
	}

	if err := hydrateAll(projects); err != nil {
		return nil, err
	}
	return projects, nil
}

func (store *store) Update(ctx context.Context, project *types.Project) error {
	project.LogTypesJ = types.LogTypesJSONEncode(project.LogTypes)
	project.UpdatedAt = time.Now()

	_, err := store.
		sqlstore.
		BunDB().
		NewUpdate().
		Model(project).
		Set("description = ?", project.Description).
		Set("log_types = ?", project.LogTypesJ).
		Set("updated_at = ?", project.UpdatedAt).
		Where("id = ?", project.ID.StringValue()).
		Where("org_id = ?", project.OrgID.StringValue()).
		Exec(ctx)
	if err != nil {
		return store.sqlstore.WrapNotFoundErrf(err, types.ErrProjectNotFound, "project with id: %s does not exist", project.ID.StringValue())
	}
	return nil
}

func (store *store) Delete(ctx context.Context, orgID valuer.UUID, name string) error {
	_, err := store.
		sqlstore.
		BunDB().
		NewDelete().
		Model(new(types.Project)).
		Where("org_id = ?", orgID.StringValue()).
		Where("name = ?", name).
		Exec(ctx)
	if err != nil {
		return err
	}
	return nil
}
