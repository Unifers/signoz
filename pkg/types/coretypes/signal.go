package coretypes

import "github.com/SigNoz/signoz/pkg/errors"

// ResourceForSignal maps a v5 query signal name (e.g. "logs", "traces",
// "metrics") to the canonical Resource used for authorization. Returns
// an error for unknown signal names so callers can produce a 400 rather
// than silently fall through to a wildcard.
func ResourceForSignal(signal string) (Resource, error) {
	switch signal {
	case "logs":
		return ResourceTelemetryResourceLogs, nil
	case "traces":
		return ResourceTelemetryResourceTraces, nil
	case "metrics":
		return ResourceTelemetryResourceMetrics, nil
	default:
		return nil, errors.Newf(errors.TypeInvalidInput, ErrCodeResourceNotFound, "unknown telemetry signal: %s", signal)
	}
}
