from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_DB = PROJECT_ROOT / "outputs" / "runtime" / "groundwater-risk-engine-sample.db"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "outputs" / "runtime" / "search-company-shards"
DEFAULT_SHARD_COUNT = 8


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Split companies_france into deterministic SIREN-based search shards."
    )
    parser.add_argument("--source-db", type=Path, default=DEFAULT_SOURCE_DB)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--prefix", default="sample-1m")
    parser.add_argument("--shard-count", type=int, default=DEFAULT_SHARD_COUNT)
    return parser.parse_args()


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS companies_france (
          siren TEXT PRIMARY KEY,
          company_name TEXT NOT NULL,
          normalized_name TEXT NOT NULL,
          search_name TEXT NOT NULL,
          naf_code TEXT,
          legal_category TEXT,
          is_active INTEGER NOT NULL DEFAULT 1
        );

        CREATE INDEX IF NOT EXISTS idx_companies_france_normalized_name ON companies_france(normalized_name);
        CREATE INDEX IF NOT EXISTS idx_companies_france_search_name ON companies_france(search_name);
        """
    )


def bucket_for_siren(siren: str, shard_count: int) -> int:
    digits = "".join(ch for ch in str(siren or "") if ch.isdigit())
    if not digits:
        return 0
    return int(digits[-2:]) % shard_count


def write_d1_friendly_dump(conn: sqlite3.Connection, sql_path: Path) -> None:
    with sql_path.open("w", encoding="utf-8") as fh:
        for line in conn.iterdump():
            stripped = line.strip()
            if stripped in {"BEGIN TRANSACTION;", "COMMIT;"}:
                continue
            fh.write(f"{line}\n")


def build_shards(source_db: Path, output_dir: Path, prefix: str, shard_count: int) -> None:
    if not source_db.exists():
        raise FileNotFoundError(f"Missing source DB: {source_db}")

    shard_root = output_dir / prefix
    shard_root.mkdir(parents=True, exist_ok=True)

    source_conn = sqlite3.connect(source_db)
    source_conn.row_factory = sqlite3.Row
    rows = source_conn.execute(
        """
        SELECT siren, company_name, normalized_name, search_name, naf_code, legal_category, is_active
        FROM companies_france
        ORDER BY siren
        """
    ).fetchall()
    source_conn.close()

    shard_conns: list[sqlite3.Connection] = []
    shard_db_paths: list[Path] = []
    shard_counts = [0] * shard_count

    try:
        for shard_idx in range(shard_count):
            shard_db = shard_root / f"companies-france-shard-{shard_idx}.db"
            if shard_db.exists():
                shard_db.unlink()
            conn = sqlite3.connect(shard_db)
            ensure_schema(conn)
            shard_conns.append(conn)
            shard_db_paths.append(shard_db)

        insert_sql = """
            INSERT INTO companies_france (
              siren, company_name, normalized_name, search_name, naf_code, legal_category, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """

        for row in rows:
            shard_idx = bucket_for_siren(row["siren"], shard_count)
            shard_conns[shard_idx].execute(
                insert_sql,
                (
                    row["siren"],
                    row["company_name"],
                    row["normalized_name"],
                    row["search_name"],
                    row["naf_code"],
                    row["legal_category"],
                    row["is_active"],
                ),
            )
            shard_counts[shard_idx] += 1

        manifest = {"prefix": prefix, "source_db": str(source_db), "shards": []}
        for shard_idx, conn in enumerate(shard_conns):
            conn.commit()
            sql_path = shard_root / f"companies-france-shard-{shard_idx}.sql"
            write_d1_friendly_dump(conn, sql_path)
            manifest["shards"].append(
                {
                    "bucket": shard_idx,
                    "db_path": str(shard_db_paths[shard_idx]),
                    "sql_path": str(sql_path),
                    "row_count": shard_counts[shard_idx],
                }
            )

        (shard_root / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        print(json.dumps(manifest, indent=2))
    finally:
        for conn in shard_conns:
            conn.close()


def main() -> None:
    args = parse_args()
    build_shards(args.source_db, args.output_dir, args.prefix, args.shard_count)


if __name__ == "__main__":
    main()
