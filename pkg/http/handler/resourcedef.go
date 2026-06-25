package handler

import (
	"strings"

	"github.com/SigNoz/signoz/pkg/types/coretypes"
)

type ResourceDef interface {
	// resolveRequest is unexported to seal the interface. It returns a slice so a
	// single def can fan out (e.g. a telemetry query touching multiple signals).
	resolveRequest(ec coretypes.ExtractorContext) []coretypes.ResolvedResource
}

func ResolveRequest(defs []ResourceDef, ec coretypes.ExtractorContext) []coretypes.ResolvedResource {
	resolved := make([]coretypes.ResolvedResource, 0, len(defs))
	for _, def := range defs {
		resolved = append(resolved, def.resolveRequest(ec)...)
	}

	return resolved
}

// BasicResourceDef checks a single resource for one verb.
type BasicResourceDef struct {
	Resource coretypes.Resource
	Verb     coretypes.Verb
	Category coretypes.ActionCategory
	ID       coretypes.ResourceIDExtractor
	Selector coretypes.SelectorFunc
}

func (def BasicResourceDef) resolveRequest(ec coretypes.ExtractorContext) []coretypes.ResolvedResource {
	return []coretypes.ResolvedResource{
		coretypes.NewResolvedResource(
			def.Verb,
			def.Category,
			def.Resource,
			def.ID,
			def.Selector,
			ec,
		),
	}
}

// PerSignalResourceDef fans out into one ResolvedResource per telemetry signal
// (logs/traces/metrics) present in the request body, each with the same verb
// and category.
//
// The active project is identified by an HTTP header (ProjectHeader) whose
// value is "<projectSlug>:<logType>". The signal list is read from the
// request body via SignalsExtractor. The composed resource id is
// "<projectSlug>:<signal>:<logType>" which ProjectLogTypeSelector parses
// into per-(project, logType) FGA selectors plus the wildcard fallback.
//
// Use this on v5 query endpoints where a single request may touch multiple
// signals (e.g. a join across logs + traces).
type PerSignalResourceDef struct {
	Verb             coretypes.Verb
	Category         coretypes.ActionCategory
	ProjectHeader    string
	SignalsExtractor coretypes.ResourceIDsExtractor
	Selector         coretypes.SelectorFunc
}

func (def PerSignalResourceDef) resolveRequest(ec coretypes.ExtractorContext) []coretypes.ResolvedResource {
	if ec.Request == nil {
		return nil
	}
	headerVal := ec.Request.Header.Get(def.ProjectHeader)
	if headerVal == "" {
		return nil
	}
	headerParts := strings.SplitN(headerVal, ":", 2)
	if len(headerParts) != 2 || headerParts[0] == "" || headerParts[1] == "" {
		return nil
	}
	projectSlug, logType := headerParts[0], headerParts[1]

	signals, ok := def.SignalsExtractor.RunFor(coretypes.PhaseRequest, ec)
	if !ok || len(signals) == 0 {
		return nil
	}

	out := make([]coretypes.ResolvedResource, 0, len(signals))
	for _, signal := range signals {
		resource, err := coretypes.ResourceForSignal(signal)
		if err != nil {
			// Skip unknown signals; the handler will surface a 400 anyway.
			continue
		}
		id := projectSlug + ":" + signal + ":" + logType
		out = append(out, coretypes.NewResolvedResourceWithID(
			def.Verb,
			def.Category,
			resource,
			id,
			def.Selector,
			ec,
		))
	}
	return out
}

// AttachDetachSiblingResourceDef checks an attach/detach between peer resources;
// both source and target are authz-checked.
type AttachDetachSiblingResourceDef struct {
	Verb           coretypes.Verb
	Category       coretypes.ActionCategory
	SourceResource coretypes.Resource
	SourceIDs      coretypes.ResourceIDsExtractor
	SourceSelector coretypes.SelectorFunc
	TargetResource coretypes.Resource
	TargetIDs      coretypes.ResourceIDsExtractor
	TargetSelector coretypes.SelectorFunc
}

func (def AttachDetachSiblingResourceDef) resolveRequest(ec coretypes.ExtractorContext) []coretypes.ResolvedResource {
	return []coretypes.ResolvedResource{
		coretypes.NewResolvedResourceWithTarget(
			def.Verb,
			def.Category,
			def.SourceResource,
			def.SourceIDs,
			def.SourceSelector,
			def.TargetResource,
			def.TargetIDs,
			def.TargetSelector,
			false,
			ec,
		),
	}
}

// AttachDetachParentChildResourceDef authz-checks only the parent; the child
// rides along for audit context.
type AttachDetachParentChildResourceDef struct {
	Verb           coretypes.Verb
	Category       coretypes.ActionCategory
	ParentResource coretypes.Resource
	ParentID       coretypes.ResourceIDExtractor
	ParentSelector coretypes.SelectorFunc
	ChildResource  coretypes.Resource
	ChildIDs       coretypes.ResourceIDsExtractor
}

func (def AttachDetachParentChildResourceDef) resolveRequest(ec coretypes.ExtractorContext) []coretypes.ResolvedResource {
	return []coretypes.ResolvedResource{
		coretypes.NewResolvedResourceWithTarget(
			def.Verb,
			def.Category,
			def.ParentResource,
			coretypes.OneID(def.ParentID),
			def.ParentSelector,
			def.ChildResource,
			def.ChildIDs,
			nil,
			true,
			ec,
		),
	}
}
