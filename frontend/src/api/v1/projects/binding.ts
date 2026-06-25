import axios from 'api';
import { ErrorResponseHandlerV2 } from 'api/ErrorResponseHandlerV2';
import { AxiosError } from 'axios';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { ErrorV2Resp, SuccessResponseV2 } from 'types/api';
import {
	PostableProjectMember,
	ProjectMember,
	TelemetrySignal,
} from 'types/api/v1/projects';

const BINDING_LIST_KEY = (projectId: string): string[] => [
	'project-members',
	projectId,
];

export const addProjectMember = async (
	projectId: string,
	body: PostableProjectMember,
): Promise<SuccessResponseV2<null>> => {
	try {
		const response = await axios.post<null>(
			`/api/v1/projects/${projectId}/members`,
			body,
		);
		return {
			httpStatusCode: response.status,
			data: response.data,
		};
	} catch (error) {
		ErrorResponseHandlerV2(error as AxiosError<ErrorV2Resp>);
	}
	throw new Error('addProjectMember: unreachable');
};

export const removeProjectMember = async (
	projectId: string,
	userId: string,
	logType: string,
	signal: TelemetrySignal,
): Promise<SuccessResponseV2<null>> => {
	try {
		const response = await axios.delete<null>(
			`/api/v1/projects/${projectId}/members/${userId}/${logType}/${signal}`,
		);
		return {
			httpStatusCode: response.status,
			data: response.data,
		};
	} catch (error) {
		ErrorResponseHandlerV2(error as AxiosError<ErrorV2Resp>);
	}
	throw new Error('removeProjectMember: unreachable');
};

export const listProjectMembers = async (
	projectId: string,
): Promise<SuccessResponseV2<ProjectMember[]>> => {
	try {
		const response = await axios.get<ProjectMember[]>(
			`/api/v1/projects/${projectId}/members`,
		);
		return {
			httpStatusCode: response.status,
			data: response.data,
		};
	} catch (error) {
		ErrorResponseHandlerV2(error as AxiosError<ErrorV2Resp>);
	}
	throw new Error('listProjectMembers: unreachable');
};

export const useListProjectMembers = (
	projectId: string,
): {
	data: ProjectMember[] | undefined;
	isLoading: boolean;
} => {
	const query = useQuery({
		queryFn: () => listProjectMembers(projectId),
		queryKey: BINDING_LIST_KEY(projectId),
		select: (res) => res?.data ?? [],
		enabled: !!projectId,
	});

	return {
		data: query.data,
		isLoading: query.isLoading,
	};
};

export const useAddProjectMember = (
	projectId: string,
): {
	mutate: (
		body: PostableProjectMember,
		options?: { onSuccess?: () => void; onError?: (err: Error) => void },
	) => void;
} => {
	const queryClient = useQueryClient();
	const mutation = useMutation({
		mutationFn: (body: PostableProjectMember) =>
			addProjectMember(projectId, body),
		onSuccess: () => {
			void queryClient.invalidateQueries(BINDING_LIST_KEY(projectId));
		},
	});

	return {
		mutate: (body, options) => {
			void mutation.mutateAsync(body, {
				onSuccess: () => options?.onSuccess?.(),
				onError: (err) => options?.onError?.(err as Error),
			});
		},
	};
};

export const useRemoveProjectMember = (
	projectId: string,
): {
	mutate: (
		args: {
			userId: string;
			logType: string;
			signal: TelemetrySignal;
		},
		options?: { onSuccess?: () => void; onError?: (err: Error) => void },
	) => void;
} => {
	const queryClient = useQueryClient();
	const mutation = useMutation({
		mutationFn: (args: {
			userId: string;
			logType: string;
			signal: TelemetrySignal;
		}) => removeProjectMember(projectId, args.userId, args.logType, args.signal),
		onSuccess: () => {
			void queryClient.invalidateQueries(BINDING_LIST_KEY(projectId));
		},
	});

	return {
		mutate: (args, options) => {
			void mutation.mutateAsync(args, {
				onSuccess: () => options?.onSuccess?.(),
				onError: (err) => options?.onError?.(err as Error),
			});
		},
	};
};
