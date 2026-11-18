# Documentation

See the [main README](../README.md) for setup and development instructions. All commands and repository paths below are relative to the repository root.

## Data format and storage

The website stores all entries in **`build_orders.sqlite3`** at the repository root by default, regardless of the working directory. Cached images remain in root-level `assets/`. The layout refactor does not move or recreate an existing library/cache. Replay IDs are unique database keys; notes, the full BAR snapshot, and optional recordings are stored separately. **Export JSON** produces a `build_orders.json` download:

```json
{
  "https://bar-rts.com/replays/56acec6a4612a888703f0b94af10d0c8": {
    "bar_api": {
      "id": "56acec6a4612a888703f0b94af10d0c8"
    },
    "remarks": "Review the opening scout timing",
    "build_order": "2 mex -> solar -> bot lab"
  }
}
```

In an actual entry, `bar_api` contains the **entire response** from `https://api.bar-rts.com/replays/<replay-id>` — not merely the ID shown above. That snapshot is fetched **once at creation** and is **read-only through the app**. The notes editor changes only `remarks` and `build_order`; CSV/JSON imports are stored separately under the optional `recorded_build_order` field. The replay URL serves as the unique entry key.

Database writes are transactional. The API uses explicit schemas and rejects unknown entry fields. Complete BAR snapshots and original recording CSV text are preserved.

To choose a database location:

```bash
uv run --project backend python backend/server.py --database "/path/to/library.sqlite3"
```

For Windows, quote paths such as `"C:\Users\You\Documents\library.sqlite3"`.

You can also change the local port:

```bash
uv run --project backend python backend/server.py --port 5000
```

The `BAR_DATABASE_FILE` and `PORT` environment variables are also supported.

Use **Export JSON** for a data snapshot. To back up or restore the library, stop the server and copy or replace the SQLite database. Cached images are separate from the database and JSON exports.

### Database migrations

Startup automatically applies committed Alembic revisions. You can also run them explicitly (using `BAR_DATABASE_FILE` to target a custom database):

```bash
uv run --project backend alembic -c backend/alembic.ini upgrade head
uv run --project backend alembic -c backend/alembic.ini current
uv run --project backend alembic -c backend/alembic.ini check
```

For development, update `backend/app/models.py`, run `uv run --project backend alembic -c backend/alembic.ini revision --autogenerate -m "describe change"`, review the generated revision, and test it before upgrading. Downgrades can delete data; back up first.

## Website features

- Add a replay URL; the local Python backend fetches its full BAR API response.
- Filter by **ranked status**, **player**, **map**, **match type**, **date range**, or free-text search (player, spectator, faction, remarks, build order, replay URL). **Ranked status** defaults to **Ranked** on page load; choose **Unranked** or **All** to expand the library. Classification uses the saved API's `gameSettings.ranked_game`; unknown/missing metadata appears only under All. **Clear all** removes this filter too, showing All.
- Player, faction, map, game type, and recorded-build-order dropdowns are **searchable**: type part of a name, then click a match or use arrow keys and Enter. Escape cancels the query; choose **All** to clear the filter. Typing alone does not change the selection.
- Sort by **game start date/time** (newest or oldest), **duration**, or **map name**.
- Show teams, factions, each player's **OpenSkill**, winning side, spectators, game length, and the full **read-only API JSON**. OpenSkill comes from the saved replay's `skill` value, not a current rating lookup; missing ratings show `—`. Hover a rating for recorded uncertainty when available.
- Click a player name in replay cards, team details, the spawn legend, or recorded build orders for **View on BAR** (opens BAR's replay search prefiltered to that name in a new tab) or **Filter library** (sets this library's Player filter, keeping other filters and unsaved notes).
- Show a map with numbered, player-coloured spawn markers, a player legend, and team starting areas. Missing or invalid coordinates are not plotted.
- Zoom either map up to **16×** with the mouse wheel, pinch, double-click, or + / − buttons. Drag to pan; keyboard + / −, arrow keys, and Home also work. Reset restores the full map. Filtering, changing tabs, and refreshing assets preserve the viewport; selecting another replay resets it.
- Click **Refresh assets** to download or replace images for all unique maps and recorded building types in your library. Maps are saved in `assets/maps/`; building icons in `assets/units/`. Both views share these caches and download each asset only once per refresh. Use it again after importing a recording or adding a replay on a new map. Failures are listed in the UI and leave previous cached images intact; replay snapshots and unsaved notes are never changed.
- Missing local assets highlight **Refresh assets**, with missing/unavailable counts beside the affected views. Counts are for unique maps/building types, not individual structures. Failed replacements keep using cached images. Failure history survives page/server restarts in `assets/refresh-failures.json`, separate from your library. Checks run locally after loading/reloading entries, imports, replay changes to the library, and asset refresh—not continuously, and never download anything. Missing internal unit names/map metadata cannot be fixed by downloading and are not counted as downloadable assets.
- Edit remarks and build orders; press **Ctrl+Enter** (or **Cmd+Enter**) to save.
- Attach the plugin's recorded build order to a replay: CSV import/drop, optional UnitDef-name JSON, player/status/name/time filters, building placements on the cached map, paginated table, and filtered CSV download.
- Delete entries, export JSON backups, copy the local database path, and reload entries from SQLite.

Dates are displayed in the browser's local timezone; original timestamps are kept in the immutable API snapshot.

## Recorded build orders

Each replay's **Recorded build order** tab displays events exported by the bundled Lua widget.

1. Install `bar_plugins/LuaUI/Widgets/gui_real_build_order_recorder.lua` into BAR's `LuaUI/Widgets/` folder and enable custom widgets. See `bar_plugins/readme-detail.md` for the full setup.
2. Watch the replay from its beginning with the widget enabled; accelerated playback is fine. Let it finish for a complete recording.
3. Select the same replay in this library, open **Recorded build order → Import files**, and import its `_all_units_buildings.csv` (all buildings and mobile units) from BAR's `LuaUI/Config/RealBO/` directory. The widget creates this subfolder automatically. Drag-and-drop onto the recording panel works too.
4. Optionally import `_summary.json` using the same **Import files** dialog. It stores unfiltered counts, replay/map/version metadata, export time, and capture-completeness flags. The viewer warns about partial exports, late starts, skipped frames, rewinds, and mismatched CSV/summary snapshots. The summary is metadata, not a replacement for the CSV. JSON imports are automatically identified as summaries or unit mappings.
5. Optionally import `_unit_defs.json` from that same replay/game version. The CSV already contains names; the JSON resolves names by **UnitDef ID**, not the individual Unit ID.
6. Import `_statistics.json` from the updated widget for per-player economy, force-value, combat and production history. Switch from **Map & list** to the **Statistics** tab below the recording filters. Each view has a time control sharing the same timestamp. Older recordings still support existing-building/unit counts without this file.

The widget creates **four files**: `_all_units_buildings.csv`, `_summary.json`, `_unit_defs.json`, and `_statistics.json`. To view or download completed-only data, use the frontend's **Construction status → Completed** filter.

The **Show** filter offers **Buildings & units** (default), **Buildings only**, and **Units only**. It applies to the list, map, statistics, and filtered CSV download, and combines with player/status/name/time filters. The choice is kept when switching replays or refreshing during the current page session. Recordings must use the widget's complete 26-column schema, including `unit_kind` (`building` or `unit`); factories count as buildings. Every row must contain all declared columns. Unit definitions must use the detailed `_unit_defs.json` schema.

Unit timestamps come from actual creation and completion events, not factory queue commands. Starting commanders and script-spawned units can also appear; these events do not prove factory production. Unit coordinates show **production-start positions**, not subsequent movement.

Imports are validated with Zod/Papa Parse in the browser and Pydantic on the server, then save automatically to **your local server's SQLite database**, including the original CSV text, optional mapping, and optional summary. They survive reloads and are included in **Export JSON**. Nothing is sent to BAR or any other external service during import. File inputs do not grant the server access to your BAR folders. Replacing a CSV clears its previous unit mapping and summary, so another game's IDs or capture metadata are not silently reused. Summaries and mappings can be removed independently without removing the CSV, manual notes, or API snapshot. Invalid imports leave the existing recording intact. Filtered CSV downloads escape spreadsheet formula-like cells; the archived CSV is never changed.

The viewer warns before attaching files with different replay filenames, maps, or game versions. Version comparisons ignore the replay API's optional `Beyond All Reason` title prefix: `Beyond All Reason test-31958-7ffdbab` matches the widget's `test-31958-7ffdbab`, but different builds/hashes still warn. If the CSV lacks this metadata, matching the replay is your responsibility. The time slider filters **construction/production starts**. “Completed” means completed by export time, including buildings and units removed later; the map is not a simulation of what was still alive at the selected time. Partial widget exports may be incomplete.

### Timestamp statistics

**Statistics** is separate from the cumulative build list/map. It counts records started by the selected time, excludes records at and after their removal time (destroyed, reclaimed or cancelled), and separates completed from under-construction units/buildings. Unknown completion times are reported rather than guessed from final status. Counts follow player, name and building/unit filters, but deliberately ignore the export-time construction-status filter and map selection. CSV counts and cost-based value estimates use **original build ownership**, not ownership at the selected time: CSVs do not contain transfer timestamps.

The updated widget samples economy and optional BAR `WG.teamStats` values every **five game seconds**, plus initialization and export. The panel compares individual player-controlled armies, or sums them by allied side; co-op controllers sharing one army cannot be separated. Economy/value metrics cover the whole selected army regardless of unit/name filters. Missing metrics or missing/stale snapshots display **Not recorded**, not zero. The latest sample **at or before** the selected time is used; histories never borrow future values or interpolate across missing capture intervals. The slider extends through export/removal time, not just the last construction start.

Available metrics include income/spending, storage, produced/spent/reclaimed/excess/sent/received totals, ground/air/naval and infrastructure values, combat damage/kills/losses, value destroyed/lost, build-power utilisation, idle constructors/factories, converter use and metal/geothermal spots. First-factory completion is included. Metrics depend on the replay's actual BAR/engine version and observer visibility. Raw engine income/production includes reclaim; separately derived production excluding reclaim is shown only when the reclaim metric is available. Some engine combat counters update periodically rather than every frame.

The separate **Graphs** tab next to **Statistics** uses **Chart.js**, loaded only when opened. It shows one chart per player-controlled team (not an allied-side aggregate), with a searchable statistic selector for production rates, resource totals, army value, combat, production utilisation and the other recorded metrics. All charts show the **full imported history**, independently of the selected timestamp and recording/player/unit filters, with matching time/value scales for comparison. Missing values and skipped sample intervals remain gaps; unsupported team metrics say **Not recorded**. Partial/truncated captures are warned about rather than extended with invented data.

Force value uses **metal cost + energy cost ÷ 60**, following current BAR's valuation, not combat strength or remaining health. Mobile army value sums ground, air and naval categories; constructors, defences and strategic weapons have separate categories. Version-matched unit definitions now optionally include costs/categories, allowing clearly labelled estimates for completed surviving CSV records when richer sampled values are unavailable.

Install the updated `bar_plugins/LuaUI/Widgets/gui_real_build_order_recorder.lua` and **watch the replay again from the beginning** to collect economy history. Import its new CSV, statistics, summary and definitions from the same export. Statistics JSON is limited to **10 MiB / 100,000 team samples**, validates strictly in browser and server, saves in the existing recording archive without a database migration, and survives reload/JSON export. The widget stops adding samples before its size limit and marks the file truncated; the viewer warns and does not extrapolate later values. Rewinds reset the sample buffer and flag the capture. Statistics can be removed independently; replacing the CSV clears them along with its old summary/mapping.

Map markers use the selected replay's map dimensions and cached image; click **Refresh assets** to download missing map images and building/unit icons. Without map dimensions, the viewer falls back to a relative X/Z coordinate plot. Rows with missing or out-of-map coordinates remain in the table but are not plotted. Imports are limited to **10 MiB / 50,000 CSV records**, **5 MiB of unit JSON**, and **1 MiB of summary JSON**; tables paginate in groups of 200, while maps and exports use all filtered rows.

The build list renders only rows near its scroll viewport, including when large groups are expanded. While dragging the time slider, the map and counts preview immediately, but the list updates only on release; keyboard/accessibility changes also settle after a short pause. CSV export is disabled until the list matches the preview, so it cannot silently export an older cutoff. Filtering, grouping, and sorting use the standard TanStack Table models.

**Cluster nearby icons** is off by default. Enable it to improve performance in dense recordings: the map uses Supercluster to replace dense groups with count badges, and zooming reveals separated placements. Cluster counts and positions reflect only records through the preview time. Records at the exact same position remain clustered; filter or select individual records in the list to inspect them. With clustering off, all individual icons are drawn, which can be slower for dense recordings. The overlay uses native Canvas2D and does not require WebGL or GPU acceleration. All matching records remain in statistics, selection, the list, and CSV exports.

**Summarise consecutive buildings / units** is enabled by default in the list: a player's consecutive builds of one type appear as e.g. **3 × Metal Extractor** or **5 × Pawn**, with start/finish timing ranges and status counts. Click the group to expand its individual rows, or uncheck the option to show every record separately. Other players' interleaved builds do not interrupt a run; a different building or unit by the same player does, even when hidden by filters. Counts and ranges reflect only filtered records; unknown finish times are marked, not inferred. Pagination counts summary items (200 per page), while statistics, map placements, the archived CSV, and filtered CSV exports remain individual records. The toggle is kept when switching replays or refreshing assets during the current page session.

Switch from **Timeline** (the existing default) to **By constructor** to see each initial constructor/factory's own build sequence, identified by its name and individual unit ID. With summarisation enabled, consecutive builds of one type are collapsed per constructor: another constructor's converter does not interrupt a bot's wind turbines. A different type built by that same constructor still breaks the run, even if filters hide it. Expand a group for individual timings and statuses, or turn summarisation off for individual rows under each constructor. Sorting operates within each constructor; constructors stay in order of their first observed build. Each heading shows that constructor's filtered build count and start-time range.

This view works with existing CSVs: it uses `builder_id` / `builder_name`, not new plugin data. **These are actual construction/production starts, not queued orders**, and only the initial builder is known, not assisting constructors. Missing builder IDs appear under **Unknown constructor / factory** for that player and are never summarised together based only on a name. Observed unit-ID reuse starts a separate constructor sequence. Both views share all filters, map placements, statistics, and individual-record CSV exports. Pages still count 200 build groups/records, not whole constructors; headings repeat when a constructor continues on another page. The view choice is kept across replay changes and asset refreshes during the current page session.

**Focus the map from the list:** check individual rows or an entire collapsed building/unit group in either view. In **By constructor**, the checkbox beside a constructor selects all its filtered builds, including those on other pages. The table-header checkbox selects all filtered records across pages. Group/constructor checkboxes show a partial-selection state when only some children are selected. With a selection, only selected records matching the current filters appear on the map; the list, statistics, and CSV export are unchanged. Hidden selections are retained and reported above the map, so filtering out all selected records leaves the map empty rather than showing unrelated builds. **Clear map selection** (or deselect everything) restores all filtered placements. Selection survives sorting, pagination, grouping/view changes, and asset refreshes, but resets for a different replay or CSV. Missing/invalid coordinates are still not plotted; optional spawn/starting-box overlays remain independent.

Buildings have icons in both the list and map, with player-coloured map borders. The placement map can also show player spawns and starting boxes using the same overlay code as the overview map; uncheck **Show player spawns & starting boxes** to hide them. Icons stay a readable size while zooming so nearby buildings separate rather than growing to cover each other.

**Icon sources:** Refresh assets retrieves current artwork from the official [BAR unit pages](https://www.beyondallreason.info/units) and their image CDN. Cache keys use CSV `unit_name` (or the detailed unit mapping's `internal_name`), never the version-dependent numeric UnitDef ID. Artwork is shared across replays and is cosmetic, **not a historical/version-matched model**. Unknown, renamed, custom, or unavailable units show a generic building placeholder; structure names, timings, and coordinates are still retained. Artwork remains owned/licensed by its respective BAR contributors; no artwork is bundled with this project.

## Architecture and API

- `backend/server.py`: Uvicorn CLI entry point; also exports `app` for `uv run --project backend uvicorn server:app --app-dir backend --host 127.0.0.1 --port 4173`.
- `backend/app/app.py`: API-only FastAPI routes, local Host/Origin checks, security headers, bounded request bodies, and JSON error handling.
- `backend/app/schemas.py`: Pydantic request, response, and storage schemas.
- `backend/app/models.py`, `backend/app/database.py`, `backend/app/library.py`: SQLAlchemy models, SQLite setup, Alembic upgrades, and transactional CRUD operations.
- `backend/app/services.py`: recording validation, bounded HTTPX downloads, and local asset caching.
- `backend/alembic.ini`, `backend/migrations/`: versioned database schema migrations.
- `frontend/src/App.tsx`: React replay library, filters, and selection.
- `frontend/src/hooks/use-library.ts`, `frontend/src/lib/api.ts`: TanStack Query cache, mutations, and validated API requests.
- `frontend/src/lib/schemas.ts`, `frontend/src/lib/recording.ts`: Zod external-data schemas, Papa Parse CSV import/export, and replay metadata checks.
- `frontend/src/components/RecordedBuildOrder.tsx`: recording imports and TanStack Table sorting, filtering, grouping, expansion, and pagination.
- `frontend/src/components/ReplayMap.tsx`: shared React zoom/pan map with spawns, starting boxes, and recorded placements.
- `frontend/src/components/CanvasPlacements.tsx`, `frontend/src/lib/canvas-placement-scene.ts`, `frontend/src/lib/placement-clusters.ts`: frame-batched Canvas2D overlay and Supercluster spatial index.
- `frontend/src/components/RecordingTimeControl.tsx`, `frontend/src/lib/recording-timeline.ts`: immediate time preview, with table updates committed separately on release.
- `frontend/src/components/ui/`, `frontend/components.json`, `frontend/src/index.css`: shadcn/ui components and Tailwind styling.
- `frontend/public/`: the favicon and unit placeholder only; copied by Vite into `frontend/dist/`.
- `frontend/package.json`, `frontend/pnpm-lock.yaml`, `frontend/pnpm-workspace.yaml`, `frontend/vite.config.ts`, `frontend/tsconfig.json`: frontend dependencies, reproducible installs, dependency-build permissions, build, and test configuration.
- `bar_plugins/`: replay recorder widget, documentation, and Lua smoke test.
- `build_orders.sqlite3`: generated local library database, excluded from Git.
- `assets/maps/`: generated map image cache, with SHA-256 filenames derived from `Map.fileName`; excluded from Git and JSON exports. Back up this folder too if you want the images available offline after moving the app.
- `assets/units/`: generated building artwork cache, with SHA-256 filenames derived from internal unit names; also excluded from Git and JSON exports.
- `backend/pyproject.toml` and `backend/uv.lock`: Python project metadata and uv lockfile.
- `backend/tests/`: pytest-collected API-only, HTTPX, validation, concurrency, persistence, and migration tests.
- `frontend/src/**/*.test.ts(x)`: Vitest parser/schema tests and React Testing Library UI integration tests.
- `flake.nix`, `.envrc`: shared development environment at the repository root.

The frontend uses these local endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /api/status` | SQLite path (`database_path`), `storage: "sqlite"`, and entry count |
| `GET /api/entries` | All entries |
| `GET /api/export` | Download `build_orders.json` |
| `POST /api/entries` | Add a replay and fetch BAR API snapshot |
| `PUT /api/entries/<id>` | Edit only remarks and build order |
| `DELETE /api/entries/<id>` | Remove an entry |
| `PUT /api/entries/<id>/recording` | Save `{csv, filename, unit_map?, unit_map_filename?, summary?, summary_filename?}` separately from notes; returns `{replay_url, recording}` |
| `DELETE /api/entries/<id>/recording` | Remove only the imported recording and mapping |
| `POST /api/assets/refresh` | With `{}` body, refresh maps and recorded building icons for the whole library; return `refreshed` / `failed` maps and optional `units_refreshed` / `units_failed` |
| `GET /api/entries/<id>/map-image` | Read a replay's cached map JPEG (also supports `HEAD`); never downloads on a read |
| `GET /api/assets/units/<internal-name>` | Read shared cached unit artwork (PNG/JPEG/WebP, also supports `HEAD`); never downloads on a read |
| `GET /api/assets/status` | Check unique local cache files and return per-replay references; states are `cached`, `missing`, or `failed`, with last download errors where available. Never downloads or reads image bytes. |

## Tests

```bash
pnpm --dir frontend test
pnpm --dir frontend build
uv run --project backend pytest backend/tests -q
```

The tests use temporary SQLite databases, real Alembic upgrades/downgrades, and mocked BAR HTTP responses. No internet access is required after dependencies are installed. The existing unittest-style regression cases are also collected by pytest.

Frontend tests use jsdom and mocked local API responses; they cover parsing, validation, import safety, table grouping/filtering, unsaved drafts, mutations, and loading/error states. Run `pnpm --dir frontend test:watch` during development. Backend tests use temporary databases and do not require a frontend build or Node.js dependencies; regression tests verify that frontend files are never served. No test changes your own replay library.

For a real-browser 8,000-record slider stress test, run the frontend development server and open `/benchmarks/recording-slider.html`. In the browser console, run `await window.runRecordingScrubBenchmark()`. It reports input/frame timings and verifies that the list stays committed during dragging, then catches up on release. The page uses synthetic data and never reads or changes your replay library. To measure a production benchmark instead, build with `pnpm --dir frontend exec vite build --config benchmarks/vite.config.ts --outDir /tmp/opencode/recording-benchmark` and preview that output with Vite. Frame timings depend on browser, viewport, display refresh rate, and graphics configuration.

To check the widget exporter with mocked game APIs and in-memory file writes, run `lua bar_plugins/tests/recorder_export_smoke.lua` from the repository root.

## Security and privacy

The API server binds only to **127.0.0.1**, checks the local Host and request Origin, and validates replay URLs before constructing upstream requests. It never serves frontend files, exposes an arbitrary filesystem browser, or serves your database file. BAR receives a replay ID only when you add that entry, and map filenames / internal unit names when you refresh assets. Map downloads use a fixed official API host; icon downloads use official BAR unit pages and an allowlisted image CDN. HTTPX downloads reject redirects, ignore proxy environment settings, and enforce timeouts, decoded-byte limits, and image-format checks. The browser only loads local assets; no external image permission is needed. API responses carry a restrictive CSP; a future frontend web server must set its own security headers (React/Radix currently need inline styles). Vite binds to loopback and rewrites only its own dev/preview Origin for API requests; foreign origins remain blocked by the backend.

This is intended for local personal use, **not for hosting on the public internet** without authentication and appropriate hardening. Direct database edits can change `bar_api`; "immutable" refers to changes through the website/API.

## AI usage disclosure

This project was developed with assistance from AI-powered coding tools.
