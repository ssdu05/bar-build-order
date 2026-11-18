"""From backend/: uv run python server.py (API only, no frontend serving)."""

import argparse
import os
from pathlib import Path

import uvicorn

from app.app import create_app
from app.services import DEFAULT_DATABASE_FILE, DEFAULT_PORT

# Also supports: uv run uvicorn server:app --host 127.0.0.1 --port 4173
app = create_app()


def main() -> None:
    parser = argparse.ArgumentParser(description="Local BAR replay and build order API")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", DEFAULT_PORT)))
    parser.add_argument("--database", type=Path,
                        default=Path(os.environ.get("BAR_DATABASE_FILE", DEFAULT_DATABASE_FILE)),
                        help="SQLite database path (default: build_orders.sqlite3)")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    application = create_app(database_file=args.database)
    print(f"BAR Build Order API: http://127.0.0.1:{args.port}/api/status")
    print(f"SQLite database: {application.state.database_file}", flush=True)
    uvicorn.run(application, host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
