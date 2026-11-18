# Real Build Order Recorder — Beyond All Reason replay plugin

This is a **LuaUI widget** for Beyond All Reason (BAR). Watch a replay at **1x, 20x, or any other speed**. It uses engine simulation events rather than decoding replay command packets or watching the screen.

## What it captures

- **Construction/production start:** `UnitCreated` means the physical building or unit/nanoframe exists on the map. A queued order that was never started is not logged.
- **Completion:** `UnitFinished` records the time a building or mobile unit was fully finished.
- **Removed:** `UnitDestroyed` tracks buildings/units removed before or after finishing (destroyed, reclaimed or cancelled; reason is not distinguishable using these events).
- **Position:** map coordinates X/Y/Z at creation and build facing, where available. Unit coordinates are production-start positions, not movement tracking.
- **Identity:** human-readable building/unit name (`UnitDefs[unitDefID].humanName`), internal name, unit ID, original team/player, and first builder, when reported by the engine.
- **Ownership change:** original builder/team remains associated with the record; `owner_at_end` reflects transfers.
- **Factories and mobile units:** both are recorded. `unit_kind` is `building` for buildings/factories and `unit` for mobile units. `builder_id` / `builder_name` identify the producing factory or constructor when available. Starting commanders and script-spawned units can also appear; not every creation event proves factory production.
- **Complete unit-name mapping:** exports the loaded game version's entire `UnitDefs` ID -> name table to JSON, including buildings **and mobile units that never appeared in the replay**. This is separate from the observed build order.
- **Economy/statistics history:** every five game seconds, records per-army engine income, spending, storage and resource totals. Uses optional `WG.teamStats` for richer army-value/composition, reclaim, combat-value, build-power, idle-production and expansion metrics. Unsupported metrics are JSON `null`, not guessed zeroes. Each record includes the actual engine team (normally one player) and allied-side ID; shared co-op armies cannot be split by controller.

`UnitCreated` marks **started construction**, not the earlier time a player clicked a build order. `UnitFinished` marks **completed construction**. The script intentionally does not conflate the two.

## Install

1. Open BAR's install/data folder. On Windows the usual location is `Beyond-All-Reason/data/`. The launcher provides an **Open Install Directory** shortcut. On Linux find the corresponding BAR data directory. The exact location varies by installation.
2. Copy **`LuaUI/Widgets/gui_real_build_order_recorder.lua`** from this ZIP into the same relative path in your BAR data directory. Create the `Widgets` folder if needed.
3. Enable **Allow custom widgets** in BAR's settings if needed. The widget appears as **Real Build Order Recorder** in the in-game widget selector / custom plugins interface. Make sure it is **enabled before starting** the replay; it is default-enabled when custom widgets are permitted.
4. Load a BAR replay **from its beginning (00:00)** in spectator/replay mode. If it is already running before the widget loads, restart the replay to recover the missing early buildings.
5. Set replay speed to **20x** if desired, and let the match finish. The widget is read-only and does not control the simulation.
6. At the game end, results are exported automatically. If you exit early, the widget also tries to export a **partial** result when it unloads.

If you install the widget while BAR is already running, a restart may be required before the game discovers the new `.lua` file.

## Output files

BAR writes outputs to its **data folder**, inside `LuaUI/Config/RealBO/` (within the permitted custom-widget sandbox path). The widget creates the `RealBO` subfolder automatically using `Spring.CreateDir`. If directory creation is unavailable or blocked, create this folder manually. Files are named from the replay filename and begin with `realbo_`:

| File suffix | Contents |
| --- | --- |
| `_all_units_buildings.csv` | **All buildings and mobile units whose construction/production physically began**. Includes completed, cancelled/reclaimed/destroyed and unfinished records, sorted by construction/production start. |
| `_summary.json` | Importable capture metadata: replay/map/game version, export time/frame, completion/completeness flags, and unfiltered counts. |
| `_unit_defs.json` | Detailed mapping including game name/version, replay name, internal names, `is_building`, and `is_factory`. |
| `_statistics.json` | Versioned per-player/team economy and optional richer BAR history, with five-second sampling, capture metadata and explicit missing values. |

**These four files are generated.** `_unit_defs.json` is written immediately when the replay loads and refreshed with `/realbo unitmap`. The CSV, summary and statistics JSON are written at game-over, manual export, or shutdown. Filter **Completed** in the viewer for completed-only data.

Unit definitions additionally include optional `metal_cost`, `energy_cost` and `category`. Cost-based value is metal + energy / 60; the library can estimate completed surviving forces from these definitions, with original-player attribution. The CSV itself remains the compatible 26-column format.

Statistics use `format: "realbo_statistics"` and `schema_version: 1`. A fixed `metrics` list describes each sample's numeric-or-null `values` array; teams carry `team_id`, `ally_team_id`, `player`, and ordered `{frame, values}` samples. `game_speed` converts frames to seconds. Initialization/export add samples too. `started_frame`, `export_frame`, `game_over`, `full_replay_captured` and `truncated` describe the capture. The buffer is bounded to 100,000 team samples and roughly 9 MiB of sample text so the file remains under the library's 10 MiB import limit; later samples stop if full. Rewinding clears the buffer and flags incomplete capture.

The integrated library's **Statistics** panel follows the selected timestamp and never uses a future sample. It displays individual armies or allied-side sums; missing metrics stay **Not recorded**. Resource totals follow engine definitions, which can include reclaim; production excluding reclaim is available only when reclaim is separately recorded. Engine combat history fallback may update only periodically. Existing-building/unit counts use creation, completion and removal events, not these coarser snapshots. Transfers affect rich BAR army-value stats, but CSV type counts and cost-based estimates remain attributed to the original player because no transfer timeline is exported.

The summary has `format: "realbo_summary"`, `schema_version: 1`, replay/map/version metadata, `export_frame`, `export_time`, `game_over`, `full_replay_captured`, `started_frame`, `skipped_frames`, `rewind_detected`, and a `counts` object (`started`, `buildings`, `units`, `completed`, `removed_before_completion`, `unfinished`). `full_replay_captured` describes observed frame continuity, not proof of spectator visibility or reaching game-over. Importers warn separately when `game_over` is false.

New summaries omit the `notes` field. The frontend displays **Replay fully captured: Yes / No / Unknown**: Yes requires both `full_replay_captured` and `game_over`; No means an incomplete or early capture. Without a summary, or when its metadata does not match the recording, the status is Unknown. Observer visibility remains a requirement even when capture flags report Yes. Older summary JSON containing notes still imports normally.

Example CSV columns: `start_time`, `finish_time`, `removed_time`, `status`, `player`, `team_id`, `building`, `unit_name`, `x`, `y`, `z`, `start_frame`, `finish_frame`, `unit_kind`. The `building` column contains the display name for either kind. Exports have 26 columns, including `unit_kind`.

The widget emits every declared column even when builder, finish, or removal values are absent. The library requires the complete 26-column format and rejects truncated rows. Empty display names fall back to internal unit names.

**Status values** (apply to both buildings and units):

- `finished` — building/unit completed and still exists at export.
- `finished_then_removed` — completed first, later removed/destroyed.
- `removed_before_completion` — began construction but did not finish before being removed. The widget does *not* claim to distinguish cancellation from destruction.
- `unfinished_at_end` — construction had begun but was unfinished at GameOver.
- `under_construction` — construction is still underway when you manually export mid-replay.

## In-game commands

Open the in-game chat/console and enter:

- `/realbo summary` — log current count of started/completed buildings and units.
- `/realbo export` — export a CSV and summary JSON snapshot, including during playback.
- `/realbo copy` — copy the **all buildings/units** CSV to the OS clipboard. Paste it into a text editor if saving to a file is blocked.
- `/realbo unitmap` — write/update `_unit_defs.json` immediately.
- `/realbo copyunitmap` — copy the **detailed unit-definition JSON** to the OS clipboard; save it as a `.json` file if direct file writing fails.
- `/realbo overlay` — show/hide the small status text above the game's chat area.

At replay game-over the export occurs automatically; no command is required. Saved files are ordinary CSV and can be opened in spreadsheet apps.

## Viewing and importing recordings

The **`view_recorded_build_order.html`** viewer and the project's **Recorded build order** tab display the in-game widget's *observed building/unit events*. Select `_all_units_buildings.csv`; no separate mapping is needed, because this CSV already contains names and types. Optionally attach `_unit_defs.json` for version-matched names and `_summary.json` for counts and capture-completeness warnings. The library saves these imports with the replay; the standalone viewer keeps them only while the page is open. A summary is metadata, not a replacement for the event CSV.

Use **Show → Buildings & units / Buildings only / Units only** to filter the list, map, counts, and filtered CSV. The standalone viewer runs locally; no server or network access is needed. The integrated tab supports dropping either type of JSON after the CSV. Replacing the CSV clears its old summary; the library also clears its old unit mapping. Summary imports warn when replay/map/version or row counts disagree.

The library accepts the recorder's complete `_all_units_buildings.csv` format and detailed `_unit_defs.json` schema. Building/unit classification comes directly from the CSV's required `unit_kind` field.

### Important: match the game version

Numeric UnitDef IDs may differ between game builds and ruleset configurations. The JSON must be exported from **the same game version that generated the replay**. When watching an old replay, BAR may load an older game version; the detailed `_unit_defs.json` records `game_version` so you can check. A mapping generated from today's separate live match isn't automatically correct for an old replay.

## Important limitations

- **Watch from the start, as a replay spectator**, with the widget enabled before game frame 1. LuaUI observes only what is visible to its spectator context. Do not seek or skip chunks: loading late or skipping simulation frames can make the capture incomplete, and the summary file reports detected problems. Setting 20x *playback speed is fine*; the timestamps use the fixed game simulation clock (`Game.gameSpeed`, usually 30 FPS).
- `UnitCreated` and `UnitFinished` accurately reflect engine events *visible to the widget*, but `UnitCreated` does **not** prove the construction was manually requested: game rules or scripts can spawn units, including structures.
- For buildings/units unfinished at the end, the first creation time is known, but there is no finish time.
- This is a **read-only** replay recorder, not a simulator or replay command extractor. It cannot recover past events if enabled halfway through a replay. The unit-name JSON is still complete when the replay is opened late, because it enumerates loaded definitions rather than past events.
- The widget is implemented against BAR/Recoil's published Lua API and was validated in a **mocked Lua replay-event test**, including automatic CSV and JSON export. It has **not been tested inside a running BAR client** here, so installation/UI details or behavior may vary with game versions.
- If the widget encounters an error, check BAR's `infolog.txt`. Ensure the widget appears in the in-game selector and custom widgets are allowed.
- Older game versions may lack the richer BAR statistics API; engine economy values still work where exposed, while unsupported metrics remain missing. Economy history cannot be reconstructed from old CSVs—watch the replay again with this version installed.

## API references

- BAR user-widget guide: https://github.com/beyond-all-reason/Beyond-All-Reason/wiki/Writing-user-widgets
- Recoil Lua API: https://recoilengine.org/docs/lua-api/
- BAR custom widget sandbox (October 2026): https://www.beyondallreason.info/microblogs/205

This plugin doesn't use network APIs, run shell commands, modify the game simulation, or write outside `LuaUI/Config/`.
