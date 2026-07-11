package querier

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/SigNoz/signoz/pkg/analytics"
	"github.com/SigNoz/signoz/pkg/errors"
	"github.com/SigNoz/signoz/pkg/factory"
	"github.com/SigNoz/signoz/pkg/http/binding"
	"github.com/SigNoz/signoz/pkg/http/render"
	"github.com/SigNoz/signoz/pkg/modules/user"
	"github.com/SigNoz/signoz/pkg/types/authtypes"
	"github.com/SigNoz/signoz/pkg/types/ctxtypes"
	"github.com/SigNoz/signoz/pkg/types/instrumentationtypes"
	qbtypes "github.com/SigNoz/signoz/pkg/types/querybuildertypes/querybuildertypesv5"
	"github.com/SigNoz/signoz/pkg/types/telemetrytypes"
	"github.com/SigNoz/signoz/pkg/valuer"
	"github.com/SigNoz/signoz/pkg/variables"
)

type handler struct {
	set        factory.ProviderSettings
	analytics  analytics.Analytics
	querier    Querier
	userGetter user.Getter
}

func NewHandler(set factory.ProviderSettings, querier Querier, analytics analytics.Analytics, userGetter user.Getter) Handler {
	return &handler{set: set, querier: querier, analytics: analytics, userGetter: userGetter}
}

func (handler *handler) QueryRange(rw http.ResponseWriter, req *http.Request) {
	ctx := req.Context()
	ctx = ctxtypes.NewContextWithCommentVals(ctx, map[string]string{
		instrumentationtypes.CodeNamespace:    "querier",
		instrumentationtypes.CodeFunctionName: "QueryRange",
	})

	claims, err := authtypes.ClaimsFromContext(ctx)
	if err != nil {
		render.Error(rw, err)
		return
	}

	var queryRangeRequest qbtypes.QueryRangeRequest
	if err := binding.JSON.BindBody(req.Body, &queryRangeRequest); err != nil {
		render.Error(rw, err)
		return
	}

	// Validate the query request
	if err := queryRangeRequest.Validate(); err != nil {
		render.Error(rw, err)
		return
	}

	orgID, err := valuer.NewUUID(claims.OrgID)
	if err != nil {
		render.Error(rw, err)
		return
	}

	if err := handler.restrictQueryRequest(ctx, &queryRangeRequest); err != nil {
		render.Error(rw, err)
		return
	}

	queryRangeResponse, err := handler.querier.QueryRange(ctx, orgID, &queryRangeRequest)
	if err != nil {
		render.Error(rw, err)
		return
	}

	handler.logEvent(req.Context(), req.Header.Get("Referer"), queryRangeResponse.QBEvent)

	render.Success(rw, http.StatusOK, queryRangeResponse)
}

// QueryRangePreview is the dry-run counterpart of QueryRange: it validates and
// renders each query without executing it.
func (handler *handler) QueryRangePreview(rw http.ResponseWriter, req *http.Request) {
	ctx := req.Context()
	ctx = ctxtypes.NewContextWithCommentVals(ctx, map[string]string{
		instrumentationtypes.CodeNamespace:    "querier",
		instrumentationtypes.CodeFunctionName: "QueryRangePreview",
	})

	claims, err := authtypes.ClaimsFromContext(ctx)
	if err != nil {
		render.Error(rw, err)
		return
	}

	var queryRangeRequest qbtypes.QueryRangeRequest
	if err := json.NewDecoder(req.Body).Decode(&queryRangeRequest); err != nil {
		render.Error(rw, err)
		return
	}

	// Validation is deferred to QueryRangePreview, which reports per-query
	// errors instead of failing fast.

	orgID, err := valuer.NewUUID(claims.OrgID)
	if err != nil {
		render.Error(rw, err)
		return
	}

	previewParams := qbtypes.QueryRangePreviewParams{Verbose: req.URL.Query().Get("verbose")}
	previewOpts, err := previewParams.Validate()
	if err != nil {
		render.Error(rw, err)
		return
	}

	if err := handler.restrictQueryRequest(ctx, &queryRangeRequest); err != nil {
		render.Error(rw, err)
		return
	}

	preview, err := handler.querier.QueryRangePreview(ctx, orgID, &queryRangeRequest, previewOpts)
	if err != nil {
		render.Error(rw, err)
		return
	}

	render.Success(rw, http.StatusOK, preview)
}

func (handler *handler) QueryRawStream(rw http.ResponseWriter, req *http.Request) {
	ctx := req.Context()

	// get the param from url and add it to body
	startParam := req.URL.Query().Get("start")
	filterParam := req.URL.Query().Get("filter")

	start, err := strconv.ParseUint(startParam, 10, 64)
	if err != nil {
		start = 0
	}
	// create the v5 request param
	queryRangeRequest := qbtypes.QueryRangeRequest{
		Start:       start,
		RequestType: qbtypes.RequestTypeRawStream,
		CompositeQuery: qbtypes.CompositeQuery{
			Queries: []qbtypes.QueryEnvelope{
				{
					Type: qbtypes.QueryTypeBuilder,
					Spec: qbtypes.QueryBuilderQuery[qbtypes.LogAggregation]{
						Signal: telemetrytypes.SignalLogs,
						Name:   "raw_stream",
						Filter: &qbtypes.Filter{
							Expression: filterParam,
						},
						Limit: 500,
						Order: []qbtypes.OrderBy{
							{
								Direction: qbtypes.OrderDirectionDesc,
								Key: qbtypes.OrderByKey{
									TelemetryFieldKey: telemetrytypes.TelemetryFieldKey{
										Name:         "timestamp",
										Materialized: true,
									},
								},
							},
							{
								Direction: qbtypes.OrderDirectionDesc,
								Key: qbtypes.OrderByKey{
									TelemetryFieldKey: telemetrytypes.TelemetryFieldKey{
										Name:         "id",
										Materialized: true,
									},
								},
							},
						},
					},
				},
			},
		},
	}

	claims, err := authtypes.ClaimsFromContext(ctx)
	if err != nil {
		render.Error(rw, err)
		return
	}

	// Validate the query request
	if err := queryRangeRequest.Validate(); err != nil {
		render.Error(rw, err)
		return
	}

	orgID, err := valuer.NewUUID(claims.OrgID)
	if err != nil {
		render.Error(rw, err)
		return
	}

	if err := handler.restrictQueryRequest(ctx, &queryRangeRequest); err != nil {
		render.Error(rw, err)
		return
	}

	rw.Header().Set("Connection", "keep-alive")
	rw.Header().Set("Content-Type", "text/event-stream")
	rw.Header().Set("Cache-Control", "no-cache")
	rw.Header().Set("Access-Control-Allow-Origin", "*")
	rw.WriteHeader(200)

	flusher, ok := rw.(http.Flusher)
	if !ok {
		render.Error(rw, errors.Newf(errors.TypeUnsupported, errors.CodeUnsupported, "streaming is not supported"))
		return
	}
	flusher.Flush()

	client := &qbtypes.RawStream{Name: req.RemoteAddr, Logs: make(chan *qbtypes.RawRow, 1000), Done: make(chan *bool), Error: make(chan error)}
	go handler.querier.QueryRawStream(ctx, orgID, &queryRangeRequest, client)

	for {
		select {
		case log := <-client.Logs:
			var buf bytes.Buffer
			enc := json.NewEncoder(&buf)
			err := enc.Encode(log)
			if err != nil {
				fmt.Fprintf(rw, "event: error\ndata: %v\n\n", err.Error())
				flusher.Flush()
				return
			}
			fmt.Fprintf(rw, "data: %v\n\n", buf.String())
			flusher.Flush()
		case <-client.Done:
			return
		case err := <-client.Error:
			fmt.Fprintf(rw, "event: error\ndata: %v\n\n", err.Error())
			flusher.Flush()
			return
		}
	}
}

// TODO(srikanthccv): everything done here can be done on frontend as well
// For the time being I am adding a helper function.
func (handler *handler) ReplaceVariables(rw http.ResponseWriter, req *http.Request) {

	var queryRangeRequest qbtypes.QueryRangeRequest
	if err := binding.JSON.BindBody(req.Body, &queryRangeRequest); err != nil {
		render.Error(rw, err)
		return
	}

	errs := []error{}

	for idx, item := range queryRangeRequest.CompositeQuery.Queries {
		if item.Type == qbtypes.QueryTypeBuilder {
			switch spec := item.Spec.(type) {
			case qbtypes.QueryBuilderQuery[qbtypes.LogAggregation]:
				if spec.Filter != nil && spec.Filter.Expression != "" {
					replaced, err := variables.ReplaceVariablesInExpression(spec.Filter.Expression, queryRangeRequest.Variables)
					if err != nil {
						errs = append(errs, err)
					}
					spec.Filter.Expression = replaced
				}
				queryRangeRequest.CompositeQuery.Queries[idx].Spec = spec
			case qbtypes.QueryBuilderQuery[qbtypes.TraceAggregation]:
				if spec.Filter != nil && spec.Filter.Expression != "" {
					replaced, err := variables.ReplaceVariablesInExpression(spec.Filter.Expression, queryRangeRequest.Variables)
					if err != nil {
						errs = append(errs, err)
					}
					spec.Filter.Expression = replaced
				}
				queryRangeRequest.CompositeQuery.Queries[idx].Spec = spec
			case qbtypes.QueryBuilderQuery[qbtypes.MetricAggregation]:
				if spec.Filter != nil && spec.Filter.Expression != "" {
					replaced, err := variables.ReplaceVariablesInExpression(spec.Filter.Expression, queryRangeRequest.Variables)
					if err != nil {
						errs = append(errs, err)
					}
					spec.Filter.Expression = replaced
				}
				queryRangeRequest.CompositeQuery.Queries[idx].Spec = spec
			}
		}
	}

	if len(errs) != 0 {
		render.Error(rw, errors.New(errors.TypeInvalidInput, errors.CodeInvalidInput, errors.Join(errs...).Error()))
		return
	}

	render.Success(rw, http.StatusOK, queryRangeRequest)
}

func (handler *handler) logEvent(ctx context.Context, referrer string, event *qbtypes.QBEvent) {
	claims, err := authtypes.ClaimsFromContext(ctx)
	if err != nil {
		return
	}

	if !event.LogsUsed && !event.MetricsUsed && !event.TracesUsed {
		return
	}

	properties := map[string]any{
		"version":           event.Version,
		"logs_used":         event.LogsUsed,
		"traces_used":       event.TracesUsed,
		"metrics_used":      event.MetricsUsed,
		"source":            event.Source,
		"filter_applied":    event.FilterApplied,
		"group_by_applied":  event.GroupByApplied,
		"query_type":        event.QueryType,
		"panel_type":        event.PanelType,
		"number_of_queries": event.NumberOfQueries,
	}

	if referrer == "" {
		return
	}

	comments := ctxtypes.CommentFromContext(ctx).Map()
	for key, value := range comments {
		properties[key] = value
	}

	if !event.HasData {
		handler.analytics.TrackUser(ctx, claims.OrgID, claims.IdentityID(), "Telemetry Query Returned Empty", properties)
		return
	}

	handler.analytics.TrackUser(ctx, claims.OrgID, claims.IdentityID(), "Telemetry Query Returned Results", properties)
}

func (handler *handler) restrictQueryRequest(ctx context.Context, req *qbtypes.QueryRangeRequest) error {
	if req == nil {
		return nil
	}

	unrestricted, _, err := handler.getAllowedProjects(ctx)
	if err != nil {
		return err
	}

	if unrestricted {
		return nil
	}

	claims, err := authtypes.ClaimsFromContext(ctx)
	if err != nil {
		return nil
	}
	if claims.UserID == "" {
		return nil
	}
	userUUID, err := valuer.NewUUID(claims.UserID)
	if err != nil {
		return nil
	}
	userRoles, err := handler.userGetter.GetRolesByUserID(ctx, userUUID)
	if err != nil {
		return err
	}

	allowedLogServices := make(map[string]*authtypes.LogScope)
	hasAllProjectsLogAccess := false
	var allProjectsLogScope *authtypes.LogScope

	allowedTraceServices := make(map[string]struct{})
	hasAllProjectsTraceAccess := false

	for _, ur := range userRoles {
		if ur.Role == nil {
			continue
		}
		records, err := ur.Role.ExtractProjectPermissions()
		if err != nil {
			continue
		}
		for _, record := range records {
			if record.Logs == "read" {
				if record.IsAllProjects() {
					hasAllProjectsLogAccess = true
					allProjectsLogScope = record.LogScope
				} else {
					allowedLogServices[record.Project] = record.LogScope
				}
			}
			if record.Traces == "read" || record.Traces == "write" {
				if record.IsAllProjects() {
					hasAllProjectsTraceAccess = true
				} else {
					allowedTraceServices[record.Project] = struct{}{}
				}
			}
		}
	}

	for i, qEnvelope := range req.CompositeQuery.Queries {
		if qEnvelope.Type != qbtypes.QueryTypeBuilder {
			continue
		}

		switch spec := qEnvelope.Spec.(type) {
		case qbtypes.QueryBuilderQuery[qbtypes.LogAggregation]:
			handler.applyLogServiceRestriction(&spec, allowedLogServices, hasAllProjectsLogAccess, allProjectsLogScope)
			req.CompositeQuery.Queries[i].Spec = spec
		case qbtypes.QueryBuilderQuery[qbtypes.TraceAggregation]:
			handler.applyTraceServiceRestriction(&spec, allowedTraceServices, hasAllProjectsTraceAccess)
			req.CompositeQuery.Queries[i].Spec = spec
		}
	}

	return nil
}

// applyLogServiceRestriction mutates spec to restrict results to the
// services (and log_type scopes) the user is allowed to read.
func (handler *handler) applyLogServiceRestriction(
	spec *qbtypes.QueryBuilderQuery[qbtypes.LogAggregation],
	allowedLogServices map[string]*authtypes.LogScope,
	hasAllProjectsLogAccess bool,
	allProjectsLogScope *authtypes.LogScope,
) {
	if hasAllProjectsLogAccess {
		if allProjectsLogScope != nil && allProjectsLogScope.Type == "specific" && allProjectsLogScope.Value != "" {
			scopeCond := fmt.Sprintf("log_type = '%s'", strings.ReplaceAll(allProjectsLogScope.Value, "'", "\\'"))
			if spec.Filter == nil {
				spec.Filter = &qbtypes.Filter{Expression: scopeCond}
			} else if spec.Filter.Expression != "" {
				spec.Filter.Expression = fmt.Sprintf("(%s) AND (%s)", spec.Filter.Expression, scopeCond)
			} else {
				spec.Filter.Expression = scopeCond
			}
		}
		return
	}

	allowedSvcs := make([]string, 0, len(allowedLogServices))
	for svc := range allowedLogServices {
		allowedSvcs = append(allowedSvcs, svc)
	}

	serviceCondition := buildServiceNameCondition(allowedSvcs)
	if serviceCondition != "" {
		specificScopes, hasAllScope := collectLogScopes(allowedLogServices, allowedSvcs)
		if !hasAllScope && len(specificScopes) > 0 {
			serviceCondition += fmt.Sprintf(" AND log_type IN (%s)", strings.Join(specificScopes, ", "))
		}
	}

	combineWithExistingFilter(spec, serviceCondition)
}

// applyTraceServiceRestriction mutates spec to restrict results to the
// services the user is allowed to read traces for. Traces have no log_type
// dimension, so only service.name is constrained.
func (handler *handler) applyTraceServiceRestriction(
	spec *qbtypes.QueryBuilderQuery[qbtypes.TraceAggregation],
	allowedTraceServices map[string]struct{},
	hasAllProjectsTraceAccess bool,
) {
	if hasAllProjectsTraceAccess {
		return
	}

	allowedSvcs := make([]string, 0, len(allowedTraceServices))
	for svc := range allowedTraceServices {
		allowedSvcs = append(allowedSvcs, svc)
	}

	serviceCondition := buildServiceNameCondition(allowedSvcs)
	combineWithExistingFilterForTrace(spec, serviceCondition)
}

// buildServiceNameCondition returns the SQL fragment for the service.name
// constraint, or a sentinel `___NO_ACCESS___` match when the user has no
// allowed services.
func buildServiceNameCondition(allowedSvcs []string) string {
	if len(allowedSvcs) == 0 {
		return "service.name = '___NO_ACCESS___'"
	}
	if len(allowedSvcs) == 1 {
		return fmt.Sprintf("service.name = '%s'", strings.ReplaceAll(allowedSvcs[0], "'", "\\'"))
	}
	escaped := make([]string, 0, len(allowedSvcs))
	for _, s := range allowedSvcs {
		escaped = append(escaped, fmt.Sprintf("'%s'", strings.ReplaceAll(s, "'", "\\'")))
	}
	return fmt.Sprintf("service.name IN (%s)", strings.Join(escaped, ", "))
}

// collectLogScopes returns the set of log_type values for svcs when all
// scopes are specific. If any service has an "all" / unset scope, returns
// hasAllScope=true and the caller should not constrain log_type.
func collectLogScopes(allowed map[string]*authtypes.LogScope, svcs []string) ([]string, bool) {
	specific := make([]string, 0, len(svcs))
	for _, svc := range svcs {
		scope := allowed[svc]
		if scope == nil || scope.Type == "all" || scope.Value == "" {
			return nil, true
		}
		specific = append(specific, fmt.Sprintf("'%s'", strings.ReplaceAll(scope.Value, "'", "\\'")))
	}
	return specific, false
}

// combineWithExistingFilter AND-combines serviceCondition with any existing
// filter expression on the logs spec.
func combineWithExistingFilter(spec *qbtypes.QueryBuilderQuery[qbtypes.LogAggregation], serviceCondition string) {
	if serviceCondition == "" {
		return
	}
	if spec.Filter == nil {
		spec.Filter = &qbtypes.Filter{Expression: serviceCondition}
		return
	}
	if spec.Filter.Expression != "" {
		spec.Filter.Expression = fmt.Sprintf("(%s) AND (%s)", spec.Filter.Expression, serviceCondition)
		return
	}
	spec.Filter.Expression = serviceCondition
}

// combineWithExistingFilterForTrace mirrors combineWithExistingFilter for
// the trace spec.
func combineWithExistingFilterForTrace(spec *qbtypes.QueryBuilderQuery[qbtypes.TraceAggregation], serviceCondition string) {
	if serviceCondition == "" {
		return
	}
	if spec.Filter == nil {
		spec.Filter = &qbtypes.Filter{Expression: serviceCondition}
		return
	}
	if spec.Filter.Expression != "" {
		spec.Filter.Expression = fmt.Sprintf("(%s) AND (%s)", spec.Filter.Expression, serviceCondition)
		return
	}
	spec.Filter.Expression = serviceCondition
}

func (handler *handler) getAllowedProjects(ctx context.Context) (unrestricted bool, allowedProjects map[string]bool, err error) {
	if handler.userGetter == nil {
		return true, nil, nil
	}
	access, err := authtypes.GetUserAllowedProjects(ctx, handler.userGetter)
	if err != nil {
		return false, nil, err
	}
	return access.Unrestricted, access.Allowed, nil
}
