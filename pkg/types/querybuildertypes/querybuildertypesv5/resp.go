package querybuildertypesv5

import (
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/SigNoz/signoz/pkg/errors"
	"github.com/SigNoz/signoz/pkg/types/telemetrytypes"
	"github.com/SigNoz/signoz/pkg/valuer"
	"github.com/swaggest/jsonschema-go"
)

type QBEvent struct {
	Version         string `json:"version"`
	LogsUsed        bool   `json:"logs_used,omitempty"`
	MetricsUsed     bool   `json:"metrics_used,omitempty"`
	TracesUsed      bool   `json:"traces_used,omitempty"`
	Source          string `json:"source,omitempty"`
	FilterApplied   bool   `json:"filter_applied,omitempty"`
	GroupByApplied  bool   `json:"group_by_applied,omitempty"`
	QueryType       string `json:"query_type,omitempty"`
	PanelType       string `json:"panel_type,omitempty"`
	NumberOfQueries int    `json:"number_of_queries,omitempty"`
	HasData         bool   `json:"-"`
}

type QueryWarnData struct {
	Message  string                    `json:"message"`
	Url      string                    `json:"url,omitempty"`
	Warnings []QueryWarnDataAdditional `json:"warnings,omitempty"`
}

type QueryWarnDataAdditional struct {
	Message string `json:"message"`
}

type QueryData struct {
	Results []any `json:"results"`
}

var _ jsonschema.OneOfExposer = QueryData{}

// JSONSchemaOneOf documents the polymorphic result types in QueryData.Results.
func (QueryData) JSONSchemaOneOf() []any {
	return []any{
		TimeSeriesData{},
		ScalarData{},
		RawData{},
	}
}

type QueryRangeResponse struct {
	Type RequestType `json:"type"`
	Data QueryData   `json:"data"`
	Meta ExecStats   `json:"meta"`

	Warning *QueryWarnData `json:"warning,omitempty"`

	QBEvent *QBEvent `json:"-"`
}

// QueryRangePreviewResponse describes the dry-run output of a query range
// request. CompositeQuery mirrors the request's compositeQuery: each entry is
// the dry-run result for one query, keyed by the same query name the request
// used.
type QueryRangePreviewResponse struct {
	CompositeQuery map[string]QueryPreview `json:"compositeQuery"`
}

// QueryRangePreviewOptions carries per-call options for the query range
// preview (dry-run) endpoint. The zero value produces a lightweight,
// verdict-only preview (valid/error/warnings per query, no rendered SQL).
type QueryRangePreviewOptions struct {
	// Verbose is the single switch for the full preview, and the HTTP endpoint
	// defaults it to TRUE. When true, each rendered statement carries its EXPLAIN
	// ESTIMATE (PreviewStatement.Estimate) and granule index analysis
	// (PreviewStatement.Granules, including the per-index funnel), and the query
	// gets both headline scores (SelectivityScore and MagnitudeScore); the two
	// analyses cost one ClickHouse EXPLAIN per statement each. When false (set via
	// ?verbose=false) every query is still validated but the response is just the
	// per-query verdict, with no rendered SQL and no ClickHouse round trips.
	Verbose bool
}

// QueryRangePreviewParams documents the query-string parameters accepted by the
// query range preview (dry-run) endpoint.
type QueryRangePreviewParams struct {
	// Verbose defaults to "true": the full preview — the rendered ClickHouse
	// statement(s) with each statement's EXPLAIN ESTIMATE and granule index
	// analysis, plus the top-level selectivityScore and magnitudeScore. Set
	// verbose=false for the lightweight per-query verdict (valid/error/warnings)
	// with no rendered SQL and no ClickHouse round trips.
	Verbose string `query:"verbose"`
}

// PrepareJSONSchema adds description to the QueryRangePreviewResponse schema.
func (q *QueryRangePreviewResponse) PrepareJSONSchema(schema *jsonschema.Schema) error {
	schema.WithDescription("Response from the v5 query range preview (dry-run) endpoint. For each query in the composite query, returns the underlying ClickHouse statement(s) it renders to without executing them (one per PromQL metric selector; exactly one for builder/ClickHouse/trace-operator queries), with the optional EXPLAIN ESTIMATE and granule analysis attached per statement when requested.")
	return nil
}

// QueryPreview is the dry-run result for a single query, keyed by query name
// in QueryRangePreviewResponse.CompositeQuery.
type QueryPreview struct {
	// Valid is the headline verdict for this query: true when it previewed
	// without error, false when Error is set. It is always present (derived from
	// Error at marshal time) so an agent can branch on a single boolean instead
	// of testing for the presence of the error object.
	Valid bool `json:"valid"`
	// Error describes why this query is invalid or could not be previewed; nil
	// when the query previewed successfully. It is the structured form
	// (code, message, and — when available — suggestions and invalidReferences)
	// so an agent can act on it programmatically instead of parsing a string.
	Error    error    `json:"error,omitempty"`
	Warnings []string `json:"warnings,omitempty"`
	// SelectivityScore is the headline selectivity for this query: the percentage
	// (0-100) of candidate granules eliminated by partition, primary-key, and
	// skip-index pruning before any data is read (higher = less data read). It is
	// the minimum of the per-statement Statements[].Granules.SkipScore values —
	// the least-selective (worst) underlying statement, which dominates cost.
	// Returned only when the granules analysis ran (?granules=true or ?verbose=true)
	// and at least one statement reads a MergeTree table. Paired with
	// MagnitudeScore as the two headline score axes.
	SelectivityScore *float64 `json:"selectivityScore,omitempty"`
	// MagnitudeScore is the headline *cost* for this query (0-100; higher = less
	// data scanned = cheaper), a separate axis from SelectivityScore. Selectivity
	// is how good the index pruning *ratio* is, while MagnitudeScore reflects the
	// *absolute* rows the query would scan (from EXPLAIN ESTIMATE), since a query
	// can prune 99% of granules and still scan billions of rows on a huge table.
	// Derived on a log scale from the estimated rows of the heaviest statement.
	// Returned only when the estimate analysis ran (?estimate=true or ?verbose=true)
	// and at least one statement has an estimate. The two scores are kept separate
	// (not fused) so a caller can see which axis — selectivity or magnitude — is
	// the problem.
	MagnitudeScore *float64 `json:"magnitudeScore,omitempty"`
	// Statements are the underlying ClickHouse statement(s) this query renders to,
	// in execution order. Builder, ClickHouse SQL, and trace-operator queries
	// render exactly one; a PromQL query renders one per metric selector (the
	// Prometheus engine issues a statement per selector). Empty for a
	// validation-only preview, a query that failed to render (see Error), or one
	// that resolves to no data (a fully-missing metric, see Warnings).
	Statements []PreviewStatement `json:"statements,omitempty"`
}

// PreviewStatement is one rendered ClickHouse statement the query will execute,
// with its bound args and — when requested — its EXPLAIN ESTIMATE (Estimate) and
// granule breakdown (Granules). The query/args field names follow the
// OpenTelemetry db.statement.* convention so an agent consuming the dry-run sees
// the same keys it would on a span.
type PreviewStatement struct {
	Query string `json:"db.statement.query"`
	Args  []any  `json:"db.statement.args,omitempty"`
	// Estimate is the parsed ClickHouse EXPLAIN ESTIMATE output, set only for
	// ?estimate=true (or ?verbose=true): one entry per table the statement reads,
	// each with the parts/rows/marks ClickHouse estimates it will scan. Parsed
	// into a struct (rather than the raw tab-separated table) so an agent can read
	// the absolute cost estimate programmatically — it complements the
	// ratio-based Granules.
	Estimate []EstimateEntry `json:"estimate,omitempty"`
	// Granules is the parsed granule-skip breakdown for this statement (candidate
	// vs. surviving granules and the resulting skip score). Populated only for
	// ?granules=true (or ?verbose=true) when the statement reads a MergeTree
	// table, so an agent can see why a statement is (un)selective, not just the
	// headline score.
	Granules *Granules `json:"granules,omitempty"`
}

// EstimateEntry is ClickHouse's EXPLAIN ESTIMATE for one table the statement
// reads: the parts, rows, and marks it estimates it will scan. Unlike Granules
// (a pruning ratio), these are absolute counts, so they convey how much data a
// statement touches in real terms.
type EstimateEntry struct {
	Database string `json:"database"`
	Table    string `json:"table"`
	Parts    int64  `json:"parts"`
	Rows     int64  `json:"rows"`
	Marks    int64  `json:"marks"`
}

// Granules is the granule-skip breakdown for one rendered statement, parsed from
// ClickHouse's `EXPLAIN json = 1, indexes = 1` index analysis. Granules are the
// unit of read in a MergeTree table; the fewer that survive pruning, the less
// data the query reads. Summed across every ReadFromMergeTree node in the plan
// so a multi-read statement is scored as a whole.
type Granules struct {
	// Initial is the candidate granules before any pruning.
	Initial int64 `json:"initial"`
	// Selected is the granules surviving partition/primary-key/skip-index pruning
	// — the ones the query would actually read.
	Selected int64 `json:"selected"`
	// Skipped is Initial - Selected: granules eliminated before any read.
	Skipped int64 `json:"skipped"`
	// SkipScore is 100 * Skipped / Initial, rounded to two decimals (0-100;
	// higher = more selective).
	SkipScore float64 `json:"skipScore"`
	// Reads is the raw per-read index-pruning trace behind the aggregate above:
	// one entry per ReadFromMergeTree node in the plan, each listing the index
	// steps in the order ClickHouse applies them. It shows *which* index did the
	// pruning and which did nothing — a step whose selected == initial pruned no
	// granules (its index isn't engaging), and a read still selecting many
	// granules after every step is a candidate for a new index. Empty when the
	// plan exposes no MergeTree index analysis.
	Reads []MergeTreeRead `json:"reads,omitempty"`
}

// MergeTreeRead is the index-pruning funnel for one ReadFromMergeTree node — one
// physical read of one table. The Steps run in sequence, so each step's Initial*
// matches the previous step's Selected*: the list reads as a funnel from
// candidate parts/granules down to what survives and is actually read.
type MergeTreeRead struct {
	// Table is the table this node reads, e.g. "signoz_logs.logs_v2".
	Table string `json:"table"`
	// Steps are the index steps applied to this read, in execution order.
	Steps []IndexStep `json:"steps"`
}

// IndexStep is one index applied during a MergeTree read, with the parts and
// granules entering it (Initial*) and surviving it (Selected*). Type is the
// ClickHouse index kind (MinMax, Partition, PrimaryKey, or Skip); Name is set
// for skip indexes; Keys/Condition describe what it matched on.
type IndexStep struct {
	Type             string   `json:"type"`
	Name             string   `json:"name,omitempty"`
	Keys             []string `json:"keys,omitempty"`
	Condition        string   `json:"condition,omitempty"`
	InitialParts     int64    `json:"initialParts"`
	SelectedParts    int64    `json:"selectedParts"`
	InitialGranules  int64    `json:"initialGranules"`
	SelectedGranules int64    `json:"selectedGranules"`
}

// MarshalJSON renders Error as the structured error form (code, message and,
// when present, suggestions/invalidReferences) instead of the default {} that a
// bare error interface produces, so an agent consuming the dry-run can act on it
// programmatically.
func (p QueryPreview) MarshalJSON() ([]byte, error) {
	type alias QueryPreview
	out := struct {
		alias
		Error *errors.JSON `json:"error,omitempty"`
	}{alias: alias(p)}
	out.alias.Error = nil
	// Derive the verdict from the error so callers can't desync the two.
	out.Valid = p.Error == nil
	if p.Error != nil {
		out.Error = errors.AsJSON(p.Error)
	}
	return json.Marshal(out)
}

var _ jsonschema.Preparer = &QueryRangeResponse{}

// PrepareJSONSchema adds description to the QueryRangeResponse schema.
func (q *QueryRangeResponse) PrepareJSONSchema(schema *jsonschema.Schema) error {
	schema.WithDescription("Response from the v5 query range endpoint. The data.results array contains typed results depending on the requestType: TimeSeriesData for time_series, ScalarData for scalar, or RawData for raw requests.")
	return nil
}

type TimeSeriesData struct {
	QueryName    string               `json:"queryName"`
	Aggregations []*AggregationBucket `json:"aggregations"`
}

type AggregationBucket struct {
	Index int    `json:"index"` // or string Alias
	Alias string `json:"alias"`
	Meta  struct {
		Unit string `json:"unit,omitempty"`
	} `json:"meta,omitempty"`
	Series []*TimeSeries `json:"series"` // no extra nesting

	PredictedSeries  []*TimeSeries `json:"predictedSeries,omitempty"`
	UpperBoundSeries []*TimeSeries `json:"upperBoundSeries,omitempty"`
	LowerBoundSeries []*TimeSeries `json:"lowerBoundSeries,omitempty"`
	AnomalyScores    []*TimeSeries `json:"anomalyScores,omitempty"`
}

type TimeSeries struct {
	Labels []*Label           `json:"labels,omitempty"`
	Values []*TimeSeriesValue `json:"values"`
}

// EvaluableValues returns only the values where Partial is false and value is not NaN or +/- Inf.
// TODO(srikanthccv): should we skip them in the consume.go?
func (ts *TimeSeries) EvaluableValues() []*TimeSeriesValue {
	if ts == nil {
		return nil
	}
	result := make([]*TimeSeriesValue, 0, len(ts.Values))
	for _, v := range ts.Values {
		if !v.Partial && !math.IsNaN(v.Value) && !math.IsInf(v.Value, 0) {
			result = append(result, v)
		}
	}
	return result
}

type Label struct {
	Key   telemetrytypes.TelemetryFieldKey `json:"key"`
	Value any                              `json:"value"`
}

func GetUniqueSeriesKey(labels []*Label) string {
	// Fast path for common cases
	if len(labels) == 0 {
		return ""
	}
	if len(labels) == 1 {
		return fmt.Sprintf("%s=%v,", labels[0].Key.Name, labels[0].Value)
	}

	// Use a map to collect labels for consistent ordering without copying
	labelMap := make(map[string]string, len(labels))
	keys := make([]string, 0, len(labels))

	// Estimate total size for string builder
	estimatedSize := 0
	for _, label := range labels {
		if _, exists := labelMap[label.Key.Name]; !exists {
			keys = append(keys, label.Key.Name)
			estimatedSize += len(label.Key.Name) + 2 // key + '=' + ','
		}
		// get the value as string
		value, ok := label.Value.(string)
		if !ok {
			value = fmt.Sprintf("%v", label.Value)
		}
		estimatedSize += len(value)

		labelMap[label.Key.Name] = value
	}

	// Sort just the keys
	slices.Sort(keys)

	// Build the key using sorted keys with better size estimation
	var key strings.Builder
	key.Grow(estimatedSize)

	for _, k := range keys {
		key.WriteString(k)
		key.WriteByte('=')
		key.WriteString(labelMap[k])
		key.WriteByte(',')
	}

	return key.String()
}

type TimeSeriesValue struct {
	Timestamp int64   `json:"timestamp"`
	Value     float64 `json:"value"`

	// true if the value is "partial", i.e doesn't cover the complete interval.
	// for instance, if the query start time is 3:14:15 PM, and the step is 1 minute,
	// the ts is rounded to 3:14 but the value only covers 3:14:15 PM to 3:15:00 PM
	// this partial result cannot be cached and should be ignored.
	// on the client side, these partial values are rendered differently.
	Partial bool `json:"partial,omitempty"`

	// for the heatmap type chart
	Values []float64 `json:"values,omitempty"`
	Bucket *Bucket   `json:"bucket,omitempty"`
}

type Bucket struct {
	Step float64 `json:"step"`
}

type ColumnType struct {
	valuer.String
}

var (
	// for the group by part of the query.
	ColumnTypeGroup = ColumnType{valuer.NewString("group")}
	// for the aggregation part of the query.
	ColumnTypeAggregation = ColumnType{valuer.NewString("aggregation")}
)

// Enum returns the acceptable values for ColumnType.
func (ColumnType) Enum() []any {
	return []any{
		ColumnTypeGroup,
		ColumnTypeAggregation,
	}
}

type ColumnDescriptor struct {
	telemetrytypes.TelemetryFieldKey
	QueryName        string `json:"queryName"`
	AggregationIndex int64  `json:"aggregationIndex"`
	Meta             struct {
		Unit string `json:"unit,omitempty"`
	} `json:"meta,omitempty"`
	Type ColumnType `json:"columnType"`
}

type ScalarData struct {
	QueryName string              `json:"queryName"`
	Columns   []*ColumnDescriptor `json:"columns"`
	Data      [][]any             `json:"data"`
}

type RawData struct {
	QueryName  string    `json:"queryName"`
	NextCursor string    `json:"nextCursor"`
	Rows       []*RawRow `json:"rows"`
}

type RawRow struct {
	Timestamp time.Time      `json:"timestamp"`
	Data      map[string]any `json:"data"`
}

type RawStream struct {
	Name  string
	Logs  chan *RawRow
	Done  chan *bool
	Error chan error
}

func roundToNonZeroDecimals(val float64, n int) float64 {
	if val == 0 || math.IsNaN(val) || math.IsInf(val, 0) {
		return val
	}

	absVal := math.Abs(val)

	// For numbers >= 1, we want to round to n decimal places total
	if absVal >= 1 {
		// Round to n decimal places
		multiplier := math.Pow(10, float64(n))
		rounded := math.Round(val*multiplier) / multiplier

		// If the result is a whole number, return it as such
		if rounded == math.Trunc(rounded) {
			return rounded
		}

		// Remove trailing zeros by converting to string and back
		str := strconv.FormatFloat(rounded, 'f', -1, 64)
		result, _ := strconv.ParseFloat(str, 64)
		return result
	}

	// For numbers < 1, count n significant figures after first non-zero digit
	order := math.Floor(math.Log10(absVal))
	scale := math.Pow(10, -order+float64(n)-1)
	rounded := math.Round(val*scale) / scale

	// Clean up floating point precision
	str := strconv.FormatFloat(rounded, 'f', -1, 64)
	result, _ := strconv.ParseFloat(str, 64)
	return result
}

func sanitizeValue(v any) any {
	if v == nil {
		return nil
	}

	if f, ok := v.(float64); ok {
		if math.IsNaN(f) {
			return "NaN"
		} else if math.IsInf(f, 1) {
			return "Inf"
		} else if math.IsInf(f, -1) {
			return "-Inf"
		}
		return roundToNonZeroDecimals(f, 3)
	}

	if f, ok := v.(float32); ok {
		f64 := float64(f)
		if math.IsNaN(f64) {
			return "NaN"
		} else if math.IsInf(f64, 1) {
			return "Inf"
		} else if math.IsInf(f64, -1) {
			return "-Inf"
		}
		return float32(roundToNonZeroDecimals(f64, 3)) // ADD ROUNDING HERE
	}

	rv := reflect.ValueOf(v)
	switch rv.Kind() {
	case reflect.Slice:
		result := make([]any, rv.Len())
		for i := 0; i < rv.Len(); i++ {
			result[i] = sanitizeValue(rv.Index(i).Interface())
		}
		return result
	case reflect.Map:
		result := make(map[string]any)
		for _, key := range rv.MapKeys() {
			keyStr := key.String()
			result[keyStr] = sanitizeValue(rv.MapIndex(key).Interface())
		}
		return result
	case reflect.Ptr:
		if rv.IsNil() {
			return nil
		}
		return sanitizeValue(rv.Elem().Interface())
	case reflect.Struct:
		return v
	default:
		return v
	}
}

func (q QueryRangeResponse) MarshalJSON() ([]byte, error) {
	type Alias QueryRangeResponse
	return json.Marshal(&struct {
		*Alias
		Data any `json:"data"`
	}{
		Alias: (*Alias)(&q),
		Data:  sanitizeValue(q.Data),
	})
}

func (s ScalarData) MarshalJSON() ([]byte, error) {
	type Alias ScalarData
	sanitizedData := make([][]any, len(s.Data))
	for i, row := range s.Data {
		sanitizedData[i] = make([]any, len(row))
		for j, val := range row {
			sanitizedData[i][j] = sanitizeValue(val)
		}
	}

	return json.Marshal(&struct {
		*Alias
		Data [][]any `json:"data"`
	}{
		Alias: (*Alias)(&s),
		Data:  sanitizedData,
	})
}

func (r RawRow) MarshalJSON() ([]byte, error) {
	type Alias RawRow
	sanitizedData := make(map[string]any)
	for k, v := range r.Data {
		sanitizedData[k] = sanitizeValue(v)
	}

	var timestamp *time.Time
	if !r.Timestamp.IsZero() {
		timestamp = &r.Timestamp
	}

	return json.Marshal(&struct {
		*Alias
		Data      map[string]any `json:"data"`
		Timestamp *time.Time     `json:"timestamp,omitempty"`
	}{
		Alias:     (*Alias)(&r),
		Data:      sanitizedData,
		Timestamp: timestamp,
	})
}

func (t TimeSeriesValue) MarshalJSON() ([]byte, error) {
	type Alias TimeSeriesValue

	var sanitizedValues any
	if t.Values != nil {
		sanitizedValues = sanitizeValue(t.Values)
		// If original was empty slice, ensure we return empty slice not nil
		if len(t.Values) == 0 {
			sanitizedValues = []any{}
		}
	}

	return json.Marshal(&struct {
		*Alias
		Value  any `json:"value"`
		Values any `json:"values,omitempty"`
	}{
		Alias:  (*Alias)(&t),
		Value:  sanitizeValue(t.Value),
		Values: sanitizedValues,
	})
}

func (r RawData) MarshalJSON() ([]byte, error) {
	type Alias RawData
	return json.Marshal((*Alias)(&r))
}
