"""Create the replay library."""

from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "replays",
        sa.Column("replay_id", sa.String(32), primary_key=True),
        sa.Column("bar_api", sa.JSON(), nullable=False),
        sa.Column("remarks", sa.Text(), nullable=False),
        sa.Column("build_order", sa.Text(), nullable=False),
        sa.Column("recorded_build_order", sa.JSON(none_as_null=True), nullable=True),
    )


def downgrade():
    op.drop_table("replays")
