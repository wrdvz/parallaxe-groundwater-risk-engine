from __future__ import annotations

import argparse
import re
import sqlite3
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_UPSTREAM = (
    PROJECT_ROOT.parent / "icpe-groundwater-exposure" / "outputs" / "product"
)
DEFAULT_SIRENE_UNIT_LEGAL = (
    PROJECT_ROOT / "data" / "raw" / "sirene" / "StockUniteLegale_utf8.parquet"
)
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "outputs" / "runtime"
SCHEMA_FILE = PROJECT_ROOT / "cloudflare" / "worker" / "migrations" / "0001_init.sql"


TABLE_FILES = {
    "companies": "companies.parquet",
    "sites": "sites.parquet",
    "site_hydro_context": "site_hydro_context.parquet",
    "site_risk_scores": "site_risk_scores.parquet",
}

SEARCH_STOPWORDS = {
    "A",
    "AU",
    "AUX",
    "COMPAGNIE",
    "CO",
    "DE",
    "DEL",
    "DELA",
    "DES",
    "DU",
    "ET",
    "GROUPE",
    "HOLDING",
    "L",
    "LA",
    "LE",
    "LES",
    "SARL",
    "SAS",
    "SASU",
    "SA",
    "SCI",
    "SCOP",
    "SCEA",
    "SOCIETE",
    "STE",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Load upstream parquet product tables into a runtime SQLite DB and SQL dump.")
    parser.add_argument("--upstream-dir", type=Path, default=DEFAULT_UPSTREAM)
    parser.add_argument("--sirene-unit-legal", type=Path, default=DEFAULT_SIRENE_UNIT_LEGAL)
    parser.add_argument("--companies-france-limit", type=int, default=0)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--sqlite-name", default="groundwater-risk-engine.db")
    parser.add_argument("--sql-dump-name", default="groundwater-risk-engine-seed.sql")
    return parser.parse_args()


def _coerce_strings(df: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    for col in columns:
        if col in df.columns:
            df[col] = df[col].where(df[col].notna(), None)
    return df


def _normalize_text(value: str | None) -> str:
    if not value:
        return ""
    normalized = (
        str(value)
        .upper()
        .replace("-", " ")
        .replace("'", " ")
    )
    normalized = re.sub(r"[^A-Z0-9]+", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def _build_search_name(value: str | None) -> str:
    tokens = [token for token in _normalize_text(value).split(" ") if token and token not in SEARCH_STOPWORDS]
    return " ".join(tokens)


def load_tables(upstream_dir: Path) -> dict[str, pd.DataFrame]:
    tables: dict[str, pd.DataFrame] = {}
    for table_name, file_name in TABLE_FILES.items():
        file_path = upstream_dir / file_name
        if not file_path.exists():
            raise FileNotFoundError(f"Missing upstream table: {file_path}")
        tables[table_name] = pd.read_parquet(file_path)
    return tables


def load_companies_france(unit_legal_path: Path, limit: int) -> pd.DataFrame:
    if not unit_legal_path.exists():
        raise FileNotFoundError(f"Missing Sirene unit legal parquet: {unit_legal_path}")
    if limit <= 0:
        return pd.DataFrame(
            columns=[
                "siren",
                "company_name",
                "normalized_name",
                "search_name",
                "naf_code",
                "legal_category",
                "is_active",
            ]
        )

    columns = [
        "siren",
        "etatAdministratifUniteLegale",
        "denominationUniteLegale",
        "nomUniteLegale",
        "prenom1UniteLegale",
        "categorieJuridiqueUniteLegale",
        "activitePrincipaleUniteLegale",
    ]
    parquet = pq.ParquetFile(unit_legal_path)
    chunks: list[pd.DataFrame] = []
    collected = 0
    for row_group_idx in range(parquet.num_row_groups):
        remaining_groups = parquet.num_row_groups - row_group_idx
        remaining = limit - collected
        if remaining <= 0:
            break
        quota = max(1, -(-remaining // remaining_groups))
        batch = parquet.read_row_group(row_group_idx, columns=columns).to_pandas()
        batch = batch[batch["etatAdministratifUniteLegale"] == "A"].copy()
        if batch.empty:
            continue
        if len(batch) > quota:
            batch = batch.head(quota).copy()
        chunks.append(batch)
        collected += len(batch)
        if collected >= limit:
            break

    if not chunks:
        return pd.DataFrame(
            columns=[
                "siren",
                "company_name",
                "normalized_name",
                "search_name",
                "naf_code",
                "legal_category",
                "is_active",
            ]
        )

    df = pd.concat(chunks, ignore_index=True)

    company_name = (
        df["denominationUniteLegale"]
        .fillna("")
        .astype("string")
        .str.strip()
    )
    missing_name = company_name.eq("")
    fallback_name = (
        df["nomUniteLegale"].fillna("").astype("string").str.strip()
        + " "
        + df["prenom1UniteLegale"].fillna("").astype("string").str.strip()
    ).str.strip()
    company_name = company_name.where(~missing_name, fallback_name)

    companies_france = pd.DataFrame(
        {
            "siren": df["siren"].astype("string"),
            "company_name": company_name.astype("string"),
            "normalized_name": company_name.map(_normalize_text),
            "search_name": company_name.map(_build_search_name),
            "naf_code": df["activitePrincipaleUniteLegale"].astype("string"),
            "legal_category": df["categorieJuridiqueUniteLegale"].astype("string"),
            "is_active": 1,
        }
    )

    companies_france = _coerce_strings(
        companies_france,
        ["siren", "company_name", "normalized_name", "search_name", "naf_code", "legal_category"],
    )
    companies_france["search_name"] = companies_france["search_name"].where(
        companies_france["search_name"].astype("string").fillna("").str.strip().ne(""),
        companies_france["normalized_name"],
    )
    companies_france = companies_france[
        companies_france["siren"].astype("string").fillna("").str.strip().ne("")
        & companies_france["company_name"].astype("string").fillna("").str.strip().ne("")
    ].copy()
    companies_france = companies_france.drop_duplicates(subset=["siren"], keep="first")
    return companies_france


def normalize_tables(tables: dict[str, pd.DataFrame]) -> dict[str, pd.DataFrame]:
    companies = tables["companies"].copy()
    companies = _coerce_strings(companies, ["siren", "company_name", "naf_label", "normalized_name"])
    companies["search_name"] = companies["company_name"].map(_build_search_name)
    companies["search_name"] = companies["search_name"].where(companies["search_name"].ne(""), companies["normalized_name"])

    sites = tables["sites"].copy()
    sites["postal_code"] = sites["postal_code"].astype("string").str.replace(r"\.0$", "", regex=True)
    sites["is_geolocated"] = sites["is_geolocated"].astype(int)
    sites["is_icpe"] = sites["is_icpe"].astype(int)
    if "geo_score" in sites.columns:
        sites["geo_score"] = pd.to_numeric(sites["geo_score"], errors="coerce")
    sites = _coerce_strings(
        sites,
        [
            "site_id",
            "siret",
            "siren",
            "site_name",
            "company_name",
            "address_line",
            "postal_code",
            "city",
            "icpe_category",
            "naf_label",
            "source_url",
            "geo_type",
            "geoloc_confidence_label",
        ],
    )
    sites["search_name"] = sites["company_name"].map(_build_search_name)
    empty_mask = sites["search_name"].astype("string").fillna("").str.strip().eq("")
    sites.loc[empty_mask, "search_name"] = sites.loc[empty_mask, "site_name"].map(_build_search_name)
    sites["search_name"] = sites["search_name"].where(sites["search_name"].ne(""), sites["company_name"].map(_normalize_text))

    required_site_keys = ["site_id", "siret", "siren", "site_name", "company_name"]
    valid_sites_mask = pd.Series(True, index=sites.index)
    for col in required_site_keys:
        valid_sites_mask &= sites[col].astype("string").fillna("").str.strip().ne("")
    dropped_sites = int((~valid_sites_mask).sum())
    sites = sites.loc[valid_sites_mask].copy()
    kept_site_ids = set(sites["site_id"].tolist())
    kept_sirens = set(sites["siren"].tolist())

    ctx = tables["site_hydro_context"].copy()
    ctx["groundwater_signal_robust"] = ctx["groundwater_signal_robust"].astype(int)
    ctx = _coerce_strings(
        ctx,
        ["site_id", "aquifer_trend_level", "aquifer_signal_marker", "grid_class", "pressure_level"],
    )
    ctx = ctx[ctx["site_id"].isin(kept_site_ids)].copy()

    scores = tables["site_risk_scores"].copy()
    if "is_water_relevant" in scores.columns:
        scores["is_water_relevant"] = scores["is_water_relevant"].astype(int)
    if "within_water_scope" in scores.columns:
        scores["within_water_scope"] = scores["within_water_scope"].astype(int)
    scores = _coerce_strings(
        scores,
        ["site_id", "priority_level", "dependency_probability", "confidence_label", "risk_explanation_short", "score_version"],
    )
    scores = scores[scores["site_id"].isin(kept_site_ids)].copy()
    companies = companies[companies["siren"].isin(kept_sirens)].copy()

    if dropped_sites:
        print(
            f"Dropped {dropped_sites} site rows without the SIRET/SIREN keys required by the product app contract."
        )

    return {
        "companies": companies,
        "sites": sites,
        "site_hydro_context": ctx,
        "site_risk_scores": scores,
    }


def write_sqlite(tables: dict[str, pd.DataFrame], sqlite_path: Path) -> None:
    sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    if sqlite_path.exists():
        sqlite_path.unlink()

    conn = sqlite3.connect(sqlite_path)
    conn.executescript(SCHEMA_FILE.read_text())
    for table_name, df in tables.items():
        df.to_sql(table_name, conn, if_exists="append", index=False)
    conn.commit()
    conn.close()


def write_sql_dump(sqlite_path: Path, dump_path: Path) -> None:
    conn = sqlite3.connect(sqlite_path)
    with dump_path.open("w", encoding="utf-8") as fh:
        for line in conn.iterdump():
            if line.startswith("INSERT INTO "):
                fh.write(f"{line}\n")
    conn.close()


def main() -> None:
    args = parse_args()
    tables = load_tables(args.upstream_dir)
    tables = normalize_tables(tables)
    tables["companies_france"] = load_companies_france(args.sirene_unit_legal, args.companies_france_limit)

    output_dir = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    sqlite_path = output_dir / args.sqlite_name
    dump_path = output_dir / args.sql_dump_name

    write_sqlite(tables, sqlite_path)
    write_sql_dump(sqlite_path, dump_path)

    print(f"SQLite runtime DB written to: {sqlite_path}")
    print(f"SQL dump written to: {dump_path}")
    for table_name, df in tables.items():
        print(f"{table_name}: {len(df)} rows")


if __name__ == "__main__":
    main()
