# Local assets

Click **Refresh assets** in the website to download map textures and recorded
building artwork for all replays currently in your library. Map downloads are
stored in `maps/`, created on demand.
Each map's API filename is hashed with SHA-256 to produce a safe local JPEG
filename. Replays using the same map share one image.

Building artwork is stored in `units/`, keyed by a SHA-256 hash of the internal
unit name (not the numeric UnitDef ID). Icons come from official BAR unit pages
and their image CDN, are shared by all replays, and represent current artwork,
not version-matched historical models. PNG/JPEG/WebP bytes are stored as `.img`;
the server detects their type when serving them. Unknown units use a bundled
generic placeholder. Artwork belongs to its respective BAR contributors.

Spawn markers and building placements reuse the same map texture and coordinate
system; overlays are rendered in the browser, not baked into separate images.

The generated `maps/` and `units/` folders are ignored by Git. Images work offline once cached;
you can remove this cache and download it again without changing your library.
Failed refreshes keep the previous image. JSON exports contain replay data and
notes, not these replaceable assets.

The app checks local cache files to highlight **Refresh assets** when downloads
are missing. Failed downloads are remembered in the Git-ignored
`refresh-failures.json`, so unavailable artwork is distinct from assets not yet
downloaded, even after restarting. A successful refresh clears the corresponding
failures. This history is replaceable and stored separately from the SQLite library.
Status checks do not download images or read image bytes; only clicking a refresh
button starts downloads.
