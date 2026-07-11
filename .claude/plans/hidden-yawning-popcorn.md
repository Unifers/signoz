# Phase 2 — Block `/services/:servicename` for unauthorized users

## Context

A user with a custom role that only grants access to the `traky-api` service can currently open `/services/Arka` and view that service's metrics, traces, and dependency data. Phase 1 closed the data-exfiltration gap on two v2 service endpoints (`/api/v2/service/top_operations`, `/api/v2/service/entry_point_operations`) by returning 403, but did nothing about the URL itself — the service-detail page is still rendered, and several other data endpoints that the page calls (the v1 list endpoint and the v3 builder queries rewriter via `restrictQueryRequest`) continue to return whatever the restricted user is broadly allowed to see.

The user wants: when a restricted user opens `/services/Arka` (a service they don't own), show an explicit "no access" state inside the page rather than redirecting.

## Approach

Add a **page-entry access check** on `MetricsApplication` — the route component for `/services/:servicename`. The check uses the existing `GET /api/v1/services/list` endpoint, which Phase 1 already filters down to the user's allowed services. If the URL's `:servicename` is not in that list, render a 403 state instead of the metrics tabs.

This is the lightest touch that satisfies the "no access" UX without requiring backend changes to every trace/log/metric endpoint. A restricted user typing `/services/Arka` sees a clear error and never sees `Arka`'s data.

### Critical files

- **`frontend/src/pages/MetricsApplication/MetricsApplication.tsx`** — the page component for `/services/:servicename`. Add the access check here. Today this file is 65 lines and only renders tabs.
- **`frontend/src/hooks/useServicesList.ts`** *(new)* — shared hook that calls `GET /api/v1/services/list` and returns the list of service names the current user is allowed to access. The existing `RolesSettings/hooks/useGetServicesList.ts` has the same logic but is namespaced under role settings; extracting a shared hook keeps concerns clean and lets both callers (this page and the role editor) use the same source. Phase 2 introduces the shared hook and updates `RolesSettings` to import it; the existing nested hook can be removed in a follow-up once we verify no other consumer exists.
- **`frontend/src/pages/MetricsApplication/MetricsApplication.module.scss`** *(new)* — styles for the forbidden-state layout (centered card with icon, title, body, and "back to services" button). CSS Modules per project convention.
- **`frontend/src/pages/MetricsApplication/MetricsApplication.test.tsx`** *(new)* — covers the three states: (1) unrestricted user, (2) restricted user with the URL service in their allowed list, (3) restricted user with the URL service NOT in their allowed list.

### Implementation details

#### 1. New shared hook `frontend/src/hooks/useServicesList.ts`

```ts
import { useQuery, UseQueryResult } from 'react-query';
import { ApiV2Instance } from 'api';
import type { ServicesList } from 'types/api/metrics/getService';

export function useServicesList(): UseQueryResult<string[], Error> { ... }
```

Behavior: returns `string[]` of allowed service names. For users with no project restrictions the list will include every service (Phase 1 backend behavior). For restricted users the list will already be filtered to allowed services only.

Reuses the same payload shape as the existing `RolesSettings` hook so we don't introduce a divergent API.

#### 2. Page-level check in `MetricsApplication.tsx`

```tsx
function MetricsApplication(): JSX.Element {
  const { servicename } = useParams<{ servicename: string }>();
  const decodedName = decodeURIComponent(servicename);
  const { data: allowedServices, isLoading } = useServicesList();

  if (isLoading) return <Skeleton ... />;

  const accessDenied =
    Array.isArray(allowedServices) && !allowedServices.includes(decodedName);

  if (accessDenied) {
    return <ForbiddenState serviceName={decodedName} />;
  }

  return <Tabs ... />; // existing
}
```

Loading state shows a skeleton (matching today's first-paint pattern). On error or empty list from the network call, **fail open** — let the page render rather than false-positive a 403. This preserves the prior behavior in case the endpoint is temporarily unavailable.

Why fail-open on network error but fail-closed on empty list?
- **Empty list + restricted user** is unambiguous: the endpoint returned no services, which means the user has no allowed services, so any specific service name is forbidden. (This handles the edge case of a fresh org with one role and no granted services.)
- **Network error** is ambiguous — we don't know if the user has access. Don't false-positive.

#### 3. `ForbiddenState` component

Renders inside the existing `metrics-application-container` so the layout chrome (header, breadcrumbs, etc.) stays consistent. Uses the project's `ErrorInPlace` component with a 403 `APIError`, matching the pattern in `RolesSettings/CreateEditRolePage/CreateEditRolePage.tsx:144-158`. Includes:

- Shield/lock icon (using existing `@signozhq/icons` set)
- "You don't have access to "Arka""
- Body copy: "This service is outside your assigned projects. Contact your admin to request access."
- "Back to services" button → `history.push('/services')`

Test IDs: `service-access-denied-banner`, `service-access-denied-back-button` (per project rule that critical UI gets `data-testid`).

#### 4. CSS module

`MetricsApplication.module.scss` — single container class `.forbidden` with `display: flex`, centered content, max-width, padding per `--spacing-*` tokens (per `frontend/docs/css-modules-guide.md`).

#### 5. Test

`MetricsApplication.test.tsx` — three render scenarios via `@testing-library/react` and `react-query` test wrapper:

- `renders tabs when user has access`
- `renders forbidden state when service is not in allowed list` (asserts the 403 banner and the back button)
- `renders skeleton while loading`

Mock `useServicesList` rather than the network layer — keeps the test focused on the routing/policy decision.

### Verification

End-to-end test plan:
1. With local SigNoz running, log in as a user whose custom role only grants access to `traky-api`.
2. Navigate to `/services/Arka?relativeTime=30m`.
3. Expect to see the new "You don't have access to "Arka"" banner with a back button.
4. Click back — expect to land on `/services` and not see `Arka` in the list (Phase 1 list-filter behavior).
5. Navigate to `/services/traky-api` — expect tabs to render normally.
6. As an admin user, navigate to `/services/Arka` — expect tabs to render (admin = managed role = unrestricted).

Mechanical checks per project rules:
- `pnpm tsgo --noEmit`
- `pnpm lint:js --quiet`
- `pnpm oxlint <changed files>`
- Run `MetricsApplication.test.tsx` (and existing `Metrics.test.tsx` if it still applies).

### Out of scope for Phase 2

- Adding 403 to the remaining v1 endpoints (`getTopOperations`, `getEntryPointOps`, `getServicesTopLevelOps`) — that's a backend cleanup, not blocking the URL.
- Auditing the trace/log/metric endpoints — that's Phase 3.
- The performance issue noted at the end of Phase 1 (duplicate `GetRolesByUserID` calls in the querier) — Phase 4.