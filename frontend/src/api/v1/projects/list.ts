import axios from 'api';
import { ErrorResponseHandlerV2 } from 'api/ErrorResponseHandlerV2';
import { AxiosError } from 'axios';
import { ErrorV2Resp, SuccessResponseV2 } from 'types/api';
import { PostableProject, Project } from 'types/api/v1/projects';

export const listProjects = async (): Promise<SuccessResponseV2<Project[]>> => {
	try {
		const response = await axios.get<Project[]>(`/api/v1/projects`);
		return {
			httpStatusCode: response.status,
			data: response.data,
		};
	} catch (error) {
		ErrorResponseHandlerV2(error as AxiosError<ErrorV2Resp>);
	}
	// unreachable; ErrorResponseHandlerV2 throws
	throw new Error('listProjects: unreachable');
};

export const getProject = async (
	id: string,
): Promise<SuccessResponseV2<Project>> => {
	try {
		const response = await axios.get<Project>(`/api/v1/projects/${id}`);
		return {
			httpStatusCode: response.status,
			data: response.data,
		};
	} catch (error) {
		ErrorResponseHandlerV2(error as AxiosError<ErrorV2Resp>);
	}
	throw new Error('getProject: unreachable');
};

export const createProject = async (
	body: PostableProject,
): Promise<SuccessResponseV2<Project>> => {
	try {
		const response = await axios.post<Project>(`/api/v1/projects`, body);
		return {
			httpStatusCode: response.status,
			data: response.data,
		};
	} catch (error) {
		ErrorResponseHandlerV2(error as AxiosError<ErrorV2Resp>);
	}
	throw new Error('createProject: unreachable');
};

export const updateProject = async (
	id: string,
	body: { description?: string; logTypes?: string[] },
): Promise<SuccessResponseV2<null>> => {
	try {
		const response = await axios.put<null>(`/api/v1/projects/${id}`, body);
		return {
			httpStatusCode: response.status,
			data: response.data,
		};
	} catch (error) {
		ErrorResponseHandlerV2(error as AxiosError<ErrorV2Resp>);
	}
	throw new Error('updateProject: unreachable');
};

export const deleteProject = async (
	id: string,
): Promise<SuccessResponseV2<null>> => {
	try {
		const response = await axios.delete<null>(`/api/v1/projects/${id}`);
		return {
			httpStatusCode: response.status,
			data: response.data,
		};
	} catch (error) {
		ErrorResponseHandlerV2(error as AxiosError<ErrorV2Resp>);
	}
	throw new Error('deleteProject: unreachable');
};
