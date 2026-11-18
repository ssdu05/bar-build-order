
# features

- generates building and mobile-unit build order via watching replay
- viewer
  - listed build order
  - map

# install (windows)

1. place lua plugin inside `LuaUI\Widgets`
2. restart game

# how to use

1. load into replay
2. set 20x and let it finish
3. (windows) under `LuaUI\Config\RealBO` it generates `_all_units_buildings.csv` (all buildings and units), `_summary.json` (capture counts/completeness), `_unit_defs.json` (version-matched names, types and costs), and `_statistics.json` (per-player economy and optional richer BAR stats, sampled every five game seconds). The plugin creates the `RealBO` folder automatically.
4. Import `_all_units_buildings.csv` in the project's **Recorded build order → Import files** dialog. Attach `_summary.json`, `_unit_defs.json` and `_statistics.json` through that same dialog, then select the **Statistics** tab next to **Map & list** below the recording filters. Both views share the selected timestamp. Statistics supports individual players/allied sides and marks unsupported metrics **Not recorded**. Existing CSVs still support counts; economy history requires replaying with the updated widget.
5. Open **Graphs** next to **Statistics** for Chart.js histories: choose a statistic such as metal production, with one graph per player-controlled team. Graphs show the full recorded history, independent of the timestamp slider and recording filters.

# remarks

attempts were made to get the build order directly out of the .sdfz replay file (removing the need to watch the replay), but these only record buildings/units issued and dont consider if they were cancelled. but via a plugin and letting the engine replay the replay it gets the completed events.
