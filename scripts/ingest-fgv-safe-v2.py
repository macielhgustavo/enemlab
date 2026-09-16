#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BASE_SCRIPT = SCRIPT_DIR / "ingest-fgv-safe.py"
spec = importlib.util.spec_from_file_location("fgv_ingest_base_v2", BASE_SCRIPT)
assert spec and spec.loader
fgv = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = fgv
spec.loader.exec_module(fgv)


def alternative_end(runs, start, next_choice, bullet):
    if next_choice is not None:
        return next_choice
    previous_y = bullet.y
    saw_content = False
    for index in range(start, len(runs)):
        run = runs[index]
        if run.page != bullet.page:
            return index
        if run.is_choice:
            return index
        if saw_content:
            # A two-column FGV page returns to a much higher y coordinate when the
            # content stream jumps from the bottom of the left column to the top of
            # the right column. That jump is a structural next-question boundary.
            if run.y > previous_y + 15.0:
                return index
            # Question bullets can be indented roughly 14pt left of body text. Require
            # both proximity to that margin and a real vertical gap, so wrapped option
            # lines remain attached while the next statement becomes a boundary.
            if run.x <= bullet.x + 20.0 and previous_y - run.y >= 18.0:
                return index
        if fgv.compact(run.text):
            saw_content = True
            previous_y = min(previous_y, run.y)
    return len(runs)


fgv._alternative_end = alternative_end
fgv.PARSER_VERSION = "inbox-fgv@0.2.1"


if __name__ == "__main__":
    raise SystemExit(fgv.main())
