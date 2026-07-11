import { useMemo } from 'react';
import { useHistory, useParams } from 'react-router-dom';
import { Button } from '@signozhq/ui/button';
import { Tabs, TabsProps } from 'antd';
import { Skeleton } from 'antd';
import { CircleAlert } from '@signozhq/icons';
import { useAppContext } from 'providers/App/App';
import { QueryParams } from 'constants/query';
import DBCall from 'container/MetricsApplication/Tabs/DBCall';
import External from 'container/MetricsApplication/Tabs/External';
import Overview from 'container/MetricsApplication/Tabs/Overview';
import ResourceAttributesFilter from 'container/ResourceAttributesFilter';
import { extractProjectPermissions } from 'container/RolesSettings/projectPermissionsHelper';
import { useSafeNavigate } from 'hooks/useSafeNavigate';
import { useServicesList } from 'hooks/useServicesList';
import useUrlQuery from 'hooks/useUrlQuery';

import ApDexApplication from './ApDex/ApDexApplication';
import { MetricsApplicationTab, TAB_KEY_VS_LABEL } from './types';
import useMetricsApplicationTabKey from './useMetricsApplicationTabKey';

import styles from './MetricsApplication.module.scss';
import './MetricsApplication.styles.scss';

function ServiceAccessDenied({
	serviceName,
}: {
	serviceName: string;
}): JSX.Element {
	const history = useHistory();
	return (
		<div className={styles.forbidden} data-testid="service-access-denied-banner">
			<CircleAlert size={32} className={styles.icon} />
			<h2 className={styles.title}>
				{`You don't have access to "${serviceName}"`}
			</h2>
			<p className={styles.body}>
				This service is outside your assigned projects. Contact your admin to
				request access.
			</p>
			<div className={styles.actions}>
				<Button
					variant="solid"
					color="primary"
					onClick={(): void => history.push('/services')}
					data-testid="service-access-denied-back-button"
				>
					Back to services
				</Button>
			</div>
		</div>
	);
}

function MetricsApplication(): JSX.Element {
	const { servicename: encodedServiceName } = useParams<{
		servicename: string;
	}>();

	const urlQuery = useUrlQuery();
	const { safeNavigate } = useSafeNavigate();

	const { data: allowedServices, isLoading: isAllowedLoading } =
		useServicesList();

	const decodedServiceName = useMemo(() => {
		try {
			return decodeURIComponent(encodedServiceName);
		} catch {
			return encodedServiceName;
		}
	}, [encodedServiceName]);

	// Phase 2 page-entry access check: a restricted user may not directly
	// navigate to /services/:servicename for a service they don't own.
	const isAccessDenied = useMemo(() => {
		if (!Array.isArray(allowedServices)) {
			return false;
		}
		return !allowedServices.includes(decodedServiceName);
	}, [allowedServices, decodedServiceName]);

	const { user } = useAppContext();

	const hasExternalApiAccess = useMemo(() => {
		const userRoles = user.userRoles;
		if (!userRoles || userRoles.length === 0) {
			return true;
		}

		// If any role is a managed role, allow access
		const hasManagedRole = userRoles.some((ur) => ur.role?.type === 'managed');
		if (hasManagedRole) {
			return true;
		}

		// Check project permissions inside custom roles
		let hasAccess = false;
		for (const ur of userRoles) {
			if (!ur.role) {
				continue;
			}
			const { projectPermissions } = extractProjectPermissions(
				ur.role.description || '',
			);
			for (const perm of projectPermissions) {
				const isAllProjects =
					perm.project === 'All Services' ||
					perm.project === 'All Projects' ||
					perm.project === '*';
				if (perm.externalApi === 'read') {
					if (isAllProjects) {
						return true;
					}
					if (perm.project.toLowerCase() === decodedServiceName.toLowerCase()) {
						hasAccess = true;
					}
				}
			}
		}
		return hasAccess;
	}, [user, decodedServiceName]);

	const items = useMemo((): TabsProps['items'] => {
		const baseItems: TabsProps['items'] = [
			{
				label: TAB_KEY_VS_LABEL[MetricsApplicationTab.OVER_METRICS],
				key: MetricsApplicationTab.OVER_METRICS,
				children: <Overview />,
			},
			{
				label: TAB_KEY_VS_LABEL[MetricsApplicationTab.DB_CALL_METRICS],
				key: MetricsApplicationTab.DB_CALL_METRICS,
				children: <DBCall />,
			},
		];
		if (hasExternalApiAccess) {
			baseItems.push({
				label: TAB_KEY_VS_LABEL[MetricsApplicationTab.EXTERNAL_METRICS],
				key: MetricsApplicationTab.EXTERNAL_METRICS,
				children: <External />,
			});
		}
		return baseItems;
	}, [hasExternalApiAccess]);

	const rawActiveKey = useMetricsApplicationTabKey();
	const activeKey = useMemo(() => {
		if (
			rawActiveKey === MetricsApplicationTab.EXTERNAL_METRICS &&
			!hasExternalApiAccess
		) {
			return MetricsApplicationTab.OVER_METRICS;
		}
		return rawActiveKey;
	}, [rawActiveKey, hasExternalApiAccess]);

	const onTabChange = (tab: string): void => {
		urlQuery.set(QueryParams.tab, tab);
		safeNavigate(`/services/${encodedServiceName}?${urlQuery.toString()}`);
	};

	if (isAllowedLoading) {
		return (
			<div
				className="metrics-application-container"
				data-testid="metrics-application-loading"
			>
				<Skeleton active paragraph={{ rows: 8 }} />
			</div>
		);
	}

	if (isAccessDenied) {
		return (
			<div className="metrics-application-container">
				<ServiceAccessDenied serviceName={decodedServiceName} />
			</div>
		);
	}

	return (
		<div className="metrics-application-container">
			<ResourceAttributesFilter />
			<ApDexApplication />
			<Tabs
				items={items}
				activeKey={activeKey}
				className="service-route-tab"
				destroyInactiveTabPane
				onChange={onTabChange}
			/>
		</div>
	);
}

export default MetricsApplication;
