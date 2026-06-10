package querier

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"slices"
	"strings"
	"sync"

	chproto "github.com/ClickHouse/ch-go/proto"
	"github.com/ClickHouse/clickhouse-go/v2"

	"github.com/SigNoz/signoz/pkg/errors"
	"github.com/SigNoz/signoz/pkg/querybuilder"
	qbtypes "github.com/SigNoz/signoz/pkg/types/querybuildertypes/querybuildertypesv5"
	"github.com/SigNoz/signoz/pkg/types/telemetrytypes"
	"github.com/SigNoz/signoz/pkg/valuer"
)

// statementProvider is implemented by query types that can render the
// underlying SQL/PromQL statement without executing it.
type statementProvider interface {
	Statement(ctx context.Context) (*qbtypes.Statement, error)
}

// missingMetricNames returns the distinct metric names referenced by a metric
// builder query, in order of first appearance. It is used to name the metric(s)
// in the warning attached to a fully-missing-metric query. Returns nil for any
// non-metric query.
func missingMetricNames(env qbtypes.QueryEnvelope) []string {
	spec, ok := env.Spec.(qbtypes.QueryBuilderQuery[qbtypes.MetricAggregation])
	if !ok {
		return nil
	}
	names := make([]string, 0, len(spec.Aggregations))
	for _, agg := range spec.Aggregations {
		if agg.MetricName != "" && !slices.Contains(names, agg.MetricName) {
			names = append(names, agg.MetricName)
		}
	}
	return names
}

// ParseVerbose parses the ?verbose= query parameter. It defaults to TRUE: the
// full preview — rendered ClickHouse statement(s) with each statement's EXPLAIN
// ESTIMATE and granule index analysis, plus the top-level scores — is returned
// unless explicitly disabled with verbose=false, which gives the lightweight
// verdict-only preview (valid/error/warnings per query, no ClickHouse round trips).
func ParseVerbose(value string) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "true", "1":
		return true, nil
	case "false", "0":
		return false, nil
	}
	return false, errors.NewInvalidInputf(errors.CodeInvalidInput, "invalid verbose value %q (allowed: true, false)", value)
}

// QueryRangePreview validates each query in the composite query without
// executing it. With opts.Verbose=false it returns a lightweight per-query
// verdict (valid/error/warnings). With opts.Verbose=true it also renders the
// underlying ClickHouse statement(s) each query would run and attaches, per
// statement, the EXPLAIN ESTIMATE and granule index analysis, deriving the
// top-level SelectivityScore and MagnitudeScore.
func (q *querier) QueryRangePreview(
	ctx context.Context,
	_ valuer.UUID,
	req *qbtypes.QueryRangeRequest,
	opts qbtypes.QueryRangePreviewOptions,
) (*qbtypes.QueryRangePreviewResponse, error) {

	// The preview must transform the payload exactly as QueryRange does so the
	// rendered SQL matches what the same payload will actually execute. Coerce
	// the window to epoch milliseconds up front, just like QueryRange.
	req.Start = querybuilder.ToMilliSecs(req.Start)
	req.End = querybuilder.ToMilliSecs(req.End)

	tmplVars := req.Variables
	if tmplVars == nil {
		tmplVars = make(map[string]qbtypes.VariableItem)
	}

	// Validate request-level invariants (time range, request type, unique
	// names, …) up front — these are request-wide, so there is nothing per
	// query to preview if they fail. Per-query spec validation is deliberately
	// NOT done here: it runs per query below so each query's structural error is
	// reported in its own QueryPreview instead of aborting the whole
	// preview on the first one. validationOpts carries the request-type-specific
	// options into that per-query validation.
	validationOpts, err := req.ValidateRequestScope()
	if err != nil {
		return nil, err
	}

	// Queries that only feed a trace operator (e.g. A and B in C := A => B) are
	// not executed standalone by QueryRange. The dry-run, by contrast, still
	// previews each of them on its own so the caller can see *which* sub-query of
	// a trace operator is the bad one instead of getting a single opaque failure
	// on C. The map identifies those dependencies; their rendering is specialized
	// below (see requestType).
	dependencyQueries, err := q.constructTraceOperatorDependencyMap(req.CompositeQuery.Queries)
	if err != nil {
		return nil, err
	}

	results := make(map[string]qbtypes.QueryPreview, len(req.CompositeQuery.Queries))

	// Phase 1: normalize every query's spec (step interval + metric metadata)
	// and capture the per-query warnings/errors. This runs for ALL queries —
	// including trace-operator dependencies — before any statement is rendered,
	// because a trace-operator query reads its siblings' specs at render time
	// and they must already be normalized. adjustStepInterval and
	// resolveMetricMetadata both patch the spec in place, so feed each a
	// single-element slice and write the patched envelope back into the
	// composite query. Doing it per-query (rather than once over all queries
	// like QueryRange) lets us attribute each warning/error to the query that
	// produced it, which is the whole point of a per-query preview report; the
	// extra metadata lookups are acceptable on this low-volume dry-run path.
	prepared := make(map[string]qbtypes.QueryPreview, len(req.CompositeQuery.Queries))
	missingMetricQuerySet := make(map[string]bool)
	for idx := range req.CompositeQuery.Queries {
		name := req.CompositeQuery.Queries[idx].GetQueryName()
		ps := qbtypes.QueryPreview{}

		// Validate this query's spec on its own and attribute any structural
		// error to it, instead of aborting the whole preview on the first bad
		// query (the request-level invariants were already checked above). An
		// invalid spec gets no step/metadata normalization or rendering.
		if vErr := req.CompositeQuery.Queries[idx].Validate(validationOpts...); vErr != nil {
			ps.Error = vErr
			prepared[name] = ps
			continue
		}

		env := []qbtypes.QueryEnvelope{req.CompositeQuery.Queries[idx]}
		ps.Warnings = q.adjustStepInterval(env, req.Start, req.End)

		missingMetricQueries, dormantMetricsWarningMsg, mErr := q.resolveMetricMetadata(ctx, env, req.Start, req.End)
		if mErr != nil {
			// Don't abort the whole preview: report this query's error and keep
			// going so the agent sees every problem in one round trip.
			ps.Error = mErr
		} else {
			if dormantMetricsWarningMsg != "" {
				ps.Warnings = append(ps.Warnings, dormantMetricsWarningMsg)
			}
			if len(missingMetricQueries) > 0 {
				missingMetricQuerySet[name] = true
				// A fully-missing-metric query renders no SQL and returns an empty
				// result, so flag it explicitly. resolveMetricMetadata only emits a
				// (dormant) warning for external metrics it has seen before; when it
				// stays silent — e.g. internal signoz.* metrics — the empty result
				// would otherwise be unexplained, so attach a clear note naming the
				// metric(s) the agent referenced.
				if dormantMetricsWarningMsg == "" {
					if metricNames := missingMetricNames(env[0]); len(metricNames) > 0 {
						ps.Warnings = append(ps.Warnings, fmt.Sprintf(
							"query %q references metric(s) %s with no data available; it will return an empty result",
							name, strings.Join(metricNames, ", ")))
					}
				}
			}
		}

		req.CompositeQuery.Queries[idx] = env[0]
		prepared[name] = ps
	}

	// Phase 2: render the statement for each query that actually executes, and
	// collect the ClickHouse-bound work (granules/estimate analyses) to run concurrently.
	var previewTasks []previewTask
	for _, query := range req.CompositeQuery.Queries {
		name := query.GetQueryName()

		// A trace-operator dependency is previewed on its own (so the caller sees
		// which sub-query is bad), but it must be rendered the way the operator
		// actually consumes it: only the sub-query's span *selection* (its filter)
		// feeds the operator's CTE — aggregation/group-by/order run later on the
		// combined result, not per sub-query (see the trace operator CTE builder).
		// So render a dependency as a RequestTypeRaw span selection, mirroring that
		// CTE, rather than with the request's own type (which would validate
		// aggregations the operator never applies to it). For every other query
		// (including the trace operator itself) the request's type is used.
		requestType := req.RequestType
		if query.GetType() != qbtypes.QueryTypeTraceOperator && dependencyQueries[name] {
			requestType = qbtypes.RequestTypeRaw
		}

		ps := prepared[name]

		// Surface a phase-1 error (e.g. a not-found metric) without rendering.
		if ps.Error != nil {
			results[name] = ps
			continue
		}
		// Every aggregation resolved to a missing metric: QueryRange returns an
		// empty result for this query and renders no SQL. Mirror that.
		if missingMetricQuerySet[name] {
			results[name] = ps
			continue
		}

		var provider qbtypes.Query
		switch query.Type {
		case qbtypes.QueryTypePromQL:
			promQuery, ok := query.Spec.(qbtypes.PromQuery)
			if !ok {
				ps.Error = errors.NewInvalidInputf(errors.CodeInvalidInput, "invalid promql query spec %T", query.Spec)
				results[name] = ps
				continue
			}
			provider = newPromqlQuery(q.logger, q.promEngine, promQuery, qbtypes.TimeRange{From: req.Start, To: req.End}, requestType, tmplVars)
		case qbtypes.QueryTypeClickHouseSQL:
			chQuery, ok := query.Spec.(qbtypes.ClickHouseQuery)
			if !ok {
				ps.Error = errors.NewInvalidInputf(errors.CodeInvalidInput, "invalid clickhouse query spec %T", query.Spec)
				results[name] = ps
				continue
			}
			provider = newchSQLQuery(q.logger, q.telemetryStore, chQuery, nil, qbtypes.TimeRange{From: req.Start, To: req.End}, requestType, tmplVars)
		case qbtypes.QueryTypeTraceOperator:
			traceOpQuery, ok := query.Spec.(qbtypes.QueryBuilderTraceOperator)
			if !ok {
				ps.Error = errors.NewInvalidInputf(errors.CodeInvalidInput, "invalid trace operator query spec %T", query.Spec)
				results[name] = ps
				continue
			}
			provider = &traceOperatorQuery{
				telemetryStore: q.telemetryStore,
				stmtBuilder:    q.traceOperatorStmtBuilder,
				spec:           traceOpQuery,
				compositeQuery: &req.CompositeQuery,
				fromMS:         uint64(req.Start),
				toMS:           uint64(req.End),
				kind:           requestType,
			}
		case qbtypes.QueryTypeBuilder:
			switch spec := query.Spec.(type) {
			case qbtypes.QueryBuilderQuery[qbtypes.TraceAggregation]:
				spec.ShiftBy = extractShiftFromBuilderQuery(spec)
				timeRange := adjustTimeRangeForShift(spec, qbtypes.TimeRange{From: req.Start, To: req.End}, requestType)
				provider = newBuilderQuery(q.logger, q.telemetryStore, q.traceStmtBuilder, spec, timeRange, requestType, tmplVars)
			case qbtypes.QueryBuilderQuery[qbtypes.LogAggregation]:
				spec.ShiftBy = extractShiftFromBuilderQuery(spec)
				timeRange := adjustTimeRangeForShift(spec, qbtypes.TimeRange{From: req.Start, To: req.End}, requestType)
				stmtBuilder := q.logStmtBuilder
				if spec.Source == telemetrytypes.SourceAudit {
					stmtBuilder = q.auditStmtBuilder
				}
				provider = newBuilderQuery(q.logger, q.telemetryStore, stmtBuilder, spec, timeRange, requestType, tmplVars)
			case qbtypes.QueryBuilderQuery[qbtypes.MetricAggregation]:
				spec.ShiftBy = extractShiftFromBuilderQuery(spec)
				timeRange := adjustTimeRangeForShift(spec, qbtypes.TimeRange{From: req.Start, To: req.End}, requestType)
				if spec.Source == telemetrytypes.SourceMeter {
					provider = newBuilderQuery(q.logger, q.telemetryStore, q.meterStmtBuilder, spec, timeRange, requestType, tmplVars)
				} else {
					provider = newBuilderQuery(q.logger, q.telemetryStore, q.metricStmtBuilder, spec, timeRange, requestType, tmplVars)
				}
			default:
				ps.Error = errors.NewInvalidInputf(errors.CodeInvalidInput, "unsupported builder spec type %T", query.Spec)
				results[name] = ps
				continue
			}
		default:
			ps.Error = errors.NewInvalidInputf(errors.CodeInvalidInput, "unsupported query type %q", query.Type)
			results[name] = ps
			continue
		}

		stmtProvider, ok := provider.(statementProvider)
		if !ok {
			ps.Error = errors.NewInternalf(errors.CodeInternal, "query does not support preview")
			results[name] = ps
			continue
		}

		// Build the statement even in validate-only mode: a successful build is
		// the strongest validation we can do (it parses the filter/group-by and
		// resolves fields against the schema), and a build error is exactly the
		// per-query verdict a validation caller wants.
		stmt, sErr := stmtProvider.Statement(ctx)
		if sErr != nil {
			ps.Error = sErr
			results[name] = ps
			continue
		}

		ps.Warnings = append(ps.Warnings, stmt.Warnings...)

		// clickhouse_sql is user-authored raw SQL; rendering only substitutes
		// variables, so by itself it doesn't prove the SQL is valid. Verify it
		// parses and binds (tables/columns/types resolve) via EXPLAIN PLAN —
		// without executing. Builder/PromQL/trace-operator SQL is engine-generated
		// and well-formed by construction, so this is scoped to clickhouse_sql.
		if query.Type == qbtypes.QueryTypeClickHouseSQL {
			if bindErr := q.explainBindCheck(ctx, stmt.Query, stmt.Args); bindErr != nil {
				if errors.Ast(bindErr, errors.TypeInvalidInput) {
					ps.Error = bindErr
					results[name] = ps
					continue
				}
				// Validity unknown (infra/non-user-facing failure) — warn, don't
				// falsely mark the query invalid.
				ps.Warnings = append(ps.Warnings, "could not validate ClickHouse SQL: "+bindErr.Error())
			}
		}

		// The query is fully validated by this point (statement built, plus the
		// clickhouse_sql bind check). In verbose mode, render the underlying
		// statement(s) into the response and attach the EXPLAIN analyses below;
		// otherwise return just the verdict.
		if !opts.Verbose {
			results[name] = ps
			continue
		}

		// Every query exposes its underlying ClickHouse statement(s) uniformly in
		// Statements. Builder/ClickHouse/trace-operator render exactly one; PromQL
		// is not SQL — the Prometheus engine issues one statement per metric
		// selector, captured (without executing) via PreviewStatements.
		if query.Type == qbtypes.QueryTypePromQL {
			if pq, ok := provider.(*promqlQuery); ok {
				sqlStmts, pErr := pq.PreviewStatements(ctx)
				if pErr != nil {
					ps.Warnings = append(ps.Warnings, "could not render underlying ClickHouse SQL: "+pErr.Error())
				} else {
					for _, s := range sqlStmts {
						ps.Statements = append(ps.Statements, qbtypes.PreviewStatement{Query: s.Query, Args: s.Args})
					}
				}
			}
		} else {
			ps.Statements = []qbtypes.PreviewStatement{{Query: stmt.Query, Args: stmt.Args}}
		}

		results[name] = ps

		// The granules and estimate analyses both hit ClickHouse. Queue one task
		// per statement; runPreviewTasks executes them concurrently across queries
		// after rendering, rather than serializing one query's round trips behind
		// the next.
		for j := range ps.Statements {
			previewTasks = append(previewTasks, previewTask{name: name, stmtIdx: j, query: ps.Statements[j].Query, args: ps.Statements[j].Args})
		}
	}

	q.runPreviewTasks(ctx, previewTasks, results)

	// Derive the two headline per-query scores from the rendered statements, each
	// from the worst (heaviest) statement that dominates cost:
	//   - SelectivityScore: the minimum granule SkipScore (selectivity — how good
	//     the index pruning ratio is), when the granules analysis ran.
	//   - MagnitudeScore: the minimum per-statement magnitude score (absolute scan
	//     size — a query can prune 99% and still scan billions), derived from each
	//     statement's estimated rows, when the estimate analysis ran.
	// They are intentionally kept as separate axes, not fused into one number.
	for name, ps := range results {
		var minSelectivity, minMagnitude *float64
		for i := range ps.Statements {
			if g := ps.Statements[i].Granules; g != nil && (minSelectivity == nil || g.SkipScore < *minSelectivity) {
				s := g.SkipScore
				minSelectivity = &s
			}
			if est := ps.Statements[i].Estimate; len(est) > 0 {
				var rows int64
				for j := range est {
					rows += est[j].Rows
				}
				if m := magnitudeScoreFromRows(rows); minMagnitude == nil || m < *minMagnitude {
					minMagnitude = &m
				}
			}
		}
		if minSelectivity != nil {
			ps.SelectivityScore = minSelectivity
		}
		if minMagnitude != nil {
			ps.MagnitudeScore = minMagnitude
		}
		results[name] = ps
	}

	return &qbtypes.QueryRangePreviewResponse{
		CompositeQuery: results,
	}, nil
}

// previewTask is one rendered ClickHouse statement queued for ClickHouse-bound
// preview work (the granules and/or estimate analysis). stmtIdx is the index into
// the query's Statements list that this task's results merge back into.
type previewTask struct {
	name    string
	stmtIdx int
	query   string
	args    []any
}

// runPreviewTasks computes the granules and estimate analysis for each task
// concurrently — every query's ClickHouse round trips are in flight at once
// instead of serialized — and merges the outcomes back into previews. Tasks are
// only queued in verbose mode, so both analyses run for every task. A composite
// query holds only a handful of queries, so a goroutine per task is fine without
// an explicit concurrency bound. Each goroutine writes to its own slot; the
// merge into the previews map happens after the wait, single-threaded, so there
// are no map races.
func (q *querier) runPreviewTasks(ctx context.Context, tasks []previewTask, previews map[string]qbtypes.QueryPreview) {
	if len(tasks) == 0 {
		return
	}

	type outcome struct {
		granules *qbtypes.Granules
		estimate []qbtypes.EstimateEntry
		warnings []string
	}
	outcomes := make([]outcome, len(tasks))

	var wg sync.WaitGroup
	for i := range tasks {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			t := tasks[i]
			var out outcome
			if granules, ok, scErr := q.computeGranuleStats(ctx, t.query, t.args); scErr != nil {
				// Surface the failure instead of silently dropping the score.
				out.warnings = append(out.warnings, "could not compute query score: "+scErr.Error())
			} else if ok {
				out.granules = &granules
			}
			if estimate, eErr := q.runExplainEstimate(ctx, t.query, t.args); eErr != nil {
				// Surface the failure instead of silently dropping the output.
				out.warnings = append(out.warnings, "could not run EXPLAIN ESTIMATE: "+eErr.Error())
			} else {
				out.estimate = estimate
			}
			outcomes[i] = out
		}(i)
	}
	wg.Wait()

	for i := range tasks {
		ps := previews[tasks[i].name]
		if idx := tasks[i].stmtIdx; idx >= 0 && idx < len(ps.Statements) {
			if outcomes[i].granules != nil {
				ps.Statements[idx].Granules = outcomes[i].granules
			}
			if len(outcomes[i].estimate) > 0 {
				ps.Statements[idx].Estimate = outcomes[i].estimate
			}
		}
		ps.Warnings = append(ps.Warnings, outcomes[i].warnings...)
		previews[tasks[i].name] = ps
	}
}

// runExplainEstimate runs `EXPLAIN ESTIMATE <stmt>` and parses its per-table
// estimate into structs. ESTIMATE returns one row per table the query reads,
// with five columns (database, table, parts, rows, marks); the numeric columns
// come back as unsigned integers from the driver. Columns are matched by name
// (not position) so the parse is robust to column reordering.
func (q *querier) runExplainEstimate(ctx context.Context, stmt string, args []any) ([]qbtypes.EstimateEntry, error) {
	rows, err := q.telemetryStore.ClickhouseDB().Query(ctx, "EXPLAIN ESTIMATE "+stmt, args...)
	if err != nil {
		return nil, errors.WrapInternalf(err, errors.CodeInternal, "failed to run EXPLAIN ESTIMATE")
	}
	defer rows.Close()

	colTypes := rows.ColumnTypes()
	var entries []qbtypes.EstimateEntry
	for rows.Next() {
		dest := make([]any, len(colTypes))
		for i, ct := range colTypes {
			dest[i] = reflect.New(ct.ScanType()).Interface()
		}
		if err := rows.Scan(dest...); err != nil {
			return nil, errors.WrapInternalf(err, errors.CodeInternal, "failed to scan EXPLAIN ESTIMATE row")
		}
		var entry qbtypes.EstimateEntry
		for i, ct := range colTypes {
			val := reflect.ValueOf(dest[i]).Elem().Interface()
			switch strings.ToLower(ct.Name()) {
			case "database":
				entry.Database = fmt.Sprintf("%v", val)
			case "table":
				entry.Table = fmt.Sprintf("%v", val)
			case "parts":
				entry.Parts = toInt64(val)
			case "rows":
				entry.Rows = toInt64(val)
			case "marks":
				entry.Marks = toInt64(val)
			}
		}
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, errors.WrapInternalf(err, errors.CodeInternal, "EXPLAIN ESTIMATE row iteration failed")
	}
	return entries, nil
}

// toInt64 coerces a driver-scanned numeric value (ESTIMATE's parts/rows/marks
// arrive as unsigned integers) to int64. A non-numeric value yields 0.
func toInt64(v any) int64 {
	rv := reflect.ValueOf(v)
	switch rv.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return rv.Int()
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return int64(rv.Uint())
	case reflect.Float32, reflect.Float64:
		return int64(rv.Float())
	default:
		return 0
	}
}

// userFacingClickHouseErrorCodes mirrors PR #10679's userFacingCHCodes: the
// ClickHouse error codes that indicate a problem with the query itself (bad SQL,
// unknown table/column, …) rather than a server-side/infra failure — i.e. the
// ones that should map to invalid input (400) instead of internal (500).
//
// TODO(#10679): once that PR lands, delete this and have explainBindCheck call
// the shared querier.mapClickHouseError so there's a single source of truth.
var userFacingClickHouseErrorCodes = map[chproto.Error]bool{
	chproto.ErrSyntaxError:                  true,
	chproto.ErrUnknownTable:                 true,
	chproto.ErrUnknownDatabase:              true,
	chproto.ErrUnknownIdentifier:            true,
	chproto.ErrUnknownFunction:              true,
	chproto.ErrUnknownAggregateFunction:     true,
	chproto.ErrUnknownType:                  true,
	chproto.ErrUnknownStorage:               true,
	chproto.ErrUnknownElementInAst:          true,
	chproto.ErrUnknownTypeOfQuery:           true,
	chproto.ErrIllegalTypeOfArgument:        true,
	chproto.ErrIllegalColumn:                true,
	chproto.ErrNumberOfArgumentsDoesntMatch: true,
	chproto.ErrTooManyArgumentsForFunction:  true,
	chproto.ErrTooLessArgumentsForFunction:  true,
}

// explainBindCheck validates that a rendered ClickHouse statement parses and
// binds (its tables, columns, and types resolve) by running EXPLAIN PLAN against
// it without executing it. It returns:
//
//   - nil: the statement is valid.
//   - an invalid-input error (errors.TypeInvalidInput): ClickHouse rejected the
//     statement with a user-facing error code — genuinely invalid input (syntax,
//     unknown table/column, type mismatch). The caller marks the query invalid.
//   - any other error: the check couldn't run, or ClickHouse failed with a
//     non-user-facing code (e.g. unreachable, timeout, server-side). The caller
//     warns rather than falsely marking the query invalid, since validity is
//     unknown.
//
// The caller distinguishes the two failure modes with errors.Ast(err, errors.TypeInvalidInput).
func (q *querier) explainBindCheck(ctx context.Context, stmt string, args []any) error {
	rows, err := q.telemetryStore.ClickhouseDB().Query(ctx, "EXPLAIN PLAN "+stmt, args...)
	if err != nil {
		var ex *clickhouse.Exception
		if errors.As(err, &ex) && userFacingClickHouseErrorCodes[chproto.Error(ex.Code)] {
			return errors.NewInvalidInputf(errors.CodeInvalidInput, "invalid ClickHouse SQL: %s", ex.Message)
		}
		return err
	}
	rows.Close()
	return nil
}

// explainPlanNode is the subset of a ClickHouse `EXPLAIN json = 1, indexes = 1`
// plan node the granule analysis needs: the node type, the table it reads (in
// Description, for ReadFromMergeTree nodes), its per-index funnel, and its
// children.
type explainPlanNode struct {
	NodeType    string             `json:"Node Type"`
	Description string             `json:"Description"`
	Indexes     []explainPlanIndex `json:"Indexes"`
	Plans       []explainPlanNode  `json:"Plans"`
}

// explainPlanIndex is one index step under a ReadFromMergeTree node. The index
// steps run in sequence, so the first step's Initial Granules is the candidate
// total and the last step's Selected Granules is what survives all pruning. The
// counts are pointers so a step that omits them is distinguishable from a zero.
type explainPlanIndex struct {
	Type             string   `json:"Type"`
	Name             string   `json:"Name"`
	Keys             []string `json:"Keys"`
	Condition        string   `json:"Condition"`
	InitialParts     *int64   `json:"Initial Parts"`
	SelectedParts    *int64   `json:"Selected Parts"`
	InitialGranules  *int64   `json:"Initial Granules"`
	SelectedGranules *int64   `json:"Selected Granules"`
}

// magnitudeReferenceRows is the estimated row count treated as "fully expensive"
// (magnitude score 0) by magnitudeScoreFromRows. It's a heuristic reference — the
// point past which a scan is considered maximally costly — and is deliberately a
// single tunable constant rather than per-table, so the score is comparable
// across queries.
const magnitudeReferenceRows = 1e9

// magnitudeScoreFromRows maps the absolute number of rows a statement is estimated
// to scan (from EXPLAIN ESTIMATE) to a 0-100 cost score on a log scale: 1 row →
// 100, magnitudeReferenceRows (or more) → 0; higher means less data scanned =
// cheaper. This is the absolute-cost counterpart to the granule skip score's
// pruning ratio — the two are orthogonal, so they're reported as separate axes.
func magnitudeScoreFromRows(rows int64) float64 {
	if rows <= 1 {
		return 100
	}
	ratio := math.Log10(float64(rows)) / math.Log10(magnitudeReferenceRows)
	if ratio < 0 {
		ratio = 0
	}
	if ratio > 1 {
		ratio = 1
	}
	return math.Round((1-ratio)*100*100) / 100 // percentage, 2 decimal places
}

// computeGranuleStats runs `EXPLAIN json = 1, indexes = 1` against the telemetry
// store and returns the granule-skip breakdown: candidate granules, granules
// surviving pruning, granules skipped, and the resulting 0-100 skip score (the
// percentage eliminated by partition, primary-key, and skip-index pruning before
// any data is read — higher = more selective, reads less). Granules are summed
// across every ReadFromMergeTree node so multi-read queries (e.g. a
// resource-filter subquery plus the main read) are scored as a whole, and the
// raw per-read, per-index funnel is preserved in Granules.Reads so a caller can
// see which index pruned and which did nothing. The returned bool is false (with
// a zero Granules) when the plan exposes no MergeTree index analysis (e.g. a
// query over a distributed_* table), so the caller simply omits the score.
func (q *querier) computeGranuleStats(ctx context.Context, stmt string, args []any) (qbtypes.Granules, bool, error) {
	rows, err := q.telemetryStore.ClickhouseDB().Query(ctx, "EXPLAIN json = 1, indexes = 1 "+stmt, args...)
	if err != nil {
		return qbtypes.Granules{}, false, errors.WrapInternalf(err, errors.CodeInternal, "failed to run EXPLAIN for query score")
	}
	defer rows.Close()

	// json=1 emits the plan as a single JSON document; read every row and join
	// so we are robust to the driver splitting it across rows.
	var sb strings.Builder
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			return qbtypes.Granules{}, false, errors.WrapInternalf(err, errors.CodeInternal, "failed to scan EXPLAIN json row")
		}
		sb.WriteString(line)
		sb.WriteByte('\n')
	}
	if err := rows.Err(); err != nil {
		return qbtypes.Granules{}, false, errors.WrapInternalf(err, errors.CodeInternal, "EXPLAIN json row iteration failed")
	}

	var plans []struct {
		Plan explainPlanNode `json:"Plan"`
	}
	if err := json.Unmarshal([]byte(sb.String()), &plans); err != nil {
		return qbtypes.Granules{}, false, errors.WrapInternalf(err, errors.CodeInternal, "failed to parse EXPLAIN json")
	}

	var totalInitial, totalSelected int64
	var reads []qbtypes.MergeTreeRead
	for i := range plans {
		collectMergeTreeReads(&plans[i].Plan, &reads, &totalInitial, &totalSelected)
	}
	if totalInitial <= 0 {
		// No MergeTree index analysis in the plan — nothing to score.
		return qbtypes.Granules{}, false, nil
	}
	if totalSelected < 0 {
		totalSelected = 0
	}
	skippedGranules := totalInitial - totalSelected
	if skippedGranules < 0 {
		skippedGranules = 0
	}
	ratio := float64(skippedGranules) / float64(totalInitial)
	score := math.Round(ratio*100*100) / 100 // percentage, 2 decimal places
	return qbtypes.Granules{
		Initial:   totalInitial,
		Selected:  totalSelected,
		Skipped:   skippedGranules,
		SkipScore: score,
		Reads:     reads,
	}, true, nil
}

func derefInt64(p *int64) int64 {
	if p == nil {
		return 0
	}
	return *p
}

// collectMergeTreeReads walks the plan tree and, for every ReadFromMergeTree
// node, records its raw per-index funnel (one MergeTreeRead, appended to reads)
// and folds its endpoints into the running totals: the candidate-granule total
// (first index step's Initial Granules) and surviving granules (last index
// step's Selected Granules). The per-step counts are kept verbatim so the caller
// can see the full pruning trace, not just the collapsed initial→selected.
func collectMergeTreeReads(node *explainPlanNode, reads *[]qbtypes.MergeTreeRead, totalInitial, totalSelected *int64) {
	if node.NodeType == "ReadFromMergeTree" && len(node.Indexes) > 0 {
		steps := make([]qbtypes.IndexStep, 0, len(node.Indexes))
		var initial, selected *int64
		for i := range node.Indexes {
			idx := node.Indexes[i]
			if idx.InitialGranules != nil && initial == nil {
				initial = idx.InitialGranules
			}
			if idx.SelectedGranules != nil {
				selected = idx.SelectedGranules
			}
			steps = append(steps, qbtypes.IndexStep{
				Type:             idx.Type,
				Name:             idx.Name,
				Keys:             idx.Keys,
				Condition:        idx.Condition,
				InitialParts:     derefInt64(idx.InitialParts),
				SelectedParts:    derefInt64(idx.SelectedParts),
				InitialGranules:  derefInt64(idx.InitialGranules),
				SelectedGranules: derefInt64(idx.SelectedGranules),
			})
		}
		if initial != nil && selected != nil {
			*totalInitial += *initial
			*totalSelected += *selected
		}
		*reads = append(*reads, qbtypes.MergeTreeRead{Table: node.Description, Steps: steps})
	}
	for i := range node.Plans {
		collectMergeTreeReads(&node.Plans[i], reads, totalInitial, totalSelected)
	}
}
