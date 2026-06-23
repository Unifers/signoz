# Dashboard V2 — Draft & Edit Mode

How editing works in Dashboard V2 (`frontend/src/pages/DashboardPageV2/`). The model is
deliberately different from V1, and the difference trips people up, so read this before
touching the editor or the persistence path.

## TL;DR

- There is **no global "edit mode"** toggle. A boolean `isEditable` only gates whether edit
  affordances are shown.
- Most edits (layout, sections, title, settings) **save immediately** as RFC-6902 JSON
  patches — there is no local copy of the dashboard to discard.
- The **only** real draft is the **panel editor** (a full-page route). It holds one panel in
  local state until you Save or discard.
- A panel's **kind** (`spec.plugin.kind`) drives everything downstream: renderer, config
  sections, query-builder tabs, and the query request type. Change the kind and the whole
  editor re-derives. This is the seam the panel-type switcher uses.

---

## 1. No global edit mode

`isEditable` is computed once and stored in the dashboard store:

- `DashboardContainer/index.tsx` sets it via `setEditContext`.
- `store/slices/editContextSlice.ts` holds `{ dashboardId, isEditable, refetch }` (transient,
  not persisted).
- `isEditable = !dashboard.locked && editDashboardPermission`.

It does **not** put the dashboard into a separate editing state. The dashboard always renders
in its view state; `isEditable` just decides whether buttons/menus (Add panel, Edit, Rename,
delete handles, drag handles) appear.

## 2. Two persistence models

### a) Immediate-save mutations (no draft, no cancel)

Add / delete / move / resize panel, add / rename / reorder / delete section, inline title
edit, and the settings drawer all build **RFC-6902 JSON-Patch** operations and POST them
straight away, then invalidate the dashboard query so it refetches.

- Patch builders: `DashboardContainer/patchOps.ts` (pure, unit-tested, no React/network).
- Pointers target the postable shape: `/spec/panels/...`, `/spec/layouts/...`,
  `/spec/display/...`.
- There is nothing to "discard" — the change is already on the server.

### b) Local-draft editing — the panel editor

The one place with a genuine draft. A full-page route
`/dashboard/:dashboardId/panel/:panelId` (`PanelEditorPage` → `PanelEditorContainer`) loads a
single panel into local state, lets you edit it freely, and writes back only on Save.

## 3. The panel editor draft

`PanelEditor/hooks/usePanelEditorDraft.ts`:

- Holds `draft: DashboardtypesPanelDTO`, seeded once from the loaded panel.
- Mutated only through `setSpec(nextSpec)`. Everything the config pane edits flows through
  this single `spec` / `setSpec` pair.
- `isSpecDirty` = deep compare of `draft` vs the initial panel, **excluding `spec.queries`**
  (queries are owned by the builder and re-serialized as a preview cache, so their
  representation drifts without a real edit — see §4).

Save (`PanelEditor/hooks/usePanelEditorSave.ts`): one `add` operation replacing
`/spec/panels/{panelId}/spec` with the whole spec, then invalidate + `onSaved()` navigates
back. (A new panel additionally appends a layout item — `isNew` / `layoutIndex`.)

Discard: the `Header` confirms with a dialog when dirty, otherwise closes immediately. There's
no API call — the draft just unmounts.

## 4. Query ownership is split from the draft

Queries do **not** live in the draft. They live in the shared, URL-synced query builder
(`useQueryBuilder` / `QueryBuilderProvider`). `PanelEditor/hooks/usePanelEditorQuerySync.ts`
bridges the two:

- **Seed:** on mount it force-resets the builder to the saved panel's query
  (`useShareBuilderUrl({ forceReset })`), discarding any stale URL query from a prior edit.
- **Commit:** it writes the live builder query into `draft.spec.queries` (what the preview
  fetches) on a query-type / datasource switch and on **Stage & Run**. A V5-envelope-level
  `isEqual` no-op guard prevents equivalent-but-restructured queries from false-dirtying the
  draft.
- **Dirty:** `isQueryDirty` compares the live query against a builder-normalized baseline
  captured once after mount — comparing normalized-to-normalized avoids serialization drift.
- **Save:** `buildSaveSpec` bakes the live query into the spec so unstaged edits persist.

Total dirty state in the editor: `isNew || isSpecDirty || isQueryDirty`.

## 5. Kind drives everything (the extension seam)

In the editor:

```
fullKind   = draft.spec.plugin.kind            // e.g. 'signoz/TablePanel'
panelType  = PANEL_KIND_TO_PANEL_TYPE[fullKind] // V1 PANEL_TYPES, e.g. 'table'
```

`panelType` (and `fullKind`) feed:

| Consumer | How |
| --- | --- |
| Renderer | `getPanelDefinition(fullKind).Renderer` via the `PANELS` registry |
| Config sections | `getPanelDefinition(fullKind).sections` → `ConfigPane` → `SectionSlot` |
| Query-builder tabs | `PANEL_TYPE_TO_QUERY_TYPES[panelType]` (e.g. List → Query Builder only) |
| V5 request type | `buildQueryRangeRequest` → `panelTypeToRequestType` → time_series / scalar / raw |
| Response prep | `flattenTimeSeries` / `prepareScalarTables` / `prepareRawTable` |

**Implication:** mutate `draft.spec.plugin.kind` (via `setSpec`) and the entire editor
re-derives — renderer, sections, tabs, request type. That is exactly what the in-editor panel
**type switcher** relies on; the only extra work it does is transform the query for the new
type and remember per-kind state so switching is reversible.

## 6. ConfigPane section system

`PanelEditor/ConfigPane/ConfigPane.tsx` renders the always-present fields (title, description)
and then the kind's sections:

- Each kind declares its `sections` in `Panels/kinds/<Kind>/sections.ts`.
- `SectionSlot` + `ConfigPane/sectionRegistry.tsx` map a section kind → editor component +
  a read/write lens over a slice of `plugin.spec` (`axes`, `legend`, `chartAppearance`,
  `visualization`, `formatting`, `thresholds`, `histogramBuckets`, …).
- List columns (`selectFields`) are the exception — edited **below the query builder**, not in
  the ConfigPane.
- New panels seed a populated default `plugin.spec` from the kind's sections via
  `Panels/utils/buildDefaultPluginSpec.ts`.

## 7. Data flow (one edit, end to end)

```
user edits title in ConfigPane
  → onChangeSpec({ ...spec, display: { ...display, name } })
  → setSpec → draft updated (isSpecDirty = true)
  → PreviewPane re-renders from draft
  → Save → buildSaveSpec(draft.spec) → JSON-Patch /spec/panels/{id}/spec → invalidate → back
```

A query edit takes the parallel path: builder → `usePanelEditorQuerySync` commits into
`draft.spec.queries` → preview refetches → `buildSaveSpec` bakes it on Save.

## Key files

| File | Role |
| --- | --- |
| `DashboardContainer/index.tsx` | Sets `isEditable` edit context |
| `DashboardContainer/store/slices/editContextSlice.ts` | `{ dashboardId, isEditable, refetch }` |
| `DashboardContainer/patchOps.ts` | RFC-6902 patch builders (immediate-save path) |
| `PanelEditorPage/PanelEditorPage.tsx` | Route wrapper → loads panel → `PanelEditorContainer` |
| `PanelEditor/index.tsx` | Editor shell: preview + query builder + config pane |
| `PanelEditor/hooks/usePanelEditorDraft.ts` | Local draft + `isSpecDirty` |
| `PanelEditor/hooks/usePanelEditorQuerySync.ts` | Builder ↔ draft bridge + `isQueryDirty` |
| `PanelEditor/hooks/usePanelEditorSave.ts` | Save round-trip (JSON-Patch) |
| `PanelEditor/ConfigPane/ConfigPane.tsx` | Title/description + per-kind sections |
| `Panels/registry.ts` | `getPanelDefinition(kind)` → renderer + sections + capabilities |
| `Panels/types/panelKind.ts` | `PanelKind`, `PANEL_KIND_TO_PANEL_TYPE` |
| `Panels/utils/buildDefaultPluginSpec.ts` | Default `plugin.spec` from a kind's sections |
