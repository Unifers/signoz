package coretypes

import (
	"net/http"

	"github.com/gorilla/mux"
	"github.com/tidwall/gjson"
)

const (
	PhaseRequest ExtractPhase = iota
	PhaseResponse
)

type ExtractPhase int

// ExtractorContext carries everything an extractor may read: Request + RequestBody
// are filled pre-handler, ResponseBody post-handler.
type ExtractorContext struct {
	Request      *http.Request
	RequestBody  []byte
	ResponseBody []byte
}

type ResourceIDExtractor struct {
	Phase ExtractPhase
	Fn    func(ExtractorContext) (string, error)
}

type ResourceIDsExtractor struct {
	Phase ExtractPhase
	Fn    func(ExtractorContext) ([]string, error)
}

func (extractor ResourceIDExtractor) IsPhase(phase ExtractPhase) bool {
	return extractor.Fn != nil && extractor.Phase == phase
}

func (extractor ResourceIDExtractor) RunFor(phase ExtractPhase, ec ExtractorContext) (string, bool) {
	if !extractor.IsPhase(phase) {
		return "", false
	}

	id, _ := extractor.Fn(ec)
	return id, true
}

func (extractor ResourceIDsExtractor) IsPhase(phase ExtractPhase) bool {
	return extractor.Fn != nil && extractor.Phase == phase
}

func (extractor ResourceIDsExtractor) RunFor(phase ExtractPhase, ec ExtractorContext) ([]string, bool) {
	if !extractor.IsPhase(phase) {
		return nil, false
	}

	ids, _ := extractor.Fn(ec)
	return ids, true
}

// OneID lifts a single-id extractor into a one-element ids extractor.
func OneID(extractor ResourceIDExtractor) ResourceIDsExtractor {
	return ResourceIDsExtractor{Phase: extractor.Phase, Fn: func(ec ExtractorContext) ([]string, error) {
		id, err := extractor.Fn(ec)
		if err != nil || id == "" {
			return nil, err
		}
		return []string{id}, nil
	}}
}

func PathParam(name string) ResourceIDExtractor {
	return ResourceIDExtractor{Phase: PhaseRequest, Fn: func(ec ExtractorContext) (string, error) {
		if ec.Request == nil {
			return "", nil
		}
		return mux.Vars(ec.Request)[name], nil
	}}
}

// HeaderExtractor reads a single request header value as the resource id.
// Returns empty string if the request is nil or the header is missing.
func HeaderExtractor(name string) ResourceIDExtractor {
	return ResourceIDExtractor{Phase: PhaseRequest, Fn: func(ec ExtractorContext) (string, error) {
		if ec.Request == nil {
			return "", nil
		}
		return ec.Request.Header.Get(name), nil
	}}
}

// QueryParamExtractor reads a single URL query parameter as the resource id.
// Returns empty string if the request is nil or the query param is missing.
func QueryParamExtractor(name string) ResourceIDExtractor {
	return ResourceIDExtractor{Phase: PhaseRequest, Fn: func(ec ExtractorContext) (string, error) {
		if ec.Request == nil {
			return "", nil
		}
		return ec.Request.URL.Query().Get(name), nil
	}}
}

func BodyJSONPath(path string) ResourceIDExtractor {
	return ResourceIDExtractor{Phase: PhaseRequest, Fn: func(ec ExtractorContext) (string, error) {
		return gjson.GetBytes(ec.RequestBody, path).String(), nil
	}}
}

func BodyJSONArray(path string) ResourceIDsExtractor {
	return ResourceIDsExtractor{Phase: PhaseRequest, Fn: func(ec ExtractorContext) ([]string, error) {
		result := gjson.GetBytes(ec.RequestBody, path)
		if !result.Exists() {
			return nil, nil
		}

		array := result.Array()
		ids := make([]string, 0, len(array))
		for _, r := range array {
			ids = append(ids, r.String())
		}

		return ids, nil
	}}
}

// V5QuerySignalsExtractor returns the unique telemetry signals referenced in
// a v5 query_range body. It walks the compositeQuery.queries[*].spec.signal
// fields and dedupes. SQL/PromQL queries are ignored — those resolve to the
// source signal stored in the spec.source signal if present.
//
// Returns nil when no signals can be parsed (caller should treat that as
// "no project-gating required", which preserves the existing
// role-gated behavior for unparseable bodies).
func V5QuerySignalsExtractor() ResourceIDsExtractor {
	return ResourceIDsExtractor{Phase: PhaseRequest, Fn: func(ec ExtractorContext) ([]string, error) {
		results := gjson.GetBytes(ec.RequestBody, "compositeQuery.queries.#.spec.signal")
		if !results.Exists() {
			return nil, nil
		}
		seen := map[string]struct{}{}
		out := make([]string, 0, 3)
		for _, r := range results.Array() {
			s := r.String()
			if s == "" {
				continue
			}
			if _, ok := seen[s]; ok {
				continue
			}
			seen[s] = struct{}{}
			out = append(out, s)
		}
		return out, nil
	}}
}

func ResponseJSONPath(path string) ResourceIDExtractor {
	return ResourceIDExtractor{Phase: PhaseResponse, Fn: func(ec ExtractorContext) (string, error) {
		return gjson.GetBytes(ec.ResponseBody, path).String(), nil
	}}
}
