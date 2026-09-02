import { QueryParams } from 'constants/query';
import ROUTES from 'constants/routes';
import { withBasePath } from 'utils/basePath';

import { TopOperationList } from './TopOperationsTable';
import { NavigateToTraceProps } from './types';

export const getErrorRate = (list: TopOperationList): number => {
	if (list.errorCount === 0 && list.numCalls === 0) {
		return 0;
	}
	return (list.errorCount / list.numCalls) * 100;
};

export const navigateToTrace = ({
	servicename,
	operation,
	minTime,
	maxTime,
	selectedTraceTags,
	apmToTraceQuery,
	safeNavigate,
	openInNewTab = false,
}: NavigateToTraceProps): void => {
	const urlParams = new URLSearchParams();
	urlParams.set(
		QueryParams.startTime,
		Math.floor(minTime / 1_000_000).toString(),
	);
	urlParams.set(QueryParams.endTime, Math.floor(maxTime / 1_000_000).toString());

	const JSONCompositeQuery = encodeURIComponent(JSON.stringify(apmToTraceQuery));

	const newTraceExplorerPath = `${
		ROUTES.TRACES_EXPLORER
	}?${urlParams.toString()}&selected={"serviceName":["${servicename}"],"operation":["${operation}"]}&filterToFetchData=["duration","status","serviceName","operation"]&spanAggregateCurrentPage=1&selectedTags=${selectedTraceTags}&${
		QueryParams.compositeQuery
	}=${JSONCompositeQuery}`;

	if (openInNewTab) {
		window.open(withBasePath(newTraceExplorerPath), '_blank');
	} else {
		safeNavigate(newTraceExplorerPath);
	}
};

export const getNearestHighestBucketValue = (
	value: number,
	buckets: number[],
): string => {
	// sort the buckets
	buckets.sort((a, b) => a - b);
	const nearestBucket = buckets.find((bucket) => bucket >= value);
	return nearestBucket?.toString() || '+Inf';
};

export const convertMilSecToNanoSec = (value: number): number =>
	value * 1000000000;

export const convertedTracesToDownloadData = (
	originalData: TopOperationList[],
): Record<string, string>[] =>
	originalData.map((item) => {
		const newObj: Record<string, string> = {
			Name: item.name,
			'P50 (in ms)': (item.p50 / 1000000).toFixed(2),
			'P95 (in ms)': (item.p95 / 1000000).toFixed(2),
			'P99 (in ms)': (item.p99 / 1000000).toFixed(2),
			'Number of calls': item.numCalls.toString(),
			'Error Rate (%)': getErrorRate(item).toFixed(2),
		};

		return newObj;
	});

export const isApiOperation = (operationName: string): boolean => {
	if (!operationName || typeof operationName !== 'string') {
		return false;
	}
	const trimmed = operationName.trim();
	if (!trimmed) {
		return false;
	}

	const lower = trimmed.toLowerCase();

	// Exclude known non-API / internal instrumentation prefixes
	const internalPrefixes = [
		'request handler',
		'middleware',
		'router -',
		'router.',
		'tcp.',
		'dns.',
		'fs.',
		'net.',
		'tls.',
		'http.client',
		'grpc.client',
		'pg.',
		'redis.',
		'mongodb.',
		'amqp.',
		'kafka.',
	];
	if (internalPrefixes.some((prefix) => lower.startsWith(prefix))) {
		return false;
	}

	// Exclude SQL queries like "DELETE FROM ...", "SELECT ...", "INSERT INTO ..."
	if (
		/^(select|insert|update|delete\s+from|delete\s+low_priority|delete\s+quick|create|alter|drop|truncate)\b/i.test(
			trimmed,
		)
	) {
		return false;
	}

	// Starts with standard HTTP method followed by an endpoint path or URL (e.g. "POST /path", "GET /api/...", "DELETE /users/1")
	// Bare methods like "GET", "POST", "get" without an endpoint path are excluded
	const httpMethodRegex =
		/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT|TRACE)\s+(\/|https?:\/\/).*/i;
	if (httpMethodRegex.test(trimmed)) {
		return true;
	}

	// Starts with "HTTP <METHOD>" followed by an endpoint path or URL (e.g. "HTTP GET /...")
	const httpPrefixRegex =
		/^HTTP(\/\d(\.\d)?)?\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/|https?:\/\/).*/i;
	if (httpPrefixRegex.test(trimmed)) {
		return true;
	}

	// Path-like operation starting with "/" (e.g. "/api/v1/users", "/enrich/get-vehicle-challans")
	if (trimmed.startsWith('/')) {
		return true;
	}

	// Full URL (e.g. "https://api.example.com/v1/...")
	if (/^https?:\/\//i.test(trimmed)) {
		return true;
	}

	// gRPC or RPC formatted like "package.Service/Method"
	if (/^[a-zA-Z0-9_.]+\/[a-zA-Z0-9_]+$/.test(trimmed)) {
		return true;
	}

	return false;
};
