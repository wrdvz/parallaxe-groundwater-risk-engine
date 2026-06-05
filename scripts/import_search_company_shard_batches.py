from __future__ import annotations

import argparse
import json
import time
import subprocess
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BATCH_ROOT = PROJECT_ROOT / "outputs" / "runtime" / "search-company-shard-batches"
DEFAULT_PROGRESS_DIR = PROJECT_ROOT / "outputs" / "runtime" / "search-company-shard-import-progress"
DEFAULT_WORKER_DIR = PROJECT_ROOT / "cloudflare" / "worker"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import search shard SQL batches into Cloudflare D1 with resumable progress tracking."
    )
    parser.add_argument("--batch-root", type=Path, required=True, help="Directory containing manifest.json and shard folders.")
    parser.add_argument(
        "--db-prefix",
        default="parallaxe-groundwater-risk-engine-search-sample",
        help="D1 database name prefix; final names are <prefix>-<bucket>.",
    )
    parser.add_argument(
        "--progress-dir",
        type=Path,
        default=DEFAULT_PROGRESS_DIR,
        help="Directory where resumable import state is stored.",
    )
    parser.add_argument(
        "--worker-dir",
        type=Path,
        default=DEFAULT_WORKER_DIR,
        help="Directory where wrangler.jsonc lives.",
    )
    parser.add_argument("--start-shard", type=int, default=0)
    parser.add_argument("--end-shard", type=int, default=None)
    parser.add_argument("--reset-progress", action="store_true")
    parser.add_argument("--max-retries", type=int, default=5)
    parser.add_argument("--retry-delay-seconds", type=float, default=5.0)
    return parser.parse_args()


def is_retryable_failure(stderr: str) -> bool:
    retryable_markers = [
        "fetch failed",
        "Not currently importing anything.",
        "A fetch request failed, likely due to a connectivity issue.",
    ]
    return any(marker in stderr for marker in retryable_markers)


def run_wrangler(worker_dir: Path, args: list[str], max_retries: int, retry_delay_seconds: float) -> None:
    attempt = 0
    while True:
        attempt += 1
        completed = subprocess.run(
            ["npx", "wrangler", *args],
            cwd=worker_dir,
            text=True,
            capture_output=True,
        )
        if completed.stdout:
            print(completed.stdout, end="")
        if completed.stderr:
            print(completed.stderr, end="")

        if completed.returncode == 0:
            return

        if attempt > max_retries or not is_retryable_failure((completed.stdout or "") + "\n" + (completed.stderr or "")):
            raise subprocess.CalledProcessError(
                completed.returncode,
                completed.args,
                output=completed.stdout,
                stderr=completed.stderr,
            )

        time.sleep(retry_delay_seconds * attempt)


def load_progress(progress_path: Path, reset: bool) -> dict[str, object]:
    if reset or not progress_path.exists():
        return {"shards": {}}
    return json.loads(progress_path.read_text(encoding="utf-8"))


def save_progress(progress_path: Path, payload: dict[str, object]) -> None:
    progress_path.parent.mkdir(parents=True, exist_ok=True)
    progress_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def import_batches(
    batch_root: Path,
    db_prefix: str,
    progress_dir: Path,
    worker_dir: Path,
    start_shard: int,
    end_shard: int | None,
    reset_progress: bool,
    max_retries: int,
    retry_delay_seconds: float,
) -> None:
    manifest_path = batch_root / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"Missing manifest: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    progress_path = progress_dir / f"{batch_root.name}.json"
    progress = load_progress(progress_path, reset_progress)
    shard_progress = progress.setdefault("shards", {})

    shards = manifest["shards"]
    last_shard = end_shard if end_shard is not None else len(shards) - 1

    for shard in shards:
        bucket = int(shard["bucket"])
        if bucket < start_shard or bucket > last_shard:
            continue

        shard_key = str(bucket)
        shard_state = shard_progress.setdefault(shard_key, {"schema_applied": False, "last_completed_part": 0})
        db_name = f"{db_prefix}-{bucket}"

        if not shard_state["schema_applied"]:
            run_wrangler(
                worker_dir,
                [
                    "d1",
                    "execute",
                    db_name,
                    "--remote",
                    f"--file={shard['schema_path']}",
                ],
                max_retries=max_retries,
                retry_delay_seconds=retry_delay_seconds,
            )
            shard_state["schema_applied"] = True
            save_progress(progress_path, progress)

        last_completed_part = int(shard_state["last_completed_part"])
        for part_number, part_path in enumerate(shard["part_paths"], start=1):
            if part_number <= last_completed_part:
                continue
            run_wrangler(
                worker_dir,
                [
                    "d1",
                    "execute",
                    db_name,
                    "--remote",
                    f"--file={part_path}",
                ],
                max_retries=max_retries,
                retry_delay_seconds=retry_delay_seconds,
            )
            shard_state["last_completed_part"] = part_number
            save_progress(progress_path, progress)

    print(json.dumps(progress, indent=2))


def main() -> None:
    args = parse_args()
    import_batches(
        batch_root=args.batch_root,
        db_prefix=args.db_prefix,
        progress_dir=args.progress_dir,
        worker_dir=args.worker_dir,
        start_shard=args.start_shard,
        end_shard=args.end_shard,
        reset_progress=args.reset_progress,
        max_retries=args.max_retries,
        retry_delay_seconds=args.retry_delay_seconds,
    )


if __name__ == "__main__":
    main()
