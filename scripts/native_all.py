#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import native_fleet as fleet
import native_ingest as ingest


def safe_name(identity: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "-", identity).strip("-")


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare/publish every ready NativePack target.")
    parser.add_argument("--provider")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--out-root", type=Path, default=Path(".native-fleet"))
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--publisher-url", default=fleet.DEFAULT_PUBLISHER_URL)
    parser.add_argument("--report", type=Path, default=Path(".native-fleet/report.json"))
    args = parser.parse_args()

    targets = [target for target in ingest.discover_targets() if target.status == "ready"]
    if args.provider:
        targets = [target for target in targets if target.provider_id == args.provider]
    if args.limit:
        targets = targets[: args.limit]

    report = {
        "revision": fleet.REVISION,
        "selected": len(targets),
        "questions": sum(target.total for target in targets),
        "published": 0,
        "prepared": 0,
        "skipped": 0,
        "failed": 0,
        "items": [],
    }

    for index, target in enumerate(targets, start=1):
        bundle_dir = args.out_root / safe_name(target.identity)
        print(f"[{index}/{len(targets)}] {target.identity}", file=sys.stderr)
        item = {"identity": target.identity, "questions": target.total}
        try:
            pack = ingest._prepare(target)
            bundle = fleet._render_bundle(target, pack, bundle_dir)
            report["prepared"] += 1
            item.update({"status": "prepared", "assets": bundle["assetCount"]})
            if args.publish:
                result = fleet._publish_bundle(bundle_dir, args.publisher_url)
                status = result.get("status") or ("published" if result.get("published") else "unknown")
                item["status"] = status
                item["publication"] = result
                if status == "skipped":
                    report["skipped"] += 1
                elif status == "published":
                    report["published"] += 1
                else:
                    raise fleet.NativeFleetError(f"resultado de publicação inesperado: {result}")
        except Exception as error:
            report["failed"] += 1
            item.update({"status": "failed", "error": str(error)})
            print(f"FAIL {target.identity}: {error}", file=sys.stderr)
        report["items"].append(item)

    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in ["selected", "questions", "prepared", "published", "skipped", "failed"]}))
    return 1 if report["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
