import { TraceBuilderQuery } from 'types/api/v5/queryRange';
import {
	buildReceivedApiQueryPayload,
	computeApiStatus,
	DEFAULT_GLOBAL_RULE,
	parseScalarDataToRows,
	RuleConfig,
} from './useReceivedApiOverview';

describe('useReceivedApiOverview', () => {
	describe('computeApiStatus', () => {
		const rule: RuleConfig = {
			errorCodes: '5xx',
			warningCodes: '4xx',
			successErrorRate: 5,
			warningErrorRate: 10,
		};

		it('returns success when error and warning rates are below threshold', () => {
			expect(computeApiStatus(2, 4, rule)).toBe('success');
			expect(computeApiStatus(0, 0, rule)).toBe('success');
		});

		it('returns warning when error rate exceeds success threshold but below warning threshold', () => {
			expect(computeApiStatus(6, 2, rule)).toBe('warning');
		});

		it('returns warning when warning rate exceeds success threshold', () => {
			expect(computeApiStatus(2, 6, rule)).toBe('warning');
		});

		it('returns error when error rate exceeds warning threshold', () => {
			expect(computeApiStatus(11, 2, rule)).toBe('error');
		});
	});

	describe('buildReceivedApiQueryPayload', () => {
		it('builds a scalar request with start, end, and aggregations', () => {
			const startNs = 1700000000000000000;
			const endNs = 1700003600000000000;
			const payload = buildReceivedApiQueryPayload(startNs, endNs);

			expect(payload.requestType).toBe('scalar');
			expect(payload.start).toBe(1700000000000);
			expect(payload.end).toBe(1700003600000);

			const query = payload.compositeQuery.queries[0];
			expect(query.type).toBe('builder_query');
			const spec = query.spec as TraceBuilderQuery;
			expect(spec.aggregations?.length).toBe(6);
			expect(spec.groupBy).toStrictEqual([
				{ name: 'name', fieldDataType: 'string', fieldContext: 'span' },
				{ name: 'service.name', fieldDataType: 'string', fieldContext: 'resource' },
			]);
		});

		it('appends custom filter expression', () => {
			const payload = buildReceivedApiQueryPayload(
				1700000000000000000,
				1700003600000000000,
				"service.name = 'cartservice'",
			);
			const query = payload.compositeQuery.queries[0];
			const spec = query.spec as TraceBuilderQuery;
			expect(spec.filter?.expression).toContain("service.name = 'cartservice'");
			expect(spec.filter?.expression).toContain("kind_string = 'Server'");
		});
	});

	describe('parseScalarDataToRows', () => {
		it('returns empty array when scalar data is missing', () => {
			expect(
				parseScalarDataToRows(undefined, 3600, DEFAULT_GLOBAL_RULE, {}),
			).toStrictEqual([]);
		});

		it('correctly maps columns and computes metrics and status', () => {
			const mockScalarData = {
				columns: [
					{
						name: 'name',
						columnType: 'group' as const,
						fieldDataType: 'string' as const,
						fieldContext: 'span' as const,
						queryName: 'A',
						aggregationIndex: -1,
					},
					{
						name: 'service.name',
						columnType: 'group' as const,
						fieldDataType: 'string' as const,
						fieldContext: 'resource' as const,
						queryName: 'A',
						aggregationIndex: -1,
					},
					{
						name: 'total_span',
						columnType: 'aggregation' as const,
						fieldDataType: 'number' as const,
						fieldContext: 'span' as const,
						queryName: 'A',
						aggregationIndex: 0,
					},
					{
						name: 'lastseen',
						columnType: 'aggregation' as const,
						fieldDataType: 'number' as const,
						fieldContext: 'span' as const,
						queryName: 'A',
						aggregationIndex: 1,
					},
					{
						name: 'p99',
						columnType: 'aggregation' as const,
						fieldDataType: 'number' as const,
						fieldContext: 'span' as const,
						queryName: 'A',
						aggregationIndex: 2,
					},
					{
						name: 'avg',
						columnType: 'aggregation' as const,
						fieldDataType: 'number' as const,
						fieldContext: 'span' as const,
						queryName: 'A',
						aggregationIndex: 3,
					},
					{
						name: 'error_span',
						columnType: 'aggregation' as const,
						fieldDataType: 'number' as const,
						fieldContext: 'span' as const,
						queryName: 'A',
						aggregationIndex: 4,
					},
					{
						name: 'warning_span',
						columnType: 'aggregation' as const,
						fieldDataType: 'number' as const,
						fieldContext: 'span' as const,
						queryName: 'A',
						aggregationIndex: 5,
					},
				],
				data: [
					[
						'GET /api/v1/orders',
						'order-service',
						1000,
						1700000000000000000,
						150000000, // 150ms p99
						50000000, // 50ms avg
						20, // 2% error
						30, // 3% warning
					],
				],
			};

			const rows = parseScalarDataToRows(
				mockScalarData,
				100, // 100 seconds
				DEFAULT_GLOBAL_RULE,
				{},
			);

			expect(rows).toHaveLength(1);
			expect(rows[0].endpoint).toBe('GET /api/v1/orders');
			expect(rows[0].serviceName).toBe('order-service');
			expect(rows[0].totalCount).toBe(1000);
			expect(rows[0].rate).toBe(10); // 1000 / 100s
			expect(rows[0].p99Latency).toBe(150);
			expect(rows[0].latency).toBe(50);
			expect(rows[0].errorRate).toBe(2);
			expect(rows[0].warningRate).toBe(3);
			expect(rows[0].successRate).toBe(95);
			expect(rows[0].status).toBe('success');
		});
	});
});
