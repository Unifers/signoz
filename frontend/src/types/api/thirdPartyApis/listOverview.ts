import { APIMonitoringResponseColumn } from 'container/ApiMonitoring/types';

import { RequestType } from '../v5/queryRange';

export interface RuleConfig {
	errorCodes: string;
	warningCodes: string;
	successErrorRate: number;
	warningErrorRate: number;
}

export interface Props {
	start: number;
	end: number;
	show_ip: boolean;
	group_by_url?: boolean;
	filter: {
		expression: string;
	};
	globalRule?: RuleConfig;
	apiRules?: Record<string, RuleConfig>;
}

export interface PayloadProps {
	data: {
		data: {
			results: {
				columns: APIMonitoringResponseColumn[];
				data: string[][];
			}[];
		};
		meta: {
			rowsScanned: number;
			bytesScanned: number;
			durationMs: number;
		};
		type: RequestType;
	};
	status: string;
}
