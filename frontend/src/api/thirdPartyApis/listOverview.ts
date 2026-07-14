import axios from 'api';
import { ErrorResponseHandlerV2 } from 'api/ErrorResponseHandlerV2';
import { AxiosError } from 'axios';
import { ErrorV2Resp, SuccessResponseV2 } from 'types/api';
import { PayloadProps, Props } from 'types/api/thirdPartyApis/listOverview';

const listOverview = async (
	props: Props,
	signal?: AbortSignal,
): Promise<SuccessResponseV2<PayloadProps>> => {
	const {
		start,
		end,
		show_ip: showIp,
		filter,
		group_by_url: groupByUrl,
		globalRule,
		apiRules,
	} = props;
	try {
		const response = await axios.post(
			`/third-party-apis/overview/list`,
			{
				start,
				end,
				show_ip: showIp,
				filter,
				group_by_url: groupByUrl,
				globalRule,
				apiRules,
			},
			{ signal },
		);

		return {
			httpStatusCode: response.status,
			data: response.data,
		};
	} catch (error) {
		ErrorResponseHandlerV2(error as AxiosError<ErrorV2Resp>);
	}
};

export default listOverview;
