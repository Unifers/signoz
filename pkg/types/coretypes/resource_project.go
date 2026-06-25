package coretypes

import (
	"github.com/SigNoz/signoz/pkg/valuer"
)

type resourceProject struct {
	kind Kind
}

func NewResourceProject() Resource {
	return &resourceProject{
		kind: KindProject,
	}
}

func (*resourceProject) Type() Type {
	return TypeProject
}

func (resourceProject *resourceProject) Kind() Kind {
	return resourceProject.kind
}

// example: project:organization/0199c47d-f61b-7833-bc5f-c0730f12f046/project
func (resourceProject *resourceProject) Prefix(orgID valuer.UUID) string {
	return resourceProject.Type().StringValue() + ":" + "organization" + "/" + orgID.StringValue() + "/" + resourceProject.Kind().String()
}

func (resourceProject *resourceProject) Object(orgID valuer.UUID, selector string) string {
	return resourceProject.Prefix(orgID) + "/" + selector
}

func (resourceProject *resourceProject) Scope(verb Verb) string {
	return resourceProject.Kind().String() + ":" + verb.StringValue()
}

func (*resourceProject) AllowedVerbs() []Verb {
	return TypeProject.AllowedVerbs()
}
