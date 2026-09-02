import { getTopOperationList } from './__mocks__/getTopOperation';
import { TopOperationList } from './TopOperationsTable';
import {
	convertedTracesToDownloadData,
	getErrorRate,
	getNearestHighestBucketValue,
	isApiOperation,
} from './utils';

describe('Error Rate', () => {
	it('should return correct error rate', () => {
		const list: TopOperationList = getTopOperationList({
			errorCount: 10,
			numCalls: 100,
		});

		expect(getErrorRate(list)).toBe(10);
	});

	it('should handle no errors gracefully', () => {
		const list = getTopOperationList({ errorCount: 0, numCalls: 100 });
		expect(getErrorRate(list)).toBe(0);
	});

	it('should handle zero calls', () => {
		const list = getTopOperationList({ errorCount: 0, numCalls: 0 });
		expect(getErrorRate(list)).toBe(0);
	});
});

describe('getNearestHighestBucketValue', () => {
	it('should return nearest higher bucket value', () => {
		expect(getNearestHighestBucketValue(50, [10, 20, 30, 40, 60, 70])).toBe('60');
	});

	it('should return +Inf for value higher than any bucket', () => {
		expect(getNearestHighestBucketValue(80, [10, 20, 30, 40, 60, 70])).toBe(
			'+Inf',
		);
	});

	it('should return the first bucket for value lower than all buckets', () => {
		expect(getNearestHighestBucketValue(5, [10, 20, 30, 40, 60, 70])).toBe('10');
	});
});

describe('convertedTracesToDownloadData', () => {
	it('should convert trace data correctly', () => {
		const data = [
			{
				name: 'op1',
				p50: 50000000,
				p95: 95000000,
				p99: 99000000,
				numCalls: 100,
				errorCount: 10,
			},
		];

		expect(convertedTracesToDownloadData(data)).toStrictEqual([
			{
				Name: 'op1',
				'P50 (in ms)': '50.00',
				'P95 (in ms)': '95.00',
				'P99 (in ms)': '99.00',
				'Number of calls': '100',
				'Error Rate (%)': '10.00',
			},
		]);
	});
});

describe('isApiOperation', () => {
	it('should return true for HTTP methods with path', () => {
		expect(isApiOperation('POST /enrich/get-vehicle-challans')).toBe(true);
		expect(isApiOperation('GET /api/v1/users')).toBe(true);
		expect(isApiOperation('PUT /items/42')).toBe(true);
		expect(isApiOperation('DELETE /items/42')).toBe(true);
		expect(isApiOperation('PATCH /orders/1')).toBe(true);
	});

	it('should return false for bare HTTP method names without endpoint path', () => {
		expect(isApiOperation('GET')).toBe(false);
		expect(isApiOperation('POST')).toBe(false);
		expect(isApiOperation('PUT')).toBe(false);
		expect(isApiOperation('DELETE')).toBe(false);
		expect(isApiOperation('get')).toBe(false);
		expect(isApiOperation('post')).toBe(false);
	});

	it('should return true for path-like operation names', () => {
		expect(isApiOperation('/enrich/get-vehicle-challans')).toBe(true);
		expect(isApiOperation('/api/v1/checkout')).toBe(true);
		expect(isApiOperation('/healthz')).toBe(true);
	});

	it('should return false for express handler/middleware spans and internal spans', () => {
		expect(isApiOperation('request handler - /enrich/get-vehicle-challans')).toBe(
			false,
		);
		expect(isApiOperation('middleware - query')).toBe(false);
		expect(isApiOperation('router - /api')).toBe(false);
		expect(isApiOperation('tcp.connect')).toBe(false);
		expect(isApiOperation('dns.lookup')).toBe(false);
		expect(isApiOperation('fs.readFile')).toBe(false);
		expect(isApiOperation('redis.get')).toBe(false);
		expect(isApiOperation('mongodb.find')).toBe(false);
	});

	it('should return false for database queries', () => {
		expect(isApiOperation('SELECT * FROM users')).toBe(false);
		expect(isApiOperation('DELETE FROM users WHERE id = 1')).toBe(false);
		expect(isApiOperation('INSERT INTO logs VALUES(1)')).toBe(false);
		expect(isApiOperation('UPDATE users SET name = "test"')).toBe(false);
	});

	it('should return false for empty, null, or invalid input', () => {
		expect(isApiOperation('')).toBe(false);
		expect(isApiOperation('   ')).toBe(false);
		expect(isApiOperation(null as any)).toBe(false);
		expect(isApiOperation(undefined as any)).toBe(false);
	});
});
