import styles from './SelectedItemsChips.module.scss';

export interface SelectedItemsChipsProps {
	ids: string[];
	testId?: string;
}

function SelectedItemsChips({
	ids,
	testId,
}: SelectedItemsChipsProps): JSX.Element {
	return (
		<ul className={styles.chips} data-testid={testId}>
			{ids.map((id) => (
				<li key={id} className={styles.chip}>
					<span className={styles.chipDot} />
					<span className={styles.chipLabel}>{id}</span>
				</li>
			))}
		</ul>
	);
}

export default SelectedItemsChips;
