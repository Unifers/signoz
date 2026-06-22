import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import MEditor, { Monaco } from '@monaco-editor/react';
import { Color } from '@signozhq/design-tokens';
import type { AuthtypesTransactionGroupDTO } from 'api/generated/services/sigNoz.schemas';
import { useIsDarkMode } from 'hooks/useDarkMode';

import {
	transformResourcePermissionsToTransactionGroups,
	transformTransactionGroupsToResourcePermissions,
} from '../../useRolePermissions';
import {
	registerCompletionProvider,
	registerJsonSchema,
	ROLE_PERMISSIONS_MODEL_PATH,
} from './jsonSchema.config';

import styles from './JsonEditor.module.scss';
import { JsonEditorProps } from './JsonEditor.types';

function JsonEditor({
	resources,
	mode,
	onChange,
}: JsonEditorProps): JSX.Element {
	const isDarkMode = useIsDarkMode();
	const [parseError, setParseError] = useState<string | null>(null);
	const [jsonBuffer, setJsonBuffer] = useState<string>(() => {
		const transactionGroups =
			transformResourcePermissionsToTransactionGroups(resources);
		return JSON.stringify(transactionGroups, null, 2);
	});
	const prevModeRef = useRef(mode);
	const completionDisposableRef = useRef<{ dispose(): void } | null>(null);

	// Reinitialize buffer when switching from interactive to json mode
	useEffect(() => {
		const wasInteractive = prevModeRef.current === 'interactive';
		const isNowJson = mode === 'json';

		if (wasInteractive && isNowJson) {
			const transactionGroups =
				transformResourcePermissionsToTransactionGroups(resources);
			setJsonBuffer(JSON.stringify(transactionGroups, null, 2));
			setParseError(null);
		}

		prevModeRef.current = mode;
	}, [mode, resources]);

	const handleEditorChange = useCallback(
		(value: string | undefined): void => {
			if (!value) {
				return;
			}

			setJsonBuffer(value);

			try {
				const parsed = JSON.parse(value) as AuthtypesTransactionGroupDTO[];
				const resourcePermissions =
					transformTransactionGroupsToResourcePermissions(parsed);
				setParseError(null);
				onChange(resourcePermissions);
			} catch (err) {
				setParseError(err instanceof Error ? err.message : 'Invalid JSON format');
			}
		},
		[onChange],
	);

	const configureMonaco = useCallback((monaco: Monaco): void => {
		monaco.editor.defineTheme('json-theme-dark', {
			base: 'vs-dark',
			inherit: true,
			rules: [
				{ token: 'string.key.json', foreground: Color.BG_VANILLA_400 },
				{ token: 'string.value.json', foreground: Color.BG_ROBIN_400 },
			],
			colors: {
				'editor.background': Color.BG_INK_400,
			},
		});

		registerJsonSchema(monaco);
		completionDisposableRef.current = registerCompletionProvider(monaco);
	}, []);

	useEffect(
		() => (): void => {
			completionDisposableRef.current?.dispose();
		},
		[],
	);

	const editorOptions = useMemo(
		() => ({
			automaticLayout: true,
			wordWrap: 'on' as const,
			minimap: {
				enabled: false,
			},
			fontFamily: 'Geist Mono',
			fontSize: 13,
			lineHeight: 20,
			scrollBeyondLastLine: false,
			folding: true,
			tabSize: 2,
			fixedOverflowWidgets: true,
		}),
		[],
	);

	return (
		<div className={styles.jsonEditor} data-testid="json-editor">
			<div className={styles.jsonEditorContainer}>
				<MEditor
					value={jsonBuffer}
					language="json"
					path={ROLE_PERMISSIONS_MODEL_PATH}
					options={editorOptions}
					onChange={handleEditorChange}
					height="100%"
					theme={isDarkMode ? 'json-theme-dark' : 'light'}
					beforeMount={configureMonaco}
				/>
			</div>
			<div className={styles.jsonEditorErrorWrapper}>
				{parseError && (
					<div className={styles.jsonEditorError} data-testid="json-editor-error">
						<span className={styles.jsonEditorErrorLabel}>Error:</span>
						<span className={styles.jsonEditorErrorMessage}>{parseError}</span>
					</div>
				)}
			</div>
		</div>
	);
}

export default JsonEditor;
