"""Current recorder-format fixtures shared by backend tests."""

import csv
import io

from app.services import REALBO_COLUMNS


def recording_csv(*rows):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=REALBO_COLUMNS)
    writer.writeheader()
    for row in rows:
        writer.writerow({"unit_kind": "building", **row})
    return output.getvalue()


def unit_definitions(units):
    return {
        "game": "BAR", "game_version": "test", "map": "Aurelia v4.1", "replay_file": "test.sdfz",
        "units": {key: {"display_name": "Extractor", "internal_name": "", "is_building": True,
                        "is_factory": False, **value} for key, value in units.items()},
    }
