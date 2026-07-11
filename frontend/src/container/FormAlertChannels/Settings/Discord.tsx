import { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Form, Input } from 'antd';
import { MarkdownRenderer } from 'components/MarkdownRenderer/MarkdownRenderer';

import { DiscordChannel } from '../../CreateAlertChannels/config';

const { TextArea } = Input;

function Discord({ setSelectedConfig }: DiscordProps): JSX.Element {
	const { t } = useTranslation('channels');

	return (
		<>
			<Form.Item
				name="webhook_url"
				label={t('field_webhook_url')}
				tooltip={{
					title: (
						<MarkdownRenderer
							markdownContent={t('tooltip_discord_url')}
							variables={{}}
						/>
					),
					overlayInnerStyle: { maxWidth: 400 },
					placement: 'right',
				}}
			>
				<Input
					onChange={(event): void => {
						setSelectedConfig((value) => ({
							...value,
							webhook_url: event.target.value,
							api_url: event.target.value,
						}));
					}}
					data-testid="webhook-url-textbox"
				/>
			</Form.Item>

			<Form.Item name="title" label={t('field_discord_title')}>
				<TextArea
					data-testid="title-textarea"
					rows={4}
					onChange={(event): void =>
						setSelectedConfig((value) => ({
							...value,
							title: event.target.value,
						}))
					}
				/>
			</Form.Item>

			<Form.Item name="message" label={t('field_discord_message')}>
				<TextArea
					onChange={(event): void =>
						setSelectedConfig((value) => ({
							...value,
							message: event.target.value,
						}))
					}
					placeholder={t('placeholder_discord_message')}
					data-testid="message-textarea"
				/>
			</Form.Item>
		</>
	);
}

interface DiscordProps {
	setSelectedConfig: Dispatch<SetStateAction<Partial<DiscordChannel>>>;
}

export default Discord;
