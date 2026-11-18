"""Use the application's connection, or BAR_DATABASE_FILE for the Alembic CLI."""

import os
from pathlib import Path

from alembic import context

from app.database import make_engine
from app.models import Base
from app.services import DEFAULT_DATABASE_FILE

config = context.config


def run(connection):
    context.configure(connection=connection, target_metadata=Base.metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    from sqlalchemy import URL

    path = Path(os.environ.get("BAR_DATABASE_FILE", DEFAULT_DATABASE_FILE)).expanduser().resolve()
    context.configure(url=URL.create("sqlite", database=str(path)), target_metadata=Base.metadata,
                      literal_binds=True, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()
elif config.attributes.get("connection") is not None:
    run(config.attributes["connection"])
else:
    engine = make_engine(Path(os.environ.get("BAR_DATABASE_FILE", DEFAULT_DATABASE_FILE)))
    try:
        with engine.begin() as connection:
            run(connection)
    finally:
        engine.dispose()
