import axios from 'api';
import { ErrorResponseHandler } from 'api/ErrorResponseHandler';
import { AxiosError } from 'axios';
import { ErrorResponse, SuccessResponse } from 'types/api';
import { AdminHostMetricsResponse } from 'types/api/admin/hostMetrics';

export const getHostMetrics = async (): Promise<
	SuccessResponse<AdminHostMetricsResponse> | ErrorResponse
> => {
	try {
		const response = await axios.get<AdminHostMetricsResponse>(
			'/admin/host-metrics',
		);

		return {
			statusCode: 200,
			error: null,
			message: 'Success',
			payload: response.data,
		};
	} catch (error) {
		return ErrorResponseHandler(error as AxiosError);
	}
};

export default getHostMetrics;
