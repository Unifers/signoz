import { DiscordChannel } from 'container/CreateAlertChannels/config';

export interface Props extends DiscordChannel {
	id: string;
}

export interface PayloadProps {
	data: string;
	status: string;
}
