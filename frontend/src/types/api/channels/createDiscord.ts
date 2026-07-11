import { DiscordChannel } from 'container/CreateAlertChannels/config';

export type Props = DiscordChannel;

export interface PayloadProps {
	data: string;
	status: string;
}
