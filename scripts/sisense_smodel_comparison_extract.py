#!/usr/bin/env python3
"""
sisense_smodel_comparison_extract_v2.py
   
Given 2 Sisense Elasticube exports (.smodel JSON files), this script produces a workbook with these sheets:
  1) METADATA        - raw row-level dataset/table/column metadata from both models
  2) JOINS_METADATA  - all join (relation) rows from both models
  3) COLUMN_SUMMARY  - per table, compares column uniqueness between the two models using normalized column names
  4) JOIN_SUMMARY    - per table, compares unique relation-group counts between the two models
  5) TABLE_QUERIES   : per table, compares effective table query text across the two models
  6) CUSTOM_TABLES   : per table, compares custom tables where table query differs
  7) HIDDEN_COLUMNS  : per table, compares columns where hidden differs for same logical (table_name, column_name)
  8) DATATYPES       : per table, compares columns where dataType differs for same logical (table_name, column_name)
  9) CUSTOM_FIELDS   : per table, compares transformation-added custom fields between the two models
  
Usage:
  python sisense_smodel_comparison_extract_v2.py modelA.smodel modelB.smodel --out combined_smodel_metadata_summary.xlsx
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import re
from pathlib import Path
from typing import Any, Dict, Optional, Tuple, List

import pandas as pd


DATA_TYPE_GROUPS: Dict[str, str] = {
    "4": "date_time",
    "6": "number",
    "8": "integer",
    "16": "integer",
    "18": "text",
    "19": "date_time",
    "31": "date_time",
    "40": "number",
}


def df_records(df: pd.DataFrame) -> List[Dict[str, Any]]:
    """Convert dataframe rows to JSON-safe records (NaN/NA -> None)."""
    records: List[Dict[str, Any]] = []
    for raw in df.to_dict(orient="records"):
        clean: Dict[str, Any] = {}
        for key, value in raw.items():
            if value is None:
                clean[key] = None
            elif isinstance(value, float) and math.isnan(value):
                clean[key] = None
            else:
                clean[key] = value
        records.append(clean)
    return records


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


def get_dataset_tables(ds: Dict[str, Any]) -> List[Dict[str, Any]]:
    if isinstance(ds.get("schema"), dict) and ds["schema"].get("tables"):
        return ds["schema"]["tables"]
    if ds.get("tables"):
        return ds["tables"]
    return []


def normalize_data_type_group(value: Any) -> str:
    raw = str(value or "").strip()
    if raw == "":
        return ""
    lowered = raw.lower()
    return DATA_TYPE_GROUPS.get(lowered, lowered)


def build_effective_columns(table_obj: Dict[str, Any]) -> List[Dict[str, Any]]:
    base_columns = table_obj.get("columns") or []
    effective_columns: Dict[str, Dict[str, Any]] = {}
    lookup: Dict[str, str] = {}

    for index, column in enumerate(base_columns):
        key = str(column.get("oid") or column.get("id") or f"base_{index}")
        record = {
            "oid": column.get("oid"),
            "id": column.get("id") or column.get("oid"),
            "name": column.get("name"),
            "displayName": column.get("displayName"),
            "description": column.get("description"),
            "hidden": column.get("hidden"),
            "dataType": column.get("dataType") or column.get("type"),
            "originalDataType": column.get("dataType") or column.get("type"),
            "expression": column.get("expression"),
            "columnOrigin": "physical",
            "_dont_import": False,
        }
        effective_columns[key] = record
        if column.get("oid") is not None:
            lookup[str(column.get("oid"))] = key
        if column.get("id") is not None:
            lookup[str(column.get("id"))] = key

    for index, transform in enumerate(table_obj.get("tupleTransformations") or []):
        transform_type = str(transform.get("type") or "")
        arguments = transform.get("arguments") or {}

        if transform_type in {"dont-import", "rename-column", "change-data-type"}:
            column_ref = arguments.get("column")
            key = lookup.get(str(column_ref))
            if not key:
                continue
            record = effective_columns[key]

            if transform_type == "dont-import":
                record["_dont_import"] = True
            elif transform_type == "rename-column":
                if arguments.get("name") is not None:
                    record["name"] = arguments.get("name")
                if arguments.get("displayName") is not None:
                    record["displayName"] = arguments.get("displayName")
                elif arguments.get("name") is not None:
                    record["displayName"] = arguments.get("name")
            elif transform_type == "change-data-type" and arguments.get("type") is not None:
                record["dataType"] = arguments.get("type")
            continue

        if transform_type != "add-column":
            continue

        key = str(arguments.get("oid") or arguments.get("id") or f"add_{index}")
        expression = arguments.get("expression")
        effective_columns[key] = {
            "oid": arguments.get("oid"),
            "id": arguments.get("id") or arguments.get("oid"),
            "name": arguments.get("name") or arguments.get("id"),
            "displayName": arguments.get("displayName") or arguments.get("name") or arguments.get("id"),
            "description": arguments.get("description"),
            "hidden": arguments.get("hidden"),
            "dataType": arguments.get("dataType") or arguments.get("type"),
            "originalDataType": arguments.get("dataType") or arguments.get("type"),
            "expression": expression.get("expression") if isinstance(expression, dict) else expression,
            "columnOrigin": "add-column",
            "_dont_import": False,
        }
        if arguments.get("oid") is not None:
            lookup[str(arguments.get("oid"))] = key
        if arguments.get("id") is not None:
            lookup[str(arguments.get("id"))] = key

    return [record for record in effective_columns.values() if not record.get("_dont_import")]


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

        tables = get_dataset_tables(ds)

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
            cols = build_effective_columns(t)

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
                column_name = c.get("displayName") or c.get("name") or c.get("id") or c.get("oid")
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
                        "column_name": column_name,
                        "hidden": c.get("hidden"),
                        "displayName": c.get("displayName"),
                        "description": c.get("description"),
                        "dataType": c.get("dataType"),
                        "dataTypeGroup": normalize_data_type_group(c.get("dataType")),
                        "originalDataType": c.get("originalDataType"),
                        "originalDataTypeGroup": normalize_data_type_group(c.get("originalDataType")),
                        "expression": c.get("expression"),
                        "column_origin": c.get("columnOrigin"),
                        "is_custom_field": c.get("columnOrigin") == "add-column",
                        "dataset_importQuery": ds_q_sql,
                        "table_importQuery": t_q_sql,
                    }
                )

    return pd.DataFrame(rows)


def build_custom_field_summary(metadata: pd.DataFrame) -> pd.DataFrame:
    key_cols = logical_table_key_cols()
    df = metadata.copy()
    df = df[df.get("is_custom_field", False) == True]
    if df.empty:
        return pd.DataFrame(
            columns=[
                "database",
                "dataset_id",
                "schemaName",
                "table_name",
                "table_id",
                "custom_field_count_in_model_a",
                "custom_field_count_in_model_b",
                "custom_field_diff_model_b_minus_model_a",
                "custom_fields_in_model_a",
                "custom_fields_in_model_b",
            ]
        )

    for c in ["database", "dataset_id", "schemaName", "model", "table_id", "table_name", "column_name"]:
        df[c] = df[c].fillna("").astype(str)

    df["_table_name_key"] = df["table_name"].apply(normalize_table_name)
    df["_col_name_key"] = df["column_name"].apply(normalize_column_name)
    df = df[(df["_table_name_key"] != "") & (df["_col_name_key"] != "")]

    models = sorted(df["model"].dropna().unique().tolist())
    if len(models) != 2:
        raise ValueError(f"CUSTOM_FIELDS requires exactly 2 models; found: {models}")
    m1, m2 = models[0], models[1]

    sets = (
        df.groupby(key_cols + ["model"], dropna=False)["_col_name_key"]
        .agg(lambda s: set(s.tolist()))
        .reset_index(name="col_set")
    )
    pivot = sets.pivot_table(index=key_cols, columns="model", values="col_set", aggfunc="first").reset_index()
    pivot.columns = [str(c) for c in pivot.columns]

    table_lookup = (
        df.groupby(key_cols, dropna=False)
        .agg(
            database=("database", lambda s: next((x for x in s if x), "")),
            dataset_id=("dataset_id", lambda s: next((x for x in s if x), "")),
            schemaName=("schemaName", lambda s: next((x for x in s if x), "")),
            table_name=("table_name", lambda s: next((x for x in s if x), "")),
            table_id=("table_id", lambda s: next((x for x in s if x), "")),
        )
        .reset_index()
    )
    pivot = pivot.merge(table_lookup, on=key_cols, how="left")

    name_map = (
        df.groupby(key_cols + ["model", "_col_name_key"], dropna=False)["column_name"]
        .agg(lambda s: next((x for x in s if x), ""))
        .reset_index()
    )
    name_dict = {
        (r["_table_name_key"], r["model"], r["_col_name_key"]): r["column_name"]
        for _, r in name_map.iterrows()
    }

    def _as_set(v: Any) -> set:
        return v if isinstance(v, set) else set()

    out = pivot[key_cols + ["database", "dataset_id", "schemaName", "table_name", "table_id"]].copy()
    out[f"custom_field_count_in_{m1}"] = 0
    out[f"custom_field_count_in_{m2}"] = 0
    out[f"custom_field_diff_{m2}_minus_{m1}"] = 0
    out[f"custom_fields_in_{m1}"] = ""
    out[f"custom_fields_in_{m2}"] = ""

    for i, r in pivot.iterrows():
        s1 = _as_set(r.get(m1))
        s2 = _as_set(r.get(m2))
        out.loc[i, f"custom_field_count_in_{m1}"] = len(s1)
        out.loc[i, f"custom_field_count_in_{m2}"] = len(s2)
        out.loc[i, f"custom_field_diff_{m2}_minus_{m1}"] = len(s2) - len(s1)
        base = r["_table_name_key"]
        out.loc[i, f"custom_fields_in_{m1}"] = ", ".join(
            sorted(name_dict.get((base, m1, col_name_key), col_name_key) for col_name_key in s1)
        )
        out.loc[i, f"custom_fields_in_{m2}"] = ", ".join(
            sorted(name_dict.get((base, m2, col_name_key), col_name_key) for col_name_key in s2)
        )

    return out.drop(columns=["_table_name_key"]).sort_values(["database", "schemaName", "table_name"]).reset_index(drop=True)


# -----------------------------
# Summary tabs
# -----------------------------
def normalize_column_name(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).lower()


def normalize_table_name(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).lower()


def logical_table_key_cols() -> List[str]:
    return ["_table_name_key"]


def is_truthy_flag(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"true", "1", "yes"}


def extract_table_field_inventory(model: Dict[str, Any], model_name: str) -> pd.DataFrame:
    rows: List[Dict[str, Any]] = []

    for ds in (model.get("datasets") or []):
        ds_database = str(ds.get("database") or "")
        schemaName = _schema_name_from_ds(ds)
        ds_id = ds.get("id") or ds.get("oid") or ""

        for table in get_dataset_tables(ds):
            table_name = str(table.get("displayName") or table.get("name") or table.get("id") or "")
            table_id = table.get("id") or table.get("oid") or ""
            if not table_name:
                continue

            base_columns = table.get("columns") or []
            effective_columns = build_effective_columns(table)
            physical_columns = [column for column in effective_columns if column.get("columnOrigin") != "add-column"]
            custom_columns = [column for column in effective_columns if column.get("columnOrigin") == "add-column"]

            field_count_without_custom = len(base_columns)
            custom_field_count = len(custom_columns)
            total_field_count = field_count_without_custom + custom_field_count
            dropped_field_count = max(field_count_without_custom - len(physical_columns), 0)
            available_field_count = sum(
                1 for column in physical_columns if not is_truthy_flag(column.get("hidden"))
            )

            rows.append(
                {
                    "model": model_name,
                    "database": ds_database,
                    "dataset_id": ds_id,
                    "schemaName": schemaName,
                    "table_id": table_id,
                    "table_name": table_name,
                    "field_count_without_custom": field_count_without_custom,
                    "custom_field_count": custom_field_count,
                    "total_field_count": total_field_count,
                    "available_field_count": available_field_count,
                    "dropped_field_count": dropped_field_count,
                }
            )

    return pd.DataFrame(rows)


def build_field_count_summary(field_inventory: pd.DataFrame) -> pd.DataFrame:
    key_cols = logical_table_key_cols()
    df = field_inventory.copy()
    if df.empty:
        return pd.DataFrame(
            columns=[
                "database",
                "dataset_id",
                "schemaName",
                "table_name",
                "table_id",
                "total_field_count_in_model_a",
                "total_field_count_in_model_b",
                "total_field_count_diff_model_b_minus_model_a",
                "field_count_without_custom_in_model_a",
                "field_count_without_custom_in_model_b",
                "custom_field_count_in_model_a",
                "custom_field_count_in_model_b",
                "available_field_count_in_model_a",
                "available_field_count_in_model_b",
                "dropped_field_count_in_model_a",
                "dropped_field_count_in_model_b",
            ]
        )

    for c in ["database", "dataset_id", "schemaName", "model", "table_id", "table_name"]:
        df[c] = df[c].fillna("").astype(str)
    df["_table_name_key"] = df["table_name"].apply(normalize_table_name)
    df = df[df["_table_name_key"] != ""]

    models = sorted(df["model"].dropna().unique().tolist())
    if len(models) != 2:
        raise ValueError(f"FIELD_COUNT_SUMMARY requires exactly 2 models; found: {models}")
    m1, m2 = models[0], models[1]

    table_lookup = (
        df.groupby(key_cols, dropna=False)
        .agg(
            database=("database", lambda s: next((x for x in s if x), "")),
            dataset_id=("dataset_id", lambda s: next((x for x in s if x), "")),
            schemaName=("schemaName", lambda s: next((x for x in s if x), "")),
            table_name=("table_name", lambda s: next((x for x in s if x), "")),
            table_id=("table_id", lambda s: next((x for x in s if x), "")),
        )
        .reset_index()
    )

    def build_metric_pivot(metric_name: str) -> pd.DataFrame:
        pivot = (
            df.pivot_table(index=key_cols, columns="model", values=metric_name, aggfunc="first")
            .reset_index()
        )
        pivot.columns = [str(c) for c in pivot.columns]
        if m1 not in pivot.columns:
            pivot[m1] = 0
        if m2 not in pivot.columns:
            pivot[m2] = 0
        return pivot.rename(
            columns={
                m1: f"{metric_name}_in_{m1}",
                m2: f"{metric_name}_in_{m2}",
            }
        )

    out = table_lookup.copy()
    for metric_name in [
        "total_field_count",
        "field_count_without_custom",
        "custom_field_count",
        "available_field_count",
        "dropped_field_count",
    ]:
        out = out.merge(build_metric_pivot(metric_name), on=key_cols, how="left")

    out[f"total_field_count_diff_{m2}_minus_{m1}"] = (
        out[f"total_field_count_in_{m2}"] - out[f"total_field_count_in_{m1}"]
    )

    return out.sort_values(["database", "schemaName", "table_name"]).reset_index(drop=True)


def build_column_summary_by_names(metadata: pd.DataFrame) -> pd.DataFrame:
    """Per logical table, compare column sets using normalized table and column names."""
    key_cols = logical_table_key_cols()
    df = metadata.copy()
    df = df[df["table_name"].notna() & df["column_name"].notna()]

    for c in ["database", "dataset_id", "schemaName", "model", "table_id", "table_name", "column_name"]:
        df[c] = df[c].fillna("").astype(str)

    df["_table_name_key"] = df["table_name"].apply(normalize_table_name)
    df["_col_name_key"] = df["column_name"].apply(normalize_column_name)
    df = df[(df["_table_name_key"] != "") & (df["_col_name_key"] != "")]

    models = sorted(df["model"].dropna().unique().tolist())
    if len(models) != 2:
        raise ValueError(f"COLUMN_SUMMARY requires exactly 2 models; found: {models}")
    m1, m2 = models[0], models[1]

    # Set of normalized column names per table per model
    sets = (
        df.groupby(key_cols + ["model"], dropna=False)["_col_name_key"]
        .agg(lambda s: set(s.tolist()))
        .reset_index(name="col_set")
    )

    pivot = sets.pivot_table(index=key_cols, columns="model", values="col_set", aggfunc="first").reset_index()
    pivot.columns = [str(c) for c in pivot.columns]

    # Carry representative table labels for readability
    table_lookup = (
        df.groupby(key_cols, dropna=False)
        .agg(
            database=("database", lambda s: next((x for x in s if x), "")),
            dataset_id=("dataset_id", lambda s: next((x for x in s if x), "")),
            schemaName=("schemaName", lambda s: next((x for x in s if x), "")),
            table_name=("table_name", lambda s: next((x for x in s if x), "")),
            table_id=("table_id", lambda s: next((x for x in s if x), "")),
        )
        .reset_index()
    )
    pivot = pivot.merge(table_lookup, on=key_cols, how="left")

    def _as_set(v: Any) -> set:
        return v if isinstance(v, set) else set()

    out = pivot[key_cols + ["database", "dataset_id", "schemaName", "table_name", "table_id"]].copy()
    out[f"column_count_in_{m1}"] = 0
    out[f"column_count_in_{m2}"] = 0
    out[f"column_count_diff_{m2}_minus_{m1}"] = 0

    for i, r in pivot.iterrows():
        s1 = _as_set(r.get(m1))
        s2 = _as_set(r.get(m2))

        out.loc[i, f"column_count_in_{m1}"] = len(s1)
        out.loc[i, f"column_count_in_{m2}"] = len(s2)
        out.loc[i, f"column_count_diff_{m2}_minus_{m1}"] = len(s2) - len(s1)

    out = out.drop(columns=["_table_name_key"])
    return out.sort_values(["database", "schemaName", "table_name"]).reset_index(drop=True)


def merge_field_counts_into_column_summary(
    column_summary: pd.DataFrame,
    field_count_summary: pd.DataFrame,
    model_a_name: str,
    model_b_name: str,
) -> pd.DataFrame:
    if column_summary.empty or field_count_summary.empty:
        return column_summary

    left = column_summary.copy()
    right = field_count_summary.copy()
    left["_table_name_key"] = left["table_name"].apply(normalize_table_name)
    right["_table_name_key"] = right["table_name"].apply(normalize_table_name)

    extra_columns = [
        "_table_name_key",
        f"total_field_count_in_{model_a_name}",
        f"total_field_count_in_{model_b_name}",
        f"total_field_count_diff_{model_b_name}_minus_{model_a_name}",
        f"field_count_without_custom_in_{model_a_name}",
        f"field_count_without_custom_in_{model_b_name}",
        f"custom_field_count_in_{model_a_name}",
        f"custom_field_count_in_{model_b_name}",
        f"available_field_count_in_{model_a_name}",
        f"available_field_count_in_{model_b_name}",
        f"dropped_field_count_in_{model_a_name}",
        f"dropped_field_count_in_{model_b_name}",
    ]
    merged = left.merge(right[extra_columns], on="_table_name_key", how="left")

    merged[f"column_count_in_{model_a_name}"] = merged[f"total_field_count_in_{model_a_name}"].fillna(
        merged[f"column_count_in_{model_a_name}"]
    )
    merged[f"column_count_in_{model_b_name}"] = merged[f"total_field_count_in_{model_b_name}"].fillna(
        merged[f"column_count_in_{model_b_name}"]
    )
    merged[f"column_count_diff_{model_b_name}_minus_{model_a_name}"] = merged[
        f"total_field_count_diff_{model_b_name}_minus_{model_a_name}"
    ].fillna(merged[f"column_count_diff_{model_b_name}_minus_{model_a_name}"])

    return merged.drop(columns=["_table_name_key"])


def table_level_df(metadata: pd.DataFrame) -> pd.DataFrame:
    """Unique table rows per logical table name with table-level metadata and normalized 'table_query'."""
    df = metadata.copy()
    df = df[df["table_name"].notna()]

    for c in [
        "model",
        "database",
        "dataset_id",
        "schemaName",
        "table_name",
        "table_type",
        "table_expression",
        "table_importQuery",
    ]:
        if c not in df.columns:
            df[c] = ""
        df[c] = df[c].fillna("").astype(str)

    df["_table_name_key"] = df["table_name"].apply(normalize_table_name)
    df = df[df["_table_name_key"] != ""]

    def _first_nonempty(series):
        for x in series:
            if isinstance(x, str) and x.strip() != "":
                return x
        return ""

    grouped = (
        df.groupby(["model", "_table_name_key"], dropna=False)
        .agg(
            database=("database", _first_nonempty),
            dataset_id=("dataset_id", _first_nonempty),
            schemaName=("schemaName", _first_nonempty),
            table_id=("table_id", _first_nonempty),
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
    Per-table comparison of query text for matching logical table names across the two models.
    Produces one row per logical table name (union across the two models for the filtered table types).
    """
    df = tables.copy()

    for c in ["model", "database", "dataset_id", "schemaName", "table_id", "table_name", "table_type", "table_expression", "table_query"]:
        if c not in df.columns:
            df[c] = ""
        df[c] = df[c].fillna("").astype(str)

    df = df[df["table_type"].isin(type_values)]
    if require_expression:
        df = df[df["table_query"].str.strip() != ""]

    df["_table_name_key"] = df["table_name"].apply(normalize_table_name)
    df = df[df["_table_name_key"] != ""]

    a_df = df[df["model"] == model_a][
        ["database", "dataset_id", "schemaName", "_table_name_key", "table_id", "table_name", "table_query"]
    ].rename(
        columns={"table_name": f"table_name_in_{model_a}", "table_query": f"table_query_in_{model_a}"}
    )

    b_df = df[df["model"] == model_b][
        ["database", "dataset_id", "schemaName", "_table_name_key", "table_id", "table_name", "table_query"]
    ].rename(
        columns={"table_name": f"table_name_in_{model_b}", "table_query": f"table_query_in_{model_b}"}
    )

    merged = a_df.merge(b_df, on=["_table_name_key"], how="outer", suffixes=("_a", "_b"))

    merged["database"] = merged["database_a"].where(merged["database_a"].fillna("").str.strip() != "", merged["database_b"])
    merged["dataset_id"] = merged["dataset_id_a"].where(merged["dataset_id_a"].str.strip() != "", merged["dataset_id_b"])
    merged["schemaName"] = merged["schemaName_a"].where(merged["schemaName_a"].fillna("").str.strip() != "", merged["schemaName_b"])
    merged["table_id"] = merged["table_id_a"].where(merged["table_id_a"].str.strip() != "", merged["table_id_b"])

    merged["table_name"] = merged[f"table_name_in_{model_a}"].where(
        merged[f"table_name_in_{model_a}"].fillna("").str.strip() != "",
        merged.get(f"table_name_in_{model_b}", ""),
    )

    qa = merged.get(f"table_query_in_{model_a}", "").fillna("").astype(str).str.strip()
    qb = merged.get(f"table_query_in_{model_b}", "").fillna("").astype(str).str.strip()
    merged["is_different"] = qa != qb

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
    Per-table summary: for each logical table, count (and list) columns where the given attribute differs
    for the same logical column across the two models.
    Output rows include: representative database, dataset_id, schemaName, table_name, table_id.
    """
    df = metadata.copy()
    df = df[df["column_name"].notna() & df["table_name"].notna()]

    for c in [
        "model",
        "database",
        "dataset_id",
        "schemaName",
        "table_id",
        "table_name",
        "column_id",
        "column_name",
        "column_origin",
        "originalDataTypeGroup",
        attr,
    ]:
        if c not in df.columns:
            df[c] = ""
        df[c] = df[c].fillna("").astype(str)

    df["_table_name_key"] = df["table_name"].apply(normalize_table_name)
    df["_column_name_key"] = df["column_name"].apply(normalize_column_name)
    df = df[(df["_table_name_key"] != "") & (df["_column_name_key"] != "")]

    key = ["_table_name_key", "_column_name_key"]

    a = df[df["model"] == model_a].groupby(key, dropna=False).agg(
        database=("database", lambda s: next((x for x in s if x), "")),
        dataset_id=("dataset_id", lambda s: next((x for x in s if x), "")),
        schemaName=("schemaName", lambda s: next((x for x in s if x), "")),
        table_id=("table_id", lambda s: next((x for x in s if x), "")),
        table_name=("table_name", lambda s: next((x for x in s if x), "")),
        column_id=("column_id", lambda s: next((x for x in s if x), "")),
        col_name_a=("column_name", lambda s: next((x for x in s if x), "")),
        val_a=(attr, lambda s: next((x for x in s if x != ""), "")),
    ).reset_index()

    b = df[df["model"] == model_b].groupby(key, dropna=False).agg(
        database_b=("database", lambda s: next((x for x in s if x), "")),
        dataset_id_b=("dataset_id", lambda s: next((x for x in s if x), "")),
        schemaName_b=("schemaName", lambda s: next((x for x in s if x), "")),
        table_id_b=("table_id", lambda s: next((x for x in s if x), "")),
        table_name_b=("table_name", lambda s: next((x for x in s if x), "")),
        column_id_b=("column_id", lambda s: next((x for x in s if x), "")),
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

        df["_attr_norm"] = df[attr].apply(_norm_hidden)
        merged["val_a_norm"] = merged["val_a"].apply(_norm_hidden)
        merged["val_b_norm"] = merged["val_b"].apply(_norm_hidden)
    elif attr == "dataTypeGroup":
        def _normalized_datatype_for_compare(row: pd.Series) -> str:
            # Ignore physical-column datatype casts when the underlying source type is unchanged.
            original_group = str(row.get("originalDataTypeGroup") or "").strip().lower()
            effective_group = str(row.get(attr) or "").strip().lower()
            column_origin = str(row.get("column_origin") or "").strip().lower()
            return original_group if column_origin == "physical" and original_group else effective_group

        df["_attr_norm"] = df.apply(_normalized_datatype_for_compare, axis=1)
        attr_sets_a = (
            df[df["model"] == model_a]
            .groupby(key, dropna=False)["_attr_norm"]
            .agg(lambda s: sorted({value for value in s if value != ""}))
            .reset_index(name="val_a_set")
        )
        attr_sets_b = (
            df[df["model"] == model_b]
            .groupby(key, dropna=False)["_attr_norm"]
            .agg(lambda s: sorted({value for value in s if value != ""}))
            .reset_index(name="val_b_set")
        )
        merged = merged.merge(attr_sets_a, on=key, how="left").merge(attr_sets_b, on=key, how="left")
        merged["val_a_set"] = merged["val_a_set"].apply(lambda value: value if isinstance(value, list) else [])
        merged["val_b_set"] = merged["val_b_set"].apply(lambda value: value if isinstance(value, list) else [])
        merged["val_a_norm"] = merged["val_a_set"].apply(lambda value: "|".join(value))
        merged["val_b_norm"] = merged["val_b_set"].apply(lambda value: "|".join(value))
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

    per_table = diff.groupby(["_table_name_key"], dropna=False).agg(
        database=("database", _first_nonempty),
        dataset_id=("dataset_id", _first_nonempty),
        schemaName=("schemaName", _first_nonempty),
        table_id=("table_id", _first_nonempty),
        table_name=("table_name", _first_nonempty),
        diff_count=("_column_name_key", "size"),
        column_ids=("column_id", list),
        column_names_in_model_a=("col_name_a", list),
        column_names_in_model_b=("col_name_b", list),
    ).reset_index()

    if attr == "hidden":
        hidden_totals_a = (
            df[df["model"] == model_a]
            .groupby(["_table_name_key"], dropna=False)
            .agg(
                database=("database", _first_nonempty),
                dataset_id=("dataset_id", _first_nonempty),
                schemaName=("schemaName", _first_nonempty),
                table_id=("table_id", _first_nonempty),
                table_name=("table_name", _first_nonempty),
                hidden_total_in_model_a=("_attr_norm", lambda s: sum(value == "true" for value in s)),
            )
            .reset_index()
        )
        hidden_sets_a = (
            df[(df["model"] == model_a) & (df["_attr_norm"] == "true")]
            .groupby(["_table_name_key"], dropna=False)
            .agg(hidden_names_in_model_a=("column_name", lambda s: sorted({str(value) for value in s if str(value).strip() != ""})))
            .reset_index()
        )
        hidden_totals_b = (
            df[df["model"] == model_b]
            .groupby(["_table_name_key"], dropna=False)
            .agg(
                database_b=("database", _first_nonempty),
                dataset_id_b=("dataset_id", _first_nonempty),
                schemaName_b=("schemaName", _first_nonempty),
                table_id_b=("table_id", _first_nonempty),
                table_name_b=("table_name", _first_nonempty),
                hidden_total_in_model_b=("_attr_norm", lambda s: sum(value == "true" for value in s)),
            )
            .reset_index()
        )
        hidden_sets_b = (
            df[(df["model"] == model_b) & (df["_attr_norm"] == "true")]
            .groupby(["_table_name_key"], dropna=False)
            .agg(hidden_names_in_model_b=("column_name", lambda s: sorted({str(value) for value in s if str(value).strip() != ""})))
            .reset_index()
        )
        hidden_totals = hidden_totals_a.merge(
            hidden_totals_b,
            on=["_table_name_key"],
            how="outer",
        )
        hidden_totals = hidden_totals.merge(hidden_sets_a, on=["_table_name_key"], how="left")
        hidden_totals = hidden_totals.merge(hidden_sets_b, on=["_table_name_key"], how="left")
        hidden_totals["database"] = hidden_totals["database"].where(
            hidden_totals.get("database", "").fillna("").astype(str).str.strip() != "",
            hidden_totals.get("database_b", ""),
        )
        hidden_totals["dataset_id"] = hidden_totals["dataset_id"].where(
            hidden_totals.get("dataset_id", "").fillna("").astype(str).str.strip() != "",
            hidden_totals.get("dataset_id_b", ""),
        )
        hidden_totals["schemaName"] = hidden_totals["schemaName"].where(
            hidden_totals.get("schemaName", "").fillna("").astype(str).str.strip() != "",
            hidden_totals.get("schemaName_b", ""),
        )
        hidden_totals["table_id"] = hidden_totals["table_id"].where(
            hidden_totals.get("table_id", "").fillna("").astype(str).str.strip() != "",
            hidden_totals.get("table_id_b", ""),
        )
        hidden_totals["table_name"] = hidden_totals["table_name"].where(
            hidden_totals.get("table_name", "").fillna("").astype(str).str.strip() != "",
            hidden_totals.get("table_name_b", ""),
        )
        hidden_totals["hidden_total_in_model_a"] = hidden_totals["hidden_total_in_model_a"].fillna(0).astype(int)
        hidden_totals["hidden_total_in_model_b"] = hidden_totals["hidden_total_in_model_b"].fillna(0).astype(int)
        hidden_totals[f"hidden_total_diff_{model_b}_minus_{model_a}"] = (
            hidden_totals["hidden_total_in_model_b"] - hidden_totals["hidden_total_in_model_a"]
        )
        hidden_totals["hidden_names_in_model_a"] = hidden_totals["hidden_names_in_model_a"].apply(
            lambda value: value if isinstance(value, list) else []
        )
        hidden_totals["hidden_names_in_model_b"] = hidden_totals["hidden_names_in_model_b"].apply(
            lambda value: value if isinstance(value, list) else []
        )
        hidden_totals["hidden_only_in_model_a"] = hidden_totals.apply(
            lambda row: sorted(set(row["hidden_names_in_model_a"]) - set(row["hidden_names_in_model_b"])),
            axis=1,
        )
        hidden_totals["hidden_only_in_model_b"] = hidden_totals.apply(
            lambda row: sorted(set(row["hidden_names_in_model_b"]) - set(row["hidden_names_in_model_a"])),
            axis=1,
        )
        hidden_totals["hidden_diff_count"] = hidden_totals.apply(
            lambda row: len(row["hidden_only_in_model_a"]) + len(row["hidden_only_in_model_b"]),
            axis=1,
        )
        hidden_totals["database_hidden"] = hidden_totals["database"].where(
            hidden_totals["database"].fillna("").astype(str).str.strip() != "",
            hidden_totals.get("database_b", ""),
        )
        hidden_totals["dataset_id_hidden"] = hidden_totals["dataset_id"].where(
            hidden_totals["dataset_id"].fillna("").astype(str).str.strip() != "",
            hidden_totals.get("dataset_id_b", ""),
        )
        hidden_totals["schemaName_hidden"] = hidden_totals["schemaName"].where(
            hidden_totals["schemaName"].fillna("").astype(str).str.strip() != "",
            hidden_totals.get("schemaName_b", ""),
        )
        hidden_totals["table_id_hidden"] = hidden_totals["table_id"].where(
            hidden_totals["table_id"].fillna("").astype(str).str.strip() != "",
            hidden_totals.get("table_id_b", ""),
        )
        hidden_totals["table_name_hidden"] = hidden_totals["table_name"].where(
            hidden_totals["table_name"].fillna("").astype(str).str.strip() != "",
            hidden_totals.get("table_name_b", ""),
        )
        per_table = per_table.merge(
            hidden_totals[
                [
                    "_table_name_key",
                    "database_hidden",
                    "dataset_id_hidden",
                    "schemaName_hidden",
                    "table_id_hidden",
                    "table_name_hidden",
                    "hidden_total_in_model_a",
                    "hidden_total_in_model_b",
                    f"hidden_total_diff_{model_b}_minus_{model_a}",
                    "hidden_diff_count",
                    "hidden_only_in_model_a",
                    "hidden_only_in_model_b",
                ]
            ],
            on=["_table_name_key"],
            how="outer",
        )
        metadata_fallbacks = {
            "database": "database_hidden",
            "dataset_id": "dataset_id_hidden",
            "schemaName": "schemaName_hidden",
            "table_id": "table_id_hidden",
            "table_name": "table_name_hidden",
        }
        for column, fallback in metadata_fallbacks.items():
            if column not in per_table.columns:
                per_table[column] = ""
            if fallback in per_table.columns:
                per_table[column] = per_table[column].where(
                    per_table[column].fillna("").astype(str).str.strip() != "",
                    per_table[fallback],
                )
                per_table = per_table.drop(columns=[fallback])
            per_table[column] = per_table[column].fillna("")
        if "hidden_diff_count" in per_table.columns:
            per_table["diff_count"] = per_table["hidden_diff_count"].fillna(per_table["diff_count"]).fillna(0).astype(int)
        if "hidden_only_in_model_a" in per_table.columns:
            per_table["column_names_in_model_a"] = per_table["hidden_only_in_model_a"].where(
                per_table["hidden_only_in_model_a"].apply(lambda value: isinstance(value, list)),
                per_table["column_names_in_model_a"],
            )
        if "hidden_only_in_model_b" in per_table.columns:
            per_table["column_names_in_model_b"] = per_table["hidden_only_in_model_b"].where(
                per_table["hidden_only_in_model_b"].apply(lambda value: isinstance(value, list)),
                per_table["column_names_in_model_b"],
            )
        for c in ["hidden_total_in_model_a", "hidden_total_in_model_b", f"hidden_total_diff_{model_b}_minus_{model_a}"]:
            if c not in per_table.columns:
                per_table[c] = 0
            per_table[c] = per_table[c].fillna(0).astype(int)
        per_table["column_ids"] = per_table.get("column_ids", pd.Series(dtype=object)).apply(
            lambda value: value if isinstance(value, list) else []
        )
        per_table["column_names_in_model_a"] = per_table.get("column_names_in_model_a", pd.Series(dtype=object)).apply(
            lambda value: value if isinstance(value, list) else []
        )
        per_table["column_names_in_model_b"] = per_table.get("column_names_in_model_b", pd.Series(dtype=object)).apply(
            lambda value: value if isinstance(value, list) else []
        )

    # Rename columns to keep the tab consistent with previous expectation
    per_table = per_table.rename(
        columns={
            "diff_count": f"diff_count_in_{model_a}_and_{model_b}",
        }
    )
    diff_count_col = f"diff_count_in_{model_a}_and_{model_b}"
    if diff_count_col not in per_table.columns:
        per_table[diff_count_col] = 0
    per_table[diff_count_col] = per_table[diff_count_col].fillna(0).astype(int)

    out_cols = [
        "database",
        "dataset_id",
        "schemaName",
        "table_name",
        "table_id",
        diff_count_col,
        "column_ids",
        "column_names_in_model_a",
        "column_names_in_model_b",
    ]
    if attr == "hidden":
        out_cols.extend([
            "hidden_total_in_model_a",
            "hidden_total_in_model_b",
            f"hidden_total_diff_{model_b}_minus_{model_a}",
        ])

    for c in out_cols:
        if c not in per_table.columns:
            per_table[c] = 0 if "total" in c or c.startswith("diff_count_") else ""

    return per_table[out_cols].sort_values(["database", "schemaName", "table_name"]).reset_index(drop=True)


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

        for t in get_dataset_tables(ds):
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
    Per logical table, compare join counts between the two source files.
    Join count per table = appearances of a table in join rows (left OR right side).
    Output rows include representative database, dataset_id, schemaName, table_name, table_id.
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
        f"relation_groups_in_{model_a_label}",
        f"relation_groups_in_{model_b_label}",
        f"relation_group_diff_{model_b_label}_minus_{model_a_label}",
    ]
    if joins_df.empty:
        return pd.DataFrame(columns=cols)

    # Normalize occurrences from left and right sides
    left_occ = joins_df[
        ["source_file", "relation_oid", "left_database", "left_dataset_oid", "left_schema", "left_table_id", "left_table"]
    ].copy()
    left_occ.columns = ["source_file", "relation_oid", "database", "dataset_id", "schemaName", "table_id", "table_name"]

    right_occ = joins_df[
        ["source_file", "relation_oid", "right_database", "right_dataset_oid", "right_schema", "right_table_id", "right_table"]
    ].copy()
    right_occ.columns = ["source_file", "relation_oid", "database", "dataset_id", "schemaName", "table_id", "table_name"]

    occ = pd.concat([left_occ, right_occ], ignore_index=True)
    for c in ["database", "dataset_id", "schemaName", "table_id", "table_name"]:
        occ[c] = occ[c].fillna("").astype(str)
    occ["_table_name_key"] = occ["table_name"].apply(normalize_table_name)
    occ = occ[occ["_table_name_key"] != ""]

    # Count join appearances per table per source file
    counts = (
        occ.groupby(["source_file", "_table_name_key"], dropna=False)
        .agg(
            join_count=("table_id", "size"),
            database=("database", lambda s: next((x for x in s if pd.notna(x) and str(x).strip() != ""), "")),
            dataset_id=("dataset_id", lambda s: next((x for x in s if pd.notna(x) and str(x).strip() != ""), "")),
            schemaName=("schemaName", lambda s: next((x for x in s if pd.notna(x) and str(x).strip() != ""), "")),
            table_id=("table_id", lambda s: next((x for x in s if pd.notna(x) and str(x).strip() != ""), "")),
            table_name=("table_name", lambda s: next((x for x in s if pd.notna(x) and str(x).strip() != ""), "")),
        )
        .reset_index()
    )

    group_counts = (
        occ.drop_duplicates(["source_file", "_table_name_key", "table_name", "database", "dataset_id", "schemaName", "table_id", "relation_oid"])
        .groupby(["source_file", "_table_name_key"], dropna=False)
        .agg(relation_group_count=("relation_oid", "size"))
        .reset_index()
    )

    pivot = (
        counts.pivot_table(
            index=["_table_name_key", "table_name"],
            columns="source_file",
            values="join_count",
            aggfunc="sum",
            fill_value=0,
        )
        .reset_index()
    )
    group_pivot = (
        group_counts.pivot_table(
            index=["_table_name_key"],
            columns="source_file",
            values="relation_group_count",
            aggfunc="sum",
            fill_value=0,
        )
        .reset_index()
    )
    group_pivot.columns = [str(c) for c in group_pivot.columns]

    meta_lookup = (
        counts.groupby(["_table_name_key", "table_name"], dropna=False)
        .agg(
            database=("database", lambda s: next((x for x in s if pd.notna(x) and str(x).strip() != ""), "")),
            dataset_id=("dataset_id", lambda s: next((x for x in s if pd.notna(x) and str(x).strip() != ""), "")),
            schemaName=("schemaName", lambda s: next((x for x in s if pd.notna(x) and str(x).strip() != ""), "")),
            table_id=("table_id", lambda s: next((x for x in s if pd.notna(x) and str(x).strip() != ""), "")),
        )
        .reset_index()
    )
    pivot = pivot.merge(meta_lookup, on=["_table_name_key", "table_name"], how="left")
    pivot = pivot.merge(group_pivot, on=["_table_name_key"], how="left", suffixes=("", "_group"))

    for col in [model_a_label, model_b_label]:
        if col not in pivot.columns:
            pivot[col] = 0
    for col in [model_a_label, model_b_label]:
        group_col = f"{col}_group"
        if group_col not in pivot.columns:
            pivot[group_col] = 0

    pivot = pivot[
        [
            "database",
            "dataset_id",
            "schemaName",
            "table_name",
            "table_id",
            model_a_label,
            model_b_label,
            f"{model_a_label}_group",
            f"{model_b_label}_group",
        ]
    ]
    pivot[f"diff_{model_b_label}_minus_{model_a_label}"] = pivot[model_b_label] - pivot[model_a_label]
    pivot = pivot.rename(
        columns={
            f"{model_a_label}_group": f"relation_groups_in_{model_a_label}",
            f"{model_b_label}_group": f"relation_groups_in_{model_b_label}",
        }
    )
    pivot[f"relation_group_diff_{model_b_label}_minus_{model_a_label}"] = (
        pivot[f"relation_groups_in_{model_b_label}"] - pivot[f"relation_groups_in_{model_a_label}"]
    )

    return pivot.sort_values(["database", "schemaName", "table_name"]).reset_index(drop=True)


# -----------------------------
# Main / Excel output
# -----------------------------
def main() -> None:
    ap = argparse.ArgumentParser(description="Create a combined Sisense .smodel metadata+join comparison workbook.")
    ap.add_argument("model_a", type=Path, help="Path to first .smodel file")
    ap.add_argument("model_b", type=Path, help="Path to second .smodel file")
    ap.add_argument("--out", type=Path, default=Path("combined_smodel_metadata_summary_v2.xlsx"), help="Output .xlsx path")
    ap.add_argument("--json-out", type=Path, default=None, help="Optional JSON output with all sheet data")
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
    field_inventory_a = extract_table_field_inventory(model_a, model_a_name)
    field_inventory_b = extract_table_field_inventory(model_b, model_b_name)
    field_inventory_all = pd.concat([field_inventory_a, field_inventory_b], ignore_index=True)

    joins_a = extract_joins(model_a, source_file=model_a_label)
    joins_b = extract_joins(model_b, source_file=model_b_label)
    joins_all = pd.concat([joins_a, joins_b], ignore_index=True)

    # Existing summaries (updated COLUMN_SUMMARY identity)
    column_summary = build_column_summary_by_names(metadata_all)
    field_count_summary = build_field_count_summary(field_inventory_all)
    column_summary = merge_field_counts_into_column_summary(
        column_summary,
        field_count_summary,
        model_a_name,
        model_b_name,
    )
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
        attr="dataTypeGroup",
        sheet_name="DATATYPES",
    )
    custom_fields = build_custom_field_summary(metadata_all)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(args.out, engine="openpyxl") as writer:
        metadata_all.to_excel(writer, sheet_name="METADATA", index=False)
        joins_all.to_excel(writer, sheet_name="JOINS_METADATA", index=False)
        column_summary.to_excel(writer, sheet_name="COLUMN_SUMMARY", index=False)
        join_summary.to_excel(writer, sheet_name="JOIN_SUMMARY", index=False)
        table_queries.to_excel(writer, sheet_name="TABLE_QUERIES", index=False)
        custom_tables.to_excel(writer, sheet_name="CUSTOM_TABLES", index=False)
        custom_fields.to_excel(writer, sheet_name="CUSTOM_FIELDS", index=False)
        hidden_columns.to_excel(writer, sheet_name="HIDDEN_COLUMNS", index=False)
        datatypes.to_excel(writer, sheet_name="DATATYPES", index=False)

    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "model_a_label": model_a_label,
            "model_b_label": model_b_label,
            "model_a_name": model_a_name,
            "model_b_name": model_b_name,
            "sheets": {
                "METADATA": df_records(metadata_all),
                "JOINS_METADATA": df_records(joins_all),
                "COLUMN_SUMMARY": df_records(column_summary),
                "JOIN_SUMMARY": df_records(join_summary),
                "TABLE_QUERIES": df_records(table_queries),
                "CUSTOM_TABLES": df_records(custom_tables),
                "CUSTOM_FIELDS": df_records(custom_fields),
                "HIDDEN_COLUMNS": df_records(hidden_columns),
                "DATATYPES": df_records(datatypes),
            },
        }
        args.json_out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    print(f"Output workbook: {args.out}")
    print(f"METADATA rows: {len(metadata_all):,}")
    print(f"JOINS rows: {len(joins_all):,}")
    print(f"COLUMN_SUMMARY rows: {len(column_summary):,}")
    print(f"JOIN_SUMMARY rows: {len(join_summary):,}")
    print(f"TABLE_QUERIES rows: {len(table_queries):,}")
    print(f"CUSTOM_TABLES rows: {len(custom_tables):,}")
    print(f"CUSTOM_FIELDS rows: {len(custom_fields):,}")
    print(f"HIDDEN_COLUMNS rows: {len(hidden_columns):,}")
    print(f"DATATYPES rows: {len(datatypes):,}")


if __name__ == "__main__":
    main()
