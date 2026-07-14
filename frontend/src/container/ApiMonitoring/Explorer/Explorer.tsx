import { useEffect, useState } from 'react';
import * as Sentry from '@sentry/react';
import logEvent from 'api/common/logEvent';
import cx from 'classnames';
import QuickFilters from 'components/QuickFilters/QuickFilters';
import { QuickFiltersSource, SignalType } from 'components/QuickFilters/types';
import ErrorBoundaryFallback from 'pages/ErrorBoundaryFallback/ErrorBoundaryFallback';

import DomainList from './Domains/DomainList';

import './Explorer.styles.scss';

function Explorer(): JSX.Element {
	const [showQuickFilters, setShowQuickFilters] = useState(true);

	useEffect(() => {
		logEvent('API Monitoring: Landing page visited', {});
	}, []);

	return (
		<Sentry.ErrorBoundary fallback={<ErrorBoundaryFallback />}>
			<div
				className={cx('api-monitoring-page', {
					'filter-visible': showQuickFilters,
				})}
			>
				{showQuickFilters && (
					<section className="api-quick-filter-left-section">
						<QuickFilters
							className="qf-api-monitoring"
							source={QuickFiltersSource.API_MONITORING}
							signal={SignalType.API_MONITORING}
							showFilterCollapse={true}
							showQueryName={false}
							handleFilterVisibilityChange={(): void => {
								setShowQuickFilters(false);
							}}
						/>
					</section>
				)}
				<DomainList
					showQuickFilters={showQuickFilters}
					setShowQuickFilters={setShowQuickFilters}
				/>
			</div>
		</Sentry.ErrorBoundary>
	);
}

export default Explorer;
