import { useMemo } from 'react';
import {
	IQuickFiltersConfig,
	QuickFiltersSource,
} from 'components/QuickFilters/types';
import { DATA_TYPE_VS_ATTRIBUTE_VALUES_KEY } from 'constants/queryBuilder';
import { useGetAggregateValues } from 'hooks/queryBuilder/useGetAggregateValues';
import { useGetQueryKeyValueSuggestions } from 'hooks/querySuggestions/useGetQueryKeyValueSuggestions';
import { useServicesList } from 'hooks/useServicesList';
import { DataTypes } from 'types/api/queryBuilder/queryAutocompleteResponse';
import { DataSource } from 'types/common/queryBuilder';

import { isKeyMatch } from './utils';

interface UseCheckboxFilterValuesProps {
	filter: IQuickFiltersConfig;
	source: QuickFiltersSource;
	searchText: string;
	isOpen: boolean;
}

interface UseCheckboxFilterValuesReturn {
	attributeValues: string[];
	isLoading: boolean;
}

function useCheckboxFilterValues({
	filter,
	source,
	searchText,
	isOpen,
}: UseCheckboxFilterValuesProps): UseCheckboxFilterValuesReturn {
	const { data, isLoading } = useGetAggregateValues(
		{
			aggregateOperator: filter.aggregateOperator || 'noop',
			dataSource: filter.dataSource || DataSource.LOGS,
			aggregateAttribute: filter.aggregateAttribute || '',
			attributeKey: filter.attributeKey.key,
			filterAttributeKeyDataType: filter.attributeKey.dataType || DataTypes.EMPTY,
			tagType: filter.attributeKey.type || '',
			searchText: searchText ?? '',
		},
		{
			enabled: isOpen && source !== QuickFiltersSource.METER_EXPLORER,
			keepPreviousData: true,
		},
	);

	const { data: keyValueSuggestions, isLoading: isLoadingKeyValueSuggestions } =
		useGetQueryKeyValueSuggestions({
			key: filter.attributeKey.key,
			signal: filter.dataSource || DataSource.LOGS,
			signalSource: 'meter',
			options: {
				enabled: isOpen && source === QuickFiltersSource.METER_EXPLORER,
				keepPreviousData: true,
			},
		});

	// For the `service.name` filter, intersect the aggregator's values with the
	// services the current user is permitted to access. The aggregator endpoint
	// returns every distinct service name in the org's data without consulting
	// the caller's role, so without this intersection a restricted-role user
	// sees (and can pick) services they have no access to — e.g. "Arka" — in
	// the Logs / Traces / Exceptions / External APIs quick-filter dropdown.
	//
	// `useServicesList` calls the role-aware `/api/v2/services` endpoint, which
	// returns the full org list for unrestricted users (Admin / Editor / custom
	// roles with full access), so this intersection is a no-op for them. For
	// restricted users the backend already trimmed the response, so the
	// intersection removes anything not in the allow-list.
	const isServiceNameFilter = useMemo(
		() => isKeyMatch(filter.attributeKey.key, 'service.name'),
		[filter.attributeKey.key],
	);

	const { data: allowedServices, isLoading: isLoadingAllowedServices } =
		useServicesList();

	const attributeValues: string[] = useMemo(() => {
		const dataType = filter.attributeKey.dataType || DataTypes.String;

		if (source === QuickFiltersSource.METER_EXPLORER && keyValueSuggestions) {
			// Process the response data
			const responseData = keyValueSuggestions?.data as any;
			const values = responseData.data?.values || {};
			const stringValues = values.stringValues || [];
			const numberValues = values.numberValues || [];

			// Generate options from string values - explicitly handle empty strings
			const stringOptions = stringValues
				// Strict filtering for empty string - we'll handle it as a special case if needed
				.filter(
					(value: string | null | undefined): value is string =>
						value !== null && value !== undefined && value !== '',
				);

			// Generate options from number values
			const numberOptions = numberValues
				.filter(
					(value: number | null | undefined): value is number =>
						value !== null && value !== undefined,
				)
				.map((value: number) => value.toString());

			// Combine all options and make sure we don't have duplicate labels
			return [...stringOptions, ...numberOptions];
		}

		const key = DATA_TYPE_VS_ATTRIBUTE_VALUES_KEY[dataType];
		const aggregatorValues = (data?.payload?.[key] || []).filter(
			(val) => val !== undefined && val !== null,
		);

		// For service.name, suppress the aggregator values until the allow-list
		// has loaded so we never flash services the user can't access. The
		// parent treats `isLoading` as a loading state, so the user just sees
		// the existing skeleton until the intersection is ready.
		if (isServiceNameFilter) {
			if (!allowedServices || allowedServices.length === 0) {
				return [];
			}
			const allowed = new Set(allowedServices);
			return aggregatorValues.filter((val) => allowed.has(val as string));
		}

		return aggregatorValues;
	}, [
		data?.payload,
		filter.attributeKey.dataType,
		keyValueSuggestions,
		source,
		isServiceNameFilter,
		allowedServices,
	]);

	return {
		attributeValues,
		isLoading:
			isLoading ||
			isLoadingKeyValueSuggestions ||
			(isServiceNameFilter && isLoadingAllowedServices),
	};
}

export default useCheckboxFilterValues;
