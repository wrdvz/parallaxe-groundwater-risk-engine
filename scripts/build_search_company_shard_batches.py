from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_DB = PROJECT_ROOT / "outputs" / "runtime" / "groundwater-risk-engine-sample.db"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "outputs" / "runtime" / "search-company-shard-batches"
DEFAULT_SHARD_COUNT = 8
DEFAULT_BATCH_SIZE = 50000
DEFAULT_STATEMENT_SIZE = 1000

SCHEMA_SQL = """
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
""".strip()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Split companies_france into deterministic SIREN-based shard batches for resilient D1 ingestion."
    )
    parser.add_argument("--source-db", type=Path, default=DEFAULT_SOURCE_DB)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--prefix", default="sample-1m-batches")
    parser.add_argument("--shard-count", type=int, default=DEFAULT_SHARD_COUNT)
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--statement-size", type=int, default=DEFAULT_STATEMENT_SIZE)
    parser.add_argument("--start-shard", type=int, default=0)
    parser.add_argument("--end-shard", type=int, default=None)
    return parser.parse_args()


def bucket_for_siren(siren: str, shard_count: int) -> int:
    digits = "".join(ch for ch in str(siren or "") if ch.isdigit())
    if not digits:
        return 0
    return int(digits[-2:]) % shard_count


def sql_literal(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def row_to_values(row: sqlite3.Row) -> str:
    return (
        "("
        + ", ".join(
            [
                sql_literal(row["siren"]),
                sql_literal(row["company_name"]),
                sql_literal(row["normalized_name"]),
                sql_literal(row["search_name"]),
                sql_literal(row["naf_code"]),
                sql_literal(row["legal_category"]),
                sql_literal(row["is_active"]),
            ]
        )
        + ")"
    )


def build_insert_statements(rows: list[sqlite3.Row], statement_size: int) -> str:
    if statement_size <= 0:
        raise ValueError("statement_size must be > 0")

    statements: list[str] = []
    for start in range(0, len(rows), statement_size):
        chunk = rows[start : start + statement_size]
        values = [row_to_values(row) for row in chunk]
        statements.append(
            "INSERT OR IGNORE INTO companies_france "
            "(siren, company_name, normalized_name, search_name, naf_code, legal_category, is_active)\nVALUES\n"
            + ",\n".join(values)
            + ";\n"
        )
    return "\n".join(statements)


def build_shard_batches(
    source_db: Path,
    output_dir: Path,
    prefix: str,
    shard_count: int,
    batch_size: int,
    statement_size: int,
    start_shard: int,
    end_shard: int | None,
) -> None:
    if not source_db.exists():
        raise FileNotFoundError(f"Missing source DB: {source_db}")
    if batch_size <= 0:
        raise ValueError("batch_size must be > 0")
    if statement_size <= 0:
        raise ValueError("statement_size must be > 0")

    root = output_dir / prefix
    root.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(source_db)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT siren, company_name, normalized_name, search_name, naf_code, legal_category, is_active
        FROM companies_france
        ORDER BY siren
        """
    ).fetchall()
    conn.close()

    shard_rows: dict[int, list[sqlite3.Row]] = {idx: [] for idx in range(shard_count)}
    for row in rows:
        shard_rows[bucket_for_siren(row["siren"], shard_count)].append(row)

    manifest: dict[str, object] = {
        "prefix": prefix,
        "source_db": str(source_db),
        "shard_count": shard_count,
        "batch_size": batch_size,
        "shards": [],
    }

    last_shard = end_shard if end_shard is not None else shard_count - 1

    for shard_idx in range(shard_count):
        rows_for_shard = shard_rows[shard_idx]
        shard_dir = root / f"shard-{shard_idx}"
        schema_path = shard_dir / "schema.sql"
        part_paths: list[str] = []

        if start_shard <= shard_idx <= last_shard:
            shard_dir.mkdir(parents=True, exist_ok=True)
            schema_path.write_text(SCHEMA_SQL + "\n", encoding="utf-8")

            for existing_part in shard_dir.glob("part-*.sql"):
                existing_part.unlink()

            for part_idx, start in enumerate(range(0, len(rows_for_shard), batch_size), start=1):
                part_rows = rows_for_shard[start : start + batch_size]
                part_path = shard_dir / f"part-{part_idx:04d}.sql"
                part_path.write_text(build_insert_statements(part_rows, statement_size), encoding="utf-8")
                part_paths.append(str(part_path))
        elif schema_path.exists():
            part_paths = [str(path) for path in sorted(shard_dir.glob("part-*.sql"))]

        manifest["shards"].append(
            {
                "bucket": shard_idx,
                "row_count": len(rows_for_shard),
                "parts": len(part_paths),
                "schema_path": str(schema_path),
                "part_paths": part_paths,
            }
        )

    (root / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2))


def main() -> None:
    args = parse_args()
    build_shard_batches(
        source_db=args.source_db,
        output_dir=args.output_dir,
        prefix=args.prefix,
        shard_count=args.shard_count,
        batch_size=args.batch_size,
        statement_size=args.statement_size,
        start_shard=args.start_shard,
        end_shard=args.end_shard,
    )


if __name__ == "__main__":
    main()
