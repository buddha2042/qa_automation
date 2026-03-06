#!/usr/bin/env python3
"""
sisense_smodel_comparison_extract_v2.py
   
Given 2 Sisense Elasticube exports (.smodel JSON files), this script produces a single workbook with 4 sheets:
  1) METADATA        - raw row-level dataset/table/column metadata from both models
  2) JOINS_METADATA  - all join (relation) rows from both models
  3) COLUMN_SUMMARY  - per table, compares column uniqueness between the two models using *table_id + column_id* 
  4) JOIN_SUMMARY    - per table, compares join-count (table appearances in joins) between the two models
  5) TABLE_QUERIES   : per table, compares where table_expression is present and differs
  6) CUSTOM_TABLES   : per table, compares custom tables where table query differs
  7) HIDDEN_COLUMNS  : per table, compares columns where hidden differs for same (table_id, column_id)
  8) DATATYPES       : per table, compares columns where dataType differs for same (table_id, column_id)
  
Usage:
  python sisense_smodel_comparison_extract_v2.py modelA.smodel modelB.smodel --out combined_smodel_metadata_summary.xlsx
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
from pathlib import Path
from typing import Any, Dict, Optional, Tuple, List

import pandas as pd


# -----------------------------
# Loading helpers
# -----------------------------
def load_smodel(path: Path) -> Dict[str, Any]:
    """Load a .smodel file (JSON; sometimes gzipped JSON; sometimes non-UTF8)."""
    raw = path.read_bytes()

    for enc in ("utf-8", "latin-1"):
        try:
            return json.loads(raw.decode(enc))
        except Exception:
            pass

    try:
        raw2 = gzip.decompress(raw)
        for enc in ("utf-8", "latin-1"):
            try:
                return json.loads(raw2.decode(enc))
            except Exception:
                pass
    except Exception:
        pass

    raise ValueError(f"Could not parse {path} as JSON or gzipped JSON")


def clean_model_basename(p: Path) -> str:
    name = p.stem
    name = re.sub(r"[_\-\s]*LEAN$", "", name, flags=re.I)
    return name.replace(" ", "_") or p.stem


def _schema_name_from_ds(ds: dict) -> str:
    """schemaName can be a string OR a schema object in some exports; normalize to string."""
    v = ds.get("schemaName") or ds.get("schema") or ""
    if isinstance(v, dict):
        return str(v.get("name") or v.get("schemaName") or v.get("id") or "")
    return str(v) if v is not None else ""


def find_sqlish_query(obj: dict) -> str:
    """Return the best SQL-ish property from an object (or empty string)."""
    if not isinstance(obj, dict):
        return ""

    candidates = []
    cfg = obj.get("configOptions") or {}
    if isinstance(cfg, dict):
        candidates += list(cfg.items())
    candidates += list(obj.items())

    for k, v in candidates:
        if isinstance(v, str) and k.lower() in {"importquery", "importedquery"}:
            return v.strip()

    for k, v in candidates:
        if isinstance(v, str) and "importquery" in k.lower():
            return v.strip()

    sql_re = re.compile(r"\b(select|with|insert|update|delete|merge|call|exec)\b", re.I)
    for k, v in candidates:
        if isinstance(v, str) and ("query" in k.lower() or "sql" in k.lower()) and sql_re.search(v):
            return v.strip()

    return ""


def norm_table_expression(table_obj: dict) -> str:
    """Normalize Sisense table.expression into a comparable string."""
    v = table_obj.get("expression")
    if v is None:
        return ""
    if isinstance(v, dict):
        e = v.get("expression")
        return str(e).strip() if e is not None else ""
    if isinstance(v, str):
        return v.strip()
    return str(v).strip()


# -----------------------------
# METADATA extraction
# -----------------------------
def extract_metadata(model: Dict[str, Any], source_file: str, model_name: str) -> pd.DataFrame:
    rows: List[Dict[str, Any]] = []

    for ds in (model.get("datasets") or []):
        ds_database = str(ds.get("database") or "")
        ds_name = str(ds.get("name") or ds.get("fullname") or "")
        schemaName = _schema_name_from_ds(ds)
        ds_id = ds.get("id") or ds.get("oid") or ""
        ds_q_sql = find_sqlish_query(ds)

        tables: List[Dict[str, Any]] = []
        if isinstance(ds.get("schema"), dict) and ds["schema"].get("tables"):
            tables = ds["schema"]["tables"]
        elif ds.get("tables"):
            tables = ds["tables"]

        # Dataset with no tables
        if not tables:
            rows.append(
                {
                    "source_file": source_file,
                    "model": model_name,
                    "database": ds_database,
                    "dataset_name": ds_name,
                    "schemaName": schemaName,
                    "dataset_id": ds_id,
                    "table_id": None,
                    "table_name": None,
                    "table_type": None,
                    "table_expression": None,
                    "column_id": None,
                    "column_name": None,
                    "hidden": None,
                    "displayName": None,
                    "description": None,
                    "dataType": None,
                    "expression": None,
                    "dataset_importQuery": ds_q_sql,
                    "table_importQuery": "",
                }
            )
            continue

        for t in tables:
            table_name = str(t.get("displayName") or t.get("name") or t.get("id") or "")
            table_id = t.get("id") or t.get("oid") or ""
            table_type = t.get("type")
            table_expr = norm_table_expression(t) or ""
            t_q_sql = find_sqlish_query(t)
            cols = t.get("columns") or []

            # Table with no columns
            if not cols:
                rows.append(
                    {
                        "source_file": source_file,
                        "model": model_name,
                        "database": ds_database,
                        "dataset_name": ds_name,
                        "schemaName": schemaName,
                        "dataset_id": ds_id,
                        "table_id": table_id,
                        "table_name": table_name,
                        "table_type": table_type,
                        "table_expression": table_expr,
                        "column_id": None,
                        "column_name": None,
                        "hidden": None,
                        "displayName": None,
                        "description": None,
                        "dataType": None,
                        "expression": None,
                        "dataset_importQuery": ds_q_sql,
                        "table_importQuery": t_q_sql,
                    }
                )
                continue

            for c in cols:
                rows.append(
                    {
                        "source_file": source_file,
                        "model": model_name,
                        "database": ds_database,
                        "dataset_name": ds_name,
                        "schemaName": schemaName,
                        "dataset_id": ds_id,
                        "table_id": table_id,
                        "table_name": table_name,
                        "table_type": table_type,
                        "table_expression": table_expr,
                        "column_id": c.get("id") or c.get("oid"),
                        "column_name": c.get("displayName") or c.get("name") or c.get("id"),
                        "hidden": c.get("hidden"),
                        "displayName": c.get("displayName"),
                        "description": c.get("description"),
                        "dataType": c.get("dataType") or c.get("type"),
                        "expression": c.get("expression"),
                        "dataset_importQuery": ds_q_sql,
                        "table_importQuery": t_q_sql,
                    }
                )

    return pd.DataFrame(rows)


# -----------------------------
# Summary tabs
# -----------------------------
def build_column_summary_by_ids(metadata: pd.DataFrame) -> pd.DataFrame:
    """Per table (by table_id), compare column sets using column_id."""
    key_cols = ["database", "dataset_id", "schemaName", "table_id"]
    df = metadata.copy()
    df = df[df["table_id"].notna() & df["column_id"].notna()]

    for c in key_cols + ["model", "table_name", "column_id", "column_name"]:
        df[c] = df[c].fillna("").astype(str)

    df["_col_id"] = df["column_id"].str.strip()
    df = df[df["_col_id"] != ""]

    models = sorted(df["model"].dropna().unique().tolist())
    if len(models) != 2:
        raise ValueError(f"COLUMN_SUMMARY requires exactly 2 models; found: {models}")
    m1, m2 = models[0], models[1]

    # Set of column IDs per table per model
    sets = (
        df.groupby(key_cols + ["model"], dropna=False)["_col_id"]
        .agg(lambda s: set(s.tolist()))
        .reset_index(name="col_set")
    )

    pivot = sets.pivot_table(index=key_cols, columns="model", values="col_set", aggfunc="first").reset_index()
    pivot.columns = [str(c) for c in pivot.columns]

    # Carry a representative table_name for readability
    name_lookup = (
        df.groupby(key_cols, dropna=False)["table_name"]
        .agg(lambda s: next((x for x in s if x), ""))
        .reset_index()
    )
    pivot = pivot.merge(name_lookup, on=key_cols, how="left")

    # Column ID -> column name (per model) lookup
    name_map = (
        df.groupby(key_cols + ["model", "_col_id"], dropna=False)["column_name"]
        .agg(lambda s: next((x for x in s if x), ""))
        .reset_index()
    )
    name_dict = {
        (r["database"], r["dataset_id"], r["schemaName"], r["table_id"], r["model"], r["_col_id"]): r["column_name"]
        for _, r in name_map.iterrows()
    }

    def _as_set(v: Any) -> set:
        return v if isinstance(v, set) else set()

    out = pivot[key_cols + ["table_name"]].copy()
    out[f"unique_cols_in_{m1}"] = 0
    out[f"unique_cols_in_{m2}"] = 0
    out[f"unique_col_ids_in_{m1}"] = ""
    out[f"unique_col_ids_in_{m2}"] = ""
    out[f"unique_col_names_in_{m1}"] = ""
    out[f"unique_col_names_in_{m2}"] = ""

    for i, r in pivot.iterrows():
        s1 = _as_set(r.get(m1))
        s2 = _as_set(r.get(m2))
        d1 = sorted(s1 - s2)
        d2 = sorted(s2 - s1)

        out.loc[i, f"unique_cols_in_{m1}"] = len(d1)
        out.loc[i, f"unique_cols_in_{m2}"] = len(d2)
        out.loc[i, f"unique_col_ids_in_{m1}"] = ", ".join(d1)
        out.loc[i, f"unique_col_ids_in_{m2}"] = ", ".join(d2)

        base = (r["database"], r["dataset_id"], r["schemaName"], r["table_id"])
        names1 = [f"{name_dict.get((*base, m1, cid), '')} ({cid})" for cid in d1]
        names2 = [f"{name_dict.get((*base, m2, cid), '')} ({cid})" for cid in d2]
        out.loc[i, f"unique_col_names_in_{m1}"] = ", ".join([n for n in names1 if n.strip()])
        out.loc[i, f"unique_col_names_in_{m2}"] = ", ".join([n for n in names2 if n.strip()])

    return out.sort_values(key_cols).reset_index(drop=True)


def table_level_df(metadata: pd.DataFrame) -> pd.DataFrame:
    """Unique table rows per (model, table_id) with table-level metadata and normalized 'table_query'."""
    df = metadata.copy()
    df = df[df["table_id"].notna()]

    for c in [
        "model",
        "database",
        "dataset_id",
        "schemaName",
        "table_id",
        "table_name",
        "table_type",
        "table_expression",
        "table_importQuery",
    ]:
        if c not in df.columns:
            df[c] = ""
        df[c] = df[c].fillna("").astype(str)

    def _first_nonempty(series):
        for x in series:
            if isinstance(x, str) and x.strip() != "":
                return x
        return ""

    grouped = (
        df.groupby(["model", "table_id"], dropna=False)
        .agg(
            database=("database", _first_nonempty),
            dataset_id=("dataset_id", _first_nonempty),
            schemaName=("schemaName", _first_nonempty),
            table_name=("table_name", _first_nonempty),
            table_type=("table_type", _first_nonempty),
            table_expression=("table_expression", _first_nonempty),
            table_importQuery=("table_importQuery", _first_nonempty),
        )
        .reset_index()
    )

    grouped["table_query"] = grouped["table_expression"].where(
        grouped["table_expression"].str.strip() != "",
        grouped["table_importQuery"],
    )
    return grouped
def build_query_diff_tab(
    tables: pd.DataFrame,
    model_a: str,
    model_b: str,
    type_values: set,
    require_expression: bool,
    sheet_name: str,
) -> pd.DataFrame:
    """
    Per-table comparison of query text for matching table_id across the two models.
    Produces one row per table_id (union across the two models for the filtered table types).
    """
    df = tables.copy()

    for c in ["model", "database", "dataset_id", "schemaName", "table_id", "table_name", "table_type", "table_expression", "table_query"]:
        if c not in df.columns:
            df[c] = ""
        df[c] = df[c].fillna("").astype(str)

    df = df[df["table_type"].isin(type_values)]
    if require_expression:
        df = df[df["table_expression"].str.strip() != ""]

    a_df = df[df["model"] == model_a][
        ["database", "dataset_id", "schemaName", "table_id", "table_name", "table_query"]
    ].rename(
        columns={"table_name": f"table_name_in_{model_a}", "table_query": f"table_query_in_{model_a}"}
    )

    b_df = df[df["model"] == model_b][
        ["database", "dataset_id", "schemaName", "table_id", "table_name", "table_query"]
    ].rename(
        columns={"table_name": f"table_name_in_{model_b}", "table_query": f"table_query_in_{model_b}"}
    )

    merged = a_df.merge(b_df, on="table_id", how="outer", suffixes=("_a", "_b"))

    # Coalesce common table-level metadata (prefer model_a when present)
    merged["database"] = merged["database_a"].where(merged["database_a"].str.strip() != "", merged["database_b"])
    merged["dataset_id"] = merged["dataset_id_a"].where(merged["dataset_id_a"].str.strip() != "", merged["dataset_id_b"])
    merged["schemaName"] = merged["schemaName_a"].where(merged["schemaName_a"].str.strip() != "", merged["schemaName_b"])

    merged["table_name"] = merged[f"table_name_in_{model_a}"].where(
        merged[f"table_name_in_{model_a}"].fillna("").str.strip() != "",
        merged.get(f"table_name_in_{model_b}", ""),
    )

    qa = merged.get(f"table_query_in_{model_a}", "").fillna("")
    qb = merged.get(f"table_query_in_{model_b}", "").fillna("")
    merged["is_different"] = (qa != "") & (qb != "") & (qa != qb)

    # Keep columns consistent and useful
    out_cols = [
        "database",
        "dataset_id",
        "schemaName",
        "table_name",
        "table_id",
        f"table_name_in_{model_a}",
        f"table_name_in_{model_b}",
        f"table_query_in_{model_a}",
        f"table_query_in_{model_b}",
        "is_different",
    ]

    # Some columns may not exist if a model has no matching rows after filters
    for c in out_cols:
        if c not in merged.columns:
            merged[c] = ""

    return merged[out_cols].sort_values(["database", "dataset_id", "schemaName", "table_name"]).reset_index(drop=True)


def build_column_attr_diff_tab(
    metadata: pd.DataFrame,
    model_a: str,
    model_b: str,
    attr: str,
    sheet_name: str,
) -> pd.DataFrame:
    """
    Per-table summary: for each table_id, count (and list) columns where the given attribute differs
    for the same (table_id, column_id) across the two models.
    Output rows include: database, dataset_id, schemaName, table_name, table_id.
    """
    df = metadata.copy()
    df = df[df["column_id"].notna() & df["table_id"].notna()]

    for c in ["model", "database", "dataset_id", "schemaName", "table_id", "table_name", "column_id", "column_name", attr]:
        if c not in df.columns:
            df[c] = ""
        df[c] = df[c].fillna("").astype(str)

    key = ["table_id", "column_id"]

    a = df[df["model"] == model_a].groupby(key, dropna=False).agg(
        database=("database", lambda s: next((x for x in s if x), "")),
        dataset_id=("dataset_id", lambda s: next((x for x in s if x), "")),
        schemaName=("schemaName", lambda s: next((x for x in s if x), "")),
        table_name=("table_name", lambda s: next((x for x in s if x), "")),
        col_name_a=("column_name", lambda s: next((x for x in s if x), "")),
        val_a=(attr, lambda s: next((x for x in s if x != ""), "")),
    ).reset_index()

    b = df[df["model"] == model_b].groupby(key, dropna=False).agg(
        database_b=("database", lambda s: next((x for x in s if x), "")),
        dataset_id_b=("dataset_id", lambda s: next((x for x in s if x), "")),
        schemaName_b=("schemaName", lambda s: next((x for x in s if x), "")),
        table_name_b=("table_name", lambda s: next((x for x in s if x), "")),
        col_name_b=("column_name", lambda s: next((x for x in s if x), "")),
        val_b=(attr, lambda s: next((x for x in s if x != ""), "")),
    ).reset_index()

    merged = a.merge(b, on=key, how="inner")

    if attr == "hidden":
        def _norm_hidden(v: str) -> str:
            vv = str(v).strip().lower()
            if vv in {"true", "1", "yes"}:
                return "true"
            if vv in {"false", "0", "no"}:
                return "false"
            return vv  # keep as-is (or "")

        merged["val_a_norm"] = merged["val_a"].apply(_norm_hidden)
        merged["val_b_norm"] = merged["val_b"].apply(_norm_hidden)
    else:
        merged["val_a_norm"] = merged["val_a"].astype(str).str.strip().str.lower()
        merged["val_b_norm"] = merged["val_b"].astype(str).str.strip().str.lower()

    diff = merged[merged["val_a_norm"] != merged["val_b_norm"]].copy()

    # Per-table aggregation
    def _first_nonempty(series):
        for x in series:
            if isinstance(x, str) and x.strip() != "":
                return x
        return ""

    per_table = diff.groupby(["table_id"], dropna=False).agg(
        database=("database", _first_nonempty),
        dataset_id=("dataset_id", _first_nonempty),
        schemaName=("schemaName", _first_nonempty),
        table_name=("table_name", _first_nonempty),
        diff_count=("column_id", "size"),
        column_ids=("column_id", list),
        column_names_in_model_a=("col_name_a", list),
        column_names_in_model_b=("col_name_b", list),
    ).reset_index()

    # Rename columns to keep the tab consistent with previous expectation
    per_table = per_table.rename(
        columns={
            "diff_count": f"diff_count_in_{model_a}_and_{model_b}",
        }
    )

    return per_table[
        [
            "database",
            "dataset_id",
            "schemaName",
            "table_name",
            "table_id",
            f"diff_count_in_{model_a}_and_{model_b}",
            "column_ids",
            "column_names_in_model_a",
            "column_names_in_model_b",
        ]
    ].sort_values(["database", "dataset_id", "schemaName", "table_name"]).reset_index(drop=True)


# -----------------------------
# JOINS extraction (unchanged)
# -----------------------------
def build_lookup(model: Dict[str, Any]) -> Dict[str, Any]:
    """
    dataset_oid -> {
      dataset_label, database, schemaName,
      tables: { table_oid -> { table_name, columns: { column_oid -> column_name } } }
    }
    """
    ds_map: Dict[str, Any] = {}

    for ds in model.get("datasets") or []:
        ds_oid = ds.get("oid") or ds.get("id")
        if not ds_oid:
            continue

        ds_label = ds.get("fullname") or ds.get("name") or ds_oid
        ds_map[ds_oid] = {
            "dataset_oid": ds_oid,
            "dataset_label": ds_label,
            "database": ds.get("database"),
            "schemaName": _schema_name_from_ds(ds),
            "tables": {},
        }

        schema = ds.get("schema") or {}
        for t in schema.get("tables") or []:
            t_oid = t.get("oid") or t.get("id")
            if not t_oid:
                continue

            t_name = t.get("displayName") or t.get("name") or t.get("id") or t_oid
            cols: Dict[str, str] = {}

            for c in t.get("columns") or []:
                c_oid = c.get("oid") or c.get("id")
                if not c_oid:
                    continue
                c_name = c.get("displayName") or c.get("name") or c.get("id") or c_oid
                cols[c_oid] = c_name

            ds_map[ds_oid]["tables"][t_oid] = {"table_name": t_name, "table_id": (t.get("id") or t_oid), "columns": cols}

    return ds_map


def resolve_ref(
    lookup: Dict[str, Any],
    dataset_oid: Optional[str],
    table_oid: Optional[str],
    column_oid: Optional[str],
) -> Tuple[str, Optional[str], Optional[str], str, str]:
    ds = lookup.get(dataset_oid or "", {})
    dataset_label = ds.get("dataset_label", dataset_oid or "")
    database = ds.get("database")
    schema_name = ds.get("schemaName")

    table = (ds.get("tables") or {}).get(table_oid or "", {})
    table_name = table.get("table_name", table_oid or "")

    column_name = (table.get("columns") or {}).get(column_oid or "", column_oid or "")

    return dataset_label, database, schema_name, table_name, column_name


def resolve_ref_with_ids(
    lookup: Dict[str, Any],
    dataset_oid: Optional[str],
    table_oid: Optional[str],
    column_oid: Optional[str],
) -> Tuple[str, Optional[str], Optional[str], str, str, str, str]:
    """
    Like resolve_ref, but also returns dataset_oid, table_id (table 'id' field), and column_id (column oid/id).
    Returns:
      dataset_label, database, schema_name, table_name, column_name, dataset_oid_str, table_id_str, column_id_str
    """
    ds = lookup.get(dataset_oid or "", {})
    dataset_label = ds.get("dataset_label", dataset_oid or "")
    database = ds.get("database")
    schema_name = ds.get("schemaName")

    table = (ds.get("tables") or {}).get(table_oid or "", {})
    table_name = table.get("table_name", table_oid or "")
    table_id = table.get("table_id", table_oid or "")

    column_name = (table.get("columns") or {}).get(column_oid or "", column_oid or "")
    column_id = column_oid or ""

    return dataset_label, database, schema_name, table_name, column_name, (dataset_oid or ""), table_id, column_id


def extract_joins(model: Dict[str, Any], source_file: str) -> pd.DataFrame:
    """Create one output row per relation pair."""
    lookup = build_lookup(model)
    rows: List[Dict[str, Any]] = []

    for rel in (model.get("relations") or []):
        rel_oid = rel.get("oid")
        cols = rel.get("columns") or []
        if len(cols) < 2:
            continue

        left = cols[0]
        for right in cols[1:]:
            l_ds_oid = left.get("dataset")
            l_tbl_oid = left.get("table")
            l_col_oid = left.get("column")

            r_ds_oid = right.get("dataset")
            r_tbl_oid = right.get("table")
            r_col_oid = right.get("column")

            l_ds, l_db, l_schema, l_tbl, l_col, _l_ds_oid, l_tbl_id, _l_col_id = resolve_ref_with_ids(lookup, l_ds_oid, l_tbl_oid, l_col_oid)
            r_ds, r_db, r_schema, r_tbl, r_col, _r_ds_oid, r_tbl_id, _r_col_id = resolve_ref_with_ids(lookup, r_ds_oid, r_tbl_oid, r_col_oid)

            rows.append(
                {
                    "source_file": source_file,
                    "relation_oid": rel_oid,
                    "left_dataset_oid": l_ds_oid,
                    "left_dataset": l_ds,
                    "left_database": l_db,
                    "left_schema": l_schema,
                    "left_table_oid": l_tbl_oid,
                    "left_table_id": l_tbl_id,
                    "left_table": l_tbl,
                    "left_column_oid": l_col_oid,
                    "left_column": l_col,
                    "left_isDropped": left.get("isDropped"),
                    "right_dataset_oid": r_ds_oid,
                    "right_dataset": r_ds,
                    "right_database": r_db,
                    "right_schema": r_schema,
                    "right_table_oid": r_tbl_oid,
                    "right_table_id": r_tbl_id,
                    "right_table": r_tbl,
                    "right_column_oid": r_col_oid,
                    "right_column": r_col,
                    "right_isDropped": right.get("isDropped"),
                }
            )

    return pd.DataFrame(rows)


def build_join_summary(joins_df: pd.DataFrame, model_a_label: str, model_b_label: str) -> pd.DataFrame:
    """
    Per table_id, compare join counts between the two source files.
    Join count per table = appearances of a table in join rows (left OR right side).
    Output rows include: database, dataset_id, schemaName, table_name, table_id.
    """
    cols = [
        "database",
        "dataset_id",
        "schemaName",
        "table_name",
        "table_id",
        model_a_label,
        model_b_label,
        f"diff_{model_b_label}_minus_{model_a_label}",
    ]
    if joins_df.empty:
        return pd.DataFrame(columns=cols)

    # Normalize occurrences from left and right sides
    left_occ = joins_df[
        ["source_file", "left_database", "left_dataset_oid", "left_schema", "left_table_id", "left_table"]
    ].copy()
    left_occ.columns = ["source_file", "database", "dataset_id", "schemaName", "table_id", "table_name"]

    right_occ = joins_df[
        ["source_file", "right_database", "right_dataset_oid", "right_schema", "right_table_id", "right_table"]
    ].copy()
    right_occ.columns = ["source_file", "database", "dataset_id", "schemaName", "table_id", "table_name"]

    occ = pd.concat([left_occ, right_occ], ignore_index=True)

    # Count join appearances per table per source file
    counts = (
        occ.groupby(["source_file", "database", "dataset_id", "schemaName", "table_id"], dropna=False)
        .agg(
            join_count=("table_id", "size"),
            table_name=("table_name", lambda s: next((x for x in s if pd.notna(x) and str(x).strip() != ""), "")),
        )
        .reset_index()
    )

    pivot = (
        counts.pivot_table(
            index=["database", "dataset_id", "schemaName", "table_id", "table_name"],
            columns="source_file",
            values="join_count",
            aggfunc="sum",
            fill_value=0,
        )
        .reset_index()
    )

    for col in [model_a_label, model_b_label]:
        if col not in pivot.columns:
            pivot[col] = 0

    pivot = pivot[["database", "dataset_id", "schemaName", "table_name", "table_id", model_a_label, model_b_label]]
    pivot[f"diff_{model_b_label}_minus_{model_a_label}"] = pivot[model_b_label] - pivot[model_a_label]

    return pivot.sort_values(["database", "dataset_id", "schemaName", "table_name"]).reset_index(drop=True)


# -----------------------------
# Main / Excel output
# -----------------------------
def main() -> None:
    ap = argparse.ArgumentParser(description="Create a combined Sisense .smodel metadata+join comparison workbook.")
    ap.add_argument("model_a", type=Path, help="Path to first .smodel file")
    ap.add_argument("model_b", type=Path, help="Path to second .smodel file")
    ap.add_argument("--out", type=Path, default=Path("combined_smodel_metadata_summary_v2.xlsx"), help="Output .xlsx path")
    args = ap.parse_args()

    model_a_label = args.model_a.name
    model_b_label = args.model_b.name
    model_a_name = clean_model_basename(args.model_a)
    model_b_name = clean_model_basename(args.model_b)

    model_a = load_smodel(args.model_a)
    model_b = load_smodel(args.model_b)

    meta_a = extract_metadata(model_a, source_file=model_a_label, model_name=model_a_name)
    meta_b = extract_metadata(model_b, source_file=model_b_label, model_name=model_b_name)
    metadata_all = pd.concat([meta_a, meta_b], ignore_index=True)

    joins_a = extract_joins(model_a, source_file=model_a_label)
    joins_b = extract_joins(model_b, source_file=model_b_label)
    joins_all = pd.concat([joins_a, joins_b], ignore_index=True)

    # Existing summaries (updated COLUMN_SUMMARY identity)
    column_summary = build_column_summary_by_ids(metadata_all)
    join_summary = build_join_summary(joins_all, model_a_label=model_a_label, model_b_label=model_b_label)

    # New summary tabs
    tables = table_level_df(metadata_all)

    table_queries = build_query_diff_tab(
        tables,
        model_a=model_a_name,
        model_b=model_b_name,
        type_values={"table", "base"},   # Sisense sometimes exports normal tables as 'base'
        require_expression=True,
        sheet_name="TABLE_QUERIES",
    )

    custom_tables = build_query_diff_tab(
        tables,
        model_a=model_a_name,
        model_b=model_b_name,
        type_values={"custom"},
        require_expression=False,
        sheet_name="CUSTOM_TABLES",
    )

    hidden_columns = build_column_attr_diff_tab(
        metadata_all,
        model_a=model_a_name,
        model_b=model_b_name,
        attr="hidden",
        sheet_name="HIDDEN_COLUMNS",
    )

    datatypes = build_column_attr_diff_tab(
        metadata_all,
        model_a=model_a_name,
        model_b=model_b_name,
        attr="dataType",
        sheet_name="DATATYPES",
    )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(args.out, engine="openpyxl") as writer:
        metadata_all.to_excel(writer, sheet_name="METADATA", index=False)
        joins_all.to_excel(writer, sheet_name="JOINS_METADATA", index=False)
        column_summary.to_excel(writer, sheet_name="COLUMN_SUMMARY", index=False)
        join_summary.to_excel(writer, sheet_name="JOIN_SUMMARY", index=False)
        table_queries.to_excel(writer, sheet_name="TABLE_QUERIES", index=False)
        custom_tables.to_excel(writer, sheet_name="CUSTOM_TABLES", index=False)
        hidden_columns.to_excel(writer, sheet_name="HIDDEN_COLUMNS", index=False)
        datatypes.to_excel(writer, sheet_name="DATATYPES", index=False)

    print(f"Output workbook: {args.out}")
    print(f"METADATA rows: {len(metadata_all):,}")
    print(f"JOINS rows: {len(joins_all):,}")
    print(f"COLUMN_SUMMARY rows: {len(column_summary):,}")
    print(f"JOIN_SUMMARY rows: {len(join_summary):,}")
    print(f"TABLE_QUERIES rows: {len(table_queries):,}")
    print(f"CUSTOM_TABLES rows: {len(custom_tables):,}")
    print(f"HIDDEN_COLUMNS rows: {len(hidden_columns):,}")
    print(f"DATATYPES rows: {len(datatypes):,}")


if __name__ == "__main__":
    main()
