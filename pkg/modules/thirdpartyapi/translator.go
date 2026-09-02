package thirdpartyapi

import (
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/SigNoz/signoz/pkg/types/thirdpartyapitypes"

	qbtypes "github.com/SigNoz/signoz/pkg/types/querybuildertypes/querybuildertypesv5"
	"github.com/SigNoz/signoz/pkg/types/telemetrytypes"
)

const (
	derivedKeyHTTPURL  = "http_url" // https://signoz.io/docs/traces-management/guides/derived-fields-spans/#http_url
	derivedKeyHTTPHost = "http_host"
)

var defaultStepInterval = 60 * time.Second

var (
	groupByKeyHTTPHost = qbtypes.GroupByKey{
		TelemetryFieldKey: telemetrytypes.TelemetryFieldKey{
			Name:          derivedKeyHTTPHost,
			FieldDataType: telemetrytypes.FieldDataTypeString,
			FieldContext:  telemetrytypes.FieldContextSpan,
			Signal:        telemetrytypes.SignalTraces,
		},
	}
	groupByKeyHTTPURL = qbtypes.GroupByKey{
		TelemetryFieldKey: telemetrytypes.TelemetryFieldKey{
			Name:          derivedKeyHTTPURL,
			FieldDataType: telemetrytypes.FieldDataTypeString,
			FieldContext:  telemetrytypes.FieldContextSpan,
			Signal:        telemetrytypes.SignalTraces,
		},
	}
	groupByKeyHTTPStatusCode = qbtypes.GroupByKey{
		TelemetryFieldKey: telemetrytypes.TelemetryFieldKey{
			Name:          "response_status_code",
			FieldDataType: telemetrytypes.FieldDataTypeString,
			FieldContext:  telemetrytypes.FieldContextSpan,
			Signal:        telemetrytypes.SignalTraces,
		},
	}
)

func FilterIntermediateColumns(result *qbtypes.QueryRangeResponse) *qbtypes.QueryRangeResponse {
	if result == nil || result.Data.Results == nil {
		return result
	}

	for _, res := range result.Data.Results {
		scalarData, ok := res.(*qbtypes.ScalarData)
		if !ok {
			continue
		}

		// Filter out columns for intermediate queries used only in formulas
		filteredColumns := make([]*qbtypes.ColumnDescriptor, 0)
		intermediateQueryNames := map[string]bool{
			"error_span":   true,
			"warning_span": true,
			"total_span":   true,
		}

		columnIndices := make([]int, 0)
		for i, col := range scalarData.Columns {
			if col.Type == qbtypes.ColumnTypeAggregation && intermediateQueryNames[col.QueryName] {
				// Skip intermediate aggregation columns
				continue
			}
			filteredColumns = append(filteredColumns, col)
			columnIndices = append(columnIndices, i)
		}

		// Filter data rows to match filtered columns
		filteredData := make([][]any, 0, len(scalarData.Data))
		for _, row := range scalarData.Data {
			filteredRow := make([]any, len(columnIndices))
			for newIdx, oldIdx := range columnIndices {
				if oldIdx < len(row) {
					filteredRow[newIdx] = row[oldIdx]
				}
			}
			filteredData = append(filteredData, filteredRow)
		}

		scalarData.Columns = filteredColumns
		scalarData.Data = filteredData
	}

	return result
}

func FilterResponse(results []*qbtypes.QueryRangeResponse) []*qbtypes.QueryRangeResponse {
	filteredResults := make([]*qbtypes.QueryRangeResponse, 0, len(results))

	for _, res := range results {
		if res.Data.Results == nil {
			continue
		}

		filteredData := make([]any, 0, len(res.Data.Results))
		for _, result := range res.Data.Results {
			if result == nil {
				filteredData = append(filteredData, result)
				continue
			}

			switch resultData := result.(type) {
			case *qbtypes.TimeSeriesData:
				if resultData.Aggregations != nil {
					for _, agg := range resultData.Aggregations {
						filteredSeries := make([]*qbtypes.TimeSeries, 0, len(agg.Series))
						for _, series := range agg.Series {
							if shouldIncludeSeries(series) {
								filteredSeries = append(filteredSeries, series)
							}
						}
						agg.Series = filteredSeries
					}
				}
			case *qbtypes.RawData:
				filteredRows := make([]*qbtypes.RawRow, 0, len(resultData.Rows))
				for _, row := range resultData.Rows {
					if shouldIncludeRow(row) {
						filteredRows = append(filteredRows, row)
					}
				}
				resultData.Rows = filteredRows
			case *qbtypes.ScalarData:
				resultData.Data = filterScalarDataIPs(resultData.Columns, resultData.Data)
			}

			filteredData = append(filteredData, result)
		}

		res.Data.Results = filteredData
		filteredResults = append(filteredResults, res)
	}

	return filteredResults
}

func shouldIncludeSeries(series *qbtypes.TimeSeries) bool {
	for _, label := range series.Labels {
		if label.Key.Name == derivedKeyHTTPHost {
			if strVal, ok := label.Value.(string); ok {
				if net.ParseIP(strVal) != nil {
					return false
				}
			}
		}
	}
	return true
}

func filterScalarDataIPs(columns []*qbtypes.ColumnDescriptor, data [][]any) [][]any {
	// Find column indices for server address fields
	serverColIndices := make([]int, 0)
	for i, col := range columns {
		if col.Name == derivedKeyHTTPHost {
			serverColIndices = append(serverColIndices, i)
		}
	}

	if len(serverColIndices) == 0 {
		return data
	}

	filtered := make([][]any, 0, len(data))
	for _, row := range data {
		includeRow := true
		for _, colIdx := range serverColIndices {
			if colIdx < len(row) {
				if strVal, ok := row[colIdx].(string); ok {
					if net.ParseIP(strVal) != nil {
						includeRow = false
						break
					}
				}
			}
		}
		if includeRow {
			filtered = append(filtered, row)
		}
	}
	return filtered
}

func shouldIncludeRow(row *qbtypes.RawRow) bool {
	if row.Data != nil {
		if domainVal, ok := row.Data[derivedKeyHTTPHost]; ok {
			if domainStr, ok := domainVal.(string); ok {
				if net.ParseIP(domainStr) != nil {
					return false
				}
			}
		}
	}
	return true
}

func getGroupByField(req *thirdpartyapitypes.ThirdPartyApiRequest) qbtypes.GroupByKey {
	if req.GroupByUrl {
		return groupByKeyHTTPURL
	}
	return groupByKeyHTTPHost
}

func mergeGroupBy(base qbtypes.GroupByKey, additional []qbtypes.GroupByKey) []qbtypes.GroupByKey {
	return append([]qbtypes.GroupByKey{base}, additional...)
}

func mergeGroupByWithStatus(base qbtypes.GroupByKey, additional []qbtypes.GroupByKey) []qbtypes.GroupByKey {
	return append([]qbtypes.GroupByKey{base, groupByKeyHTTPStatusCode}, additional...)
}

func BuildDomainList(req *thirdpartyapitypes.ThirdPartyApiRequest) (*qbtypes.QueryRangeRequest, error) {
	if err := req.Validate(); err != nil {
		return nil, err
	}

	queries := []qbtypes.QueryEnvelope{
		buildEndpointsQuery(req),
		buildLastSeenQuery(req),
		buildRpsQuery(req),
		buildTotalSpanQuery(req),
		buildErrorSpanQuery(req),
		buildWarningSpanQuery(req),
		buildP99Query(req),
		buildAvgQuery(req),
		buildErrorRateFormula(),
		buildWarningRateFormula(),
	}

	return &qbtypes.QueryRangeRequest{
		SchemaVersion: "v5",
		Start:         req.Start,
		End:           req.End,
		RequestType:   qbtypes.RequestTypeScalar,
		CompositeQuery: qbtypes.CompositeQuery{
			Queries: queries,
		},
		FormatOptions: &qbtypes.FormatOptions{
			FormatTableResultForUI: true,
		},
	}, nil
}

func BuildDomainInfo(req *thirdpartyapitypes.ThirdPartyApiRequest) (*qbtypes.QueryRangeRequest, error) {
	if err := req.Validate(); err != nil {
		return nil, err
	}

	queries := []qbtypes.QueryEnvelope{
		buildEndpointsInfoQuery(req),
		buildP99InfoQuery(req),
		buildAvgInfoQuery(req),
		buildErrorRateInfoQuery(req),
		buildLastSeenInfoQuery(req),
	}

	return &qbtypes.QueryRangeRequest{
		SchemaVersion: "v5",
		Start:         req.Start,
		End:           req.End,
		RequestType:   qbtypes.RequestTypeScalar,
		CompositeQuery: qbtypes.CompositeQuery{
			Queries: queries,
		},
		FormatOptions: &qbtypes.FormatOptions{
			FormatTableResultForUI: true,
		},
	}, nil
}

func buildEndpointsQuery(req *thirdpartyapitypes.ThirdPartyApiRequest) qbtypes.QueryEnvelope {
	expr := fmt.Sprintf("count_distinct(%s)", derivedKeyHTTPURL)
	if req.GroupByUrl {
		expr = "count()"
	}
	return qbtypes.QueryEnvelope{
		Type: qbtypes.QueryTypeBuilder,
		Spec: qbtypes.QueryBuilderQuery[qbtypes.TraceAggregation]{
			Name:         "endpoints",
			Signal:       telemetrytypes.SignalTraces,
			StepInterval: qbtypes.Step{Duration: defaultStepInterval},
			Aggregations: []qbtypes.TraceAggregation{
				{Expression: expr},
			},
			Filter:  buildBaseFilter(req.Filter),
			GroupBy: mergeGroupBy(getGroupByField(req), req.GroupBy),
		},
	}
}

func buildLastSeenQuery(req *thirdpartyapitypes.ThirdPartyApiRequest) qbtypes.QueryEnvelope {
	return qbtypes.QueryEnvelope{
		Type: qbtypes.QueryTypeBuilder,
		Spec: qbtypes.QueryBuilderQuery[qbtypes.TraceAggregation]{
			Name:         "lastseen",
			Signal:       telemetrytypes.SignalTraces,
			StepInterval: qbtypes.Step{Duration: defaultStepInterval},
			Aggregations: []qbtypes.TraceAggregation{
				{Expression: "max(timestamp)"},
			},
			Filter:  buildBaseFilter(req.Filter),
			GroupBy: mergeGroupBy(getGroupByField(req), req.GroupBy),
		},
	}
}

func buildRpsQuery(req *thirdpartyapitypes.ThirdPartyApiRequest) qbtypes.QueryEnvelope {
	return qbtypes.QueryEnvelope{
		Type: qbtypes.QueryTypeBuilder,
		Spec: qbtypes.QueryBuilderQuery[qbtypes.TraceAggregation]{
			Name:         "rps",
			Signal:       telemetrytypes.SignalTraces,
			StepInterval: qbtypes.Step{Duration: defaultStepInterval},
			Aggregations: []qbtypes.TraceAggregation{
				{Expression: "rate()"},
			},
			Filter:  buildBaseFilter(req.Filter),
			GroupBy: mergeGroupBy(getGroupByField(req), req.GroupBy),
		},
	}
}

func buildErrorSpanQuery(req *thirdpartyapitypes.ThirdPartyApiRequest) qbtypes.QueryEnvelope {
	hostField := derivedKeyHTTPHost
	if req.GroupByUrl {
		hostField = derivedKeyHTTPURL
	}
	expr := buildRulesFilter(hostField, req.GlobalRule.ErrorCodes, req.ApiRules, true)

	filter := buildBaseFilter(req.Filter)
	filter.Expression = fmt.Sprintf("%s AND (%s)", expr, filter.Expression)

	return qbtypes.QueryEnvelope{
		Type: qbtypes.QueryTypeBuilder,
		Spec: qbtypes.QueryBuilderQuery[qbtypes.TraceAggregation]{
			Name:         "error_span",
			Signal:       telemetrytypes.SignalTraces,
			StepInterval: qbtypes.Step{Duration: defaultStepInterval},
			Aggregations: []qbtypes.TraceAggregation{
				{Expression: "count()"},
			},
			Filter:  filter,
			GroupBy: mergeGroupBy(getGroupByField(req), req.GroupBy),
		},
	}
}

func buildWarningSpanQuery(req *thirdpartyapitypes.ThirdPartyApiRequest) qbtypes.QueryEnvelope {
	hostField := derivedKeyHTTPHost
	if req.GroupByUrl {
		hostField = derivedKeyHTTPURL
	}
	expr := buildRulesFilter(hostField, req.GlobalRule.WarningCodes, req.ApiRules, false)

	filter := buildBaseFilter(req.Filter)
	filter.Expression = fmt.Sprintf("%s AND (%s)", expr, filter.Expression)

	return qbtypes.QueryEnvelope{
		Type: qbtypes.QueryTypeBuilder,
		Spec: qbtypes.QueryBuilderQuery[qbtypes.TraceAggregation]{
			Name:         "warning_span",
			Signal:       telemetrytypes.SignalTraces,
			StepInterval: qbtypes.Step{Duration: defaultStepInterval},
			Aggregations: []qbtypes.TraceAggregation{
				{Expression: "count()"},
			},
			Filter:  filter,
			GroupBy: mergeGroupBy(getGroupByField(req), req.GroupBy),
		},
	}
}

func buildTotalSpanQuery(req *thirdpartyapitypes.ThirdPartyApiRequest) qbtypes.QueryEnvelope {
	return qbtypes.QueryEnvelope{
		Type: qbtypes.QueryTypeBuilder,
		Spec: qbtypes.QueryBuilderQuery[qbtypes.TraceAggregation]{
			Name:         "total_span",
			Signal:       telemetrytypes.SignalTraces,
			StepInterval: qbtypes.Step{Duration: defaultStepInterval},
			Aggregations: []qbtypes.TraceAggregation{
				{Expression: "count()"},
			},
			Filter:  buildBaseFilter(req.Filter),
			GroupBy: mergeGroupBy(getGroupByField(req), req.GroupBy),
		},
	}
}

func buildP99Query(req *thirdpartyapitypes.ThirdPartyApiRequest) qbtypes.QueryEnvelope {
	return qbtypes.QueryEnvelope{
		Type: qbtypes.QueryTypeBuilder,
		Spec: qbtypes.QueryBuilderQuery[qbtypes.TraceAggregation]{
			Name:         "p99",
			Signal:       telemetrytypes.SignalTraces,
			StepInterval: qbtypes.Step{Duration: defaultStepInterval},
			Aggregations: []qbtypes.TraceAggregation{
				{Expression: "p99(duration_nano)"},
			},
			Filter:  buildBaseFilter(req.Filter),
			GroupBy: mergeGroupBy(getGroupByField(req), req.GroupBy),
		},
	}
}

func buildErrorRateFormula() qbtypes.QueryEnvelope {
	return qbtypes.QueryEnvelope{
		Type: qbtypes.QueryTypeFormula,
		Spec: qbtypes.QueryBuilderFormula{
			Name:       "error_rate",
			Expression: "(error_span/total_span)*100",
		},
	}
}

func buildWarningRateFormula() qbtypes.QueryEnvelope {
	return qbtypes.QueryEnvelope{
		Type: qbtypes.QueryTypeFormula,
		Spec: qbtypes.QueryBuilderFormula{
			Name:       "warning_rate",
			Expression: "(warning_span/total_span)*100",
		},
	}
}

func buildEndpointsInfoQuery(req *thirdpartyapitypes.ThirdPartyApiRequest) qbtypes.QueryEnvelope {
	return qbtypes.QueryEnvelope{
		Type: qbtypes.QueryTypeBuilder,
		Spec: qbtypes.QueryBuilderQuery[qbtypes.TraceAggregation]{
			Name:         "endpoints",
			Signal:       telemetrytypes.SignalTraces,
			StepInterval: qbtypes.Step{Duration: defaultStepInterval},
			Aggregations: []qbtypes.TraceAggregation{
				{Expression: fmt.Sprintf("rate(%s)", derivedKeyHTTPURL)},
			},
			Filter:  buildBaseFilter(req.Filter),
			GroupBy: mergeGroupBy(groupByKeyHTTPURL, req.GroupBy),
		},
	}
}

func buildP99InfoQuery(req *thirdpartyapitypes.ThirdPartyApiRequest) qbtypes.QueryEnvelope {
	return qbtypes.QueryEnvelope{
		Type: qbtypes.QueryTypeBuilder,
		Spec: qbtypes.QueryBuilderQuery[qbtypes.TraceAggregation]{
			Name:         "p99",
			Signal:       telemetrytypes.SignalTraces,
			StepInterval: qbtypes.Step{Duration: defaultStepInterval},
			Aggregations: []qbtypes.TraceAggregation{
				{Expression: "p99(duration_nano)"},
			},
			Filter:  buildBaseFilter(req.Filter),
			GroupBy: req.GroupBy,
		},
	}
}

func buildErrorRateInfoQuery(req *thirdpartyapitypes.ThirdPartyApiRequest) qbtypes.QueryEnvelope {
	return qbtypes.QueryEnvelope{
		Type: qbtypes.QueryTypeBuilder,
		Spec: qbtypes.QueryBuilderQuery[qbtypes.TraceAggregation]{
			Name:         "error_rate",
			Signal:       telemetrytypes.SignalTraces,
			StepInterval: qbtypes.Step{Duration: defaultStepInterval},
			Aggregations: []qbtypes.TraceAggregation{
				{Expression: "rate()"},
			},
			Filter:  buildBaseFilter(req.Filter),
			GroupBy: req.GroupBy,
		},
	}
}

func buildLastSeenInfoQuery(req *thirdpartyapitypes.ThirdPartyApiRequest) qbtypes.QueryEnvelope {
	return qbtypes.QueryEnvelope{
		Type: qbtypes.QueryTypeBuilder,
		Spec: qbtypes.QueryBuilderQuery[qbtypes.TraceAggregation]{
			Name:         "lastseen",
			Signal:       telemetrytypes.SignalTraces,
			StepInterval: qbtypes.Step{Duration: defaultStepInterval},
			Aggregations: []qbtypes.TraceAggregation{
				{Expression: "max(timestamp)"},
			},
			Filter:  buildBaseFilter(req.Filter),
			GroupBy: req.GroupBy,
		},
	}
}

func buildBaseFilter(additionalFilter *qbtypes.Filter) *qbtypes.Filter {
	baseExpression := fmt.Sprintf("%s EXISTS AND kind_string = 'Client'", derivedKeyHTTPURL)

	if additionalFilter != nil && additionalFilter.Expression != "" {
		// even if it contains kind_string we add with an AND so it doesn't matter if the user is overriding it.
		baseExpression = fmt.Sprintf("(%s) AND (%s)", baseExpression, additionalFilter.Expression)
	}

	return &qbtypes.Filter{Expression: baseExpression}
}

func buildAvgQuery(req *thirdpartyapitypes.ThirdPartyApiRequest) qbtypes.QueryEnvelope {
	return qbtypes.QueryEnvelope{
		Type: qbtypes.QueryTypeBuilder,
		Spec: qbtypes.QueryBuilderQuery[qbtypes.TraceAggregation]{
			Name:         "avg",
			Signal:       telemetrytypes.SignalTraces,
			StepInterval: qbtypes.Step{Duration: defaultStepInterval},
			Aggregations: []qbtypes.TraceAggregation{
				{Expression: "avg(duration_nano)"},
			},
			Filter:  buildBaseFilter(req.Filter),
			GroupBy: mergeGroupBy(getGroupByField(req), req.GroupBy),
		},
	}
}

func buildAvgInfoQuery(req *thirdpartyapitypes.ThirdPartyApiRequest) qbtypes.QueryEnvelope {
	return qbtypes.QueryEnvelope{
		Type: qbtypes.QueryTypeBuilder,
		Spec: qbtypes.QueryBuilderQuery[qbtypes.TraceAggregation]{
			Name:         "avg",
			Signal:       telemetrytypes.SignalTraces,
			StepInterval: qbtypes.Step{Duration: defaultStepInterval},
			Aggregations: []qbtypes.TraceAggregation{
				{Expression: "avg(duration_nano)"},
			},
			Filter:  buildBaseFilter(req.Filter),
			GroupBy: req.GroupBy,
		},
	}
}

func buildStatusFilter(codesStr string) string {
	patterns := strings.Split(codesStr, ",")
	var parts []string
	for _, p := range patterns {
		p = strings.TrimSpace(strings.ToLower(p))
		if p == "" {
			parts = append(parts, "response_status_code = '' OR response_status_code = 'n/a' OR response_status_code = '0' OR has_error = true")
		} else if strings.HasSuffix(p, "xx") {
			prefix := p[:len(p)-2]
			parts = append(parts, fmt.Sprintf("response_status_code LIKE '%s%%'", prefix))
		} else if strings.HasSuffix(p, "x") {
			prefix := p[:len(p)-1]
			parts = append(parts, fmt.Sprintf("response_status_code LIKE '%s%%'", prefix))
		} else {
			parts = append(parts, fmt.Sprintf("response_status_code = '%s'", p))
		}
	}
	if len(parts) == 0 {
		return "1 = 0"
	}
	return "(" + strings.Join(parts, " OR ") + ")"
}

func buildRulesFilter(hostField string, globalCodes string, apiRules map[string]thirdpartyapitypes.RuleConfig, isError bool) string {
	var parts []string
	var apiNames []string

	timeoutCondition := "(response_status_code = '' OR response_status_code = 'n/a' OR response_status_code = '0' OR has_error = true)"

	for apiName, rule := range apiRules {
		codes := rule.WarningCodes
		if isError {
			codes = rule.ErrorCodes
		}
		if codes == "" {
			codes = globalCodes
		}
		expr := buildStatusFilter(codes)
		if isError {
			expr = fmt.Sprintf("(%s OR %s)", expr, timeoutCondition)
		}
		parts = append(parts, fmt.Sprintf("(%s = '%s' AND %s)", hostField, apiName, expr))
		apiNames = append(apiNames, apiName)
	}

	// Add the global fallback
	globalExpr := buildStatusFilter(globalCodes)
	if isError {
		globalExpr = fmt.Sprintf("(%s OR %s)", globalExpr, timeoutCondition)
	}
	if len(apiNames) > 0 {
		var notInParts []string
		for _, name := range apiNames {
			notInParts = append(notInParts, fmt.Sprintf("'%s'", name))
		}
		parts = append(parts, fmt.Sprintf("(%s NOT IN (%s) AND %s)", hostField, strings.Join(notInParts, ", "), globalExpr))
	} else {
		parts = append(parts, globalExpr)
	}

	return "(" + strings.Join(parts, " OR ") + ")"
}
