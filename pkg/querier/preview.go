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
	qbtypes "github.com/SigNoz/signoz/pkg/types/querybuildertypes/querybuildertypesv5"
	"github.com/SigNoz/signoz/pkg/valuer"
)

// magnitudeReferenceRows is the estimated row count treated as "fully expensive"
// (magnitude score 0) by magnitudeScoreFromRows. It's a heuristic reference — the
// point past which a scan is considered maximally costly — and is deliberately a
// single tunable constant rather than per-table, so the score is comparable
// across queries.
const magnitudeReferenceRows = 1e9

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

// statementProvider is implemented by query types that can render the
// underlying SQL/PromQL statement without executing it.
type statementProvider interface {
	Statement(ctx context.Context) (*qbtypes.Statement, error)
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

type explainPlanNode struct {
	NodeType    string             `json:"Node Type"`
	Description string             `json:"Description"`
	Indexes     []explainPlanIndex `json:"Indexes"`
	Plans       []explainPlanNode  `json:"Plans"`
}

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

	validationOpts, err := req.ValidateRequestScope()
	if err != nil {
		return nil, err
	}

	dependencyQueries, err := q.constructTraceOperatorDependencyMap(req.CompositeQuery.Queries)
	if err != nil {
		return nil, err
	}

	results := make(map[string]qbtypes.QueryPreview, len(req.CompositeQuery.Queries))

	prepared := make(map[string]qbtypes.QueryPreview, len(req.CompositeQuery.Queries))
	missingMetricQuerySet := make(map[string]bool)
	for idx := range req.CompositeQuery.Queries {
		name := req.CompositeQuery.Queries[idx].GetQueryName()
		ps := qbtypes.QueryPreview{}

		if vErr := req.CompositeQuery.Queries[idx].Validate(validationOpts...); vErr != nil {
			ps.Error = vErr
			prepared[name] = ps
			continue
		}

		env := []qbtypes.QueryEnvelope{req.CompositeQuery.Queries[idx]}
		ps.Warnings = q.adjustStepInterval(env, req.Start, req.End)

		missingMetricQueries, metricWarnings, mErr := q.resolveMetricMetadata(ctx, env, req.Start, req.End)
		if mErr != nil {
			// Don't abort the whole preview: report this query's error and keep
			// going so the agent sees every problem in one round trip.
			ps.Error = mErr
		} else {
			ps.Warnings = append(ps.Warnings, metricWarnings...)
			if len(missingMetricQueries) > 0 {
				missingMetricQuerySet[name] = true
				if len(metricWarnings) == 0 {
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

	skip := make(map[string]bool, len(prepared))
	for name, ps := range prepared {
		if ps.Error != nil || missingMetricQuerySet[name] {
			skip[name] = true
		}
	}
	providers, buildErrs := q.buildPreviewProviders(req, dependencyQueries, missingMetricQuerySet, skip)

	// Render the statement for each query that actually executes, and collect the
	// ClickHouse-bound work (granules/estimate analyses) to run concurrently.
	var previewTasks []previewTask
	for _, query := range req.CompositeQuery.Queries {
		name := query.GetQueryName()
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
		// A build error is this query's verdict — attribute it and move on
		// instead of aborting the whole preview.
		if bErr := buildErrs[name]; bErr != nil {
			ps.Error = bErr
			results[name] = ps
			continue
		}

		provider, ok := providers[name]
		if !ok {
			// Formula/join/sub-query are valid query types that render no standalone
			// statement of their own — they're evaluated from the queries they
			// reference, which are previewed individually. Report them as valid with
			// a note rather than failing them.
			if !rendersStandaloneStatement(query.Type) {
				ps.Warnings = append(ps.Warnings, fmt.Sprintf(
					"query type %q has no standalone statement to preview; it is evaluated from the queries it references", query.Type.StringValue()))
				results[name] = ps
				continue
			}
			ps.Error = errors.NewInternalf(errors.CodeInternal, "query produced no provider")
			results[name] = ps
			continue
		}

		stmtProvider, ok := provider.(statementProvider)
		if !ok {
			ps.Error = errors.NewInternalf(errors.CodeInternal, "query does not support preview")
			results[name] = ps
			continue
		}

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

		if !opts.Verbose {
			results[name] = ps
			continue
		}

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

		for j := range ps.Statements {
			previewTasks = append(previewTasks, previewTask{name: name, stmtIdx: j, query: ps.Statements[j].Query, args: ps.Statements[j].Args})
		}
	}

	q.runPreviewTasks(ctx, previewTasks, results)

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

func (q *querier) buildPreviewProviders(
	req *qbtypes.QueryRangeRequest,
	dependencyQueries map[string]bool,
	missingMetricQuerySet map[string]bool,
	skip map[string]bool,
) (providers map[string]qbtypes.Query, errs map[string]error) {
	providers = make(map[string]qbtypes.Query)
	errs = make(map[string]error)

	// buildQueries records analytics on the event; the preview emits none.
	event := &qbtypes.QBEvent{}

	for _, query := range req.CompositeQuery.Queries {
		name := query.GetQueryName()
		if skip[name] {
			continue
		}

		sub := *req // shallow copy: only CompositeQuery and RequestType are swapped

		// deps is the set buildQueries skips within this composite: empty for a
		// standalone query (so it gets built), and the operator's referenced
		// siblings for a trace operator (so only the operator is built from it).
		var deps map[string]bool

		switch {
		case query.GetType() == qbtypes.QueryTypeTraceOperator:
			refs, rErr := q.traceOperatorPreviewComposite(req, query)
			if rErr != nil {
				errs[name] = rErr
				continue
			}
			sub.CompositeQuery = qbtypes.CompositeQuery{Queries: refs}
			deps = dependencyQueries
		case dependencyQueries[name]:
			sub.RequestType = qbtypes.RequestTypeRaw
			sub.CompositeQuery = qbtypes.CompositeQuery{Queries: []qbtypes.QueryEnvelope{query}}
		default:
			sub.CompositeQuery = qbtypes.CompositeQuery{Queries: []qbtypes.QueryEnvelope{query}}
		}

		built, _, bErr := q.buildQueries(&sub, deps, missingMetricQuerySet, event)
		if bErr != nil {
			errs[name] = bErr
			continue
		}

		if provider, ok := built[name]; ok {
			providers[name] = provider
		}
	}
	return providers, errs
}

// rendersStandaloneStatement reports whether a query type renders to its own
// ClickHouse/PromQL statement the preview can build and analyze. Formula, join,
// and sub-query are valid query types but carry no statement of their own —
// they're evaluated from the queries they reference — so buildQueries (and hence
// the preview) renders nothing for them. Mirrors buildQueries' switch.
func rendersStandaloneStatement(t qbtypes.QueryType) bool {
	switch t {
	case qbtypes.QueryTypeBuilder,
		qbtypes.QueryTypePromQL,
		qbtypes.QueryTypeClickHouseSQL,
		qbtypes.QueryTypeTraceOperator:
		return true
	default:
		return false
	}
}

func (q *querier) traceOperatorPreviewComposite(req *qbtypes.QueryRangeRequest, operator qbtypes.QueryEnvelope) ([]qbtypes.QueryEnvelope, error) {
	spec, ok := operator.Spec.(qbtypes.QueryBuilderTraceOperator)
	if !ok {
		return nil, errors.NewInvalidInputf(errors.CodeInvalidInput, "invalid trace operator query spec %T", operator.Spec)
	}
	if err := spec.ParseExpression(); err != nil {
		return nil, err
	}

	referenced := make(map[string]bool)
	for _, name := range spec.CollectReferencedQueries(spec.ParsedExpression) {
		referenced[name] = true
	}

	queries := make([]qbtypes.QueryEnvelope, 0, len(referenced)+1)
	for _, qe := range req.CompositeQuery.Queries {
		if referenced[qe.GetQueryName()] {
			queries = append(queries, qe)
		}
	}
	return append(queries, operator), nil
}

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
