#!/usr/bin/env python3

from __future__ import annotations

import csv
import json
import math
import os
import posixpath
import re
import sys
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any
from xml.etree import ElementTree as ET


NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "rel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "pkgrel": "http://schemas.openxmlformats.org/package/2006/relationships",
}

NUMERIC_PATTERN = re.compile(r"^[+-]?(?:\d+\.?\d*|\.\d+)$")
NULL_TOKENS = {
    "",
    "-",
    "na",
    "n/a",
    "null",
    "none",
    "nil",
    '""',
    "''",
    "/",
    "\\",
}
VOWELS = set("aeiou")


def normalize_header(value: str) -> str:
    return " ".join(value.strip().lower().split())


def try_parse_decimal(value: str) -> Decimal | None:
    cleaned = value.strip().replace(",", "")
    if not cleaned or not NUMERIC_PATTERN.fullmatch(cleaned):
        return None
    try:
        return Decimal(cleaned)
    except (InvalidOperation, ValueError):
        return None


def decimal_to_text(value: Decimal) -> str:
    if value == value.to_integral():
        return str(int(value))
    text = format(value.normalize(), "f")
    return text.rstrip("0").rstrip(".")


def is_excel_serial_day_match(left_value: str, right_value: str) -> bool:
    left_decimal = try_parse_decimal(left_value)
    right_decimal = try_parse_decimal(right_value)
    if left_decimal is None or right_decimal is None:
        return False

    left_day = int(left_decimal)
    right_day = int(right_decimal)
    if left_day != right_day or left_day < 20000:
        return False

    return left_decimal != left_decimal.to_integral() or right_decimal != right_decimal.to_integral()


def is_null_like(text: str) -> bool:
    token = text.strip().casefold()
    if token in NULL_TOKENS:
        return True
    without_quotes = token.replace('"', "").replace("'", "").strip()
    if without_quotes == "":
        return True
    return token.replace(".", "") in {"na", "n/a", "null", "none"}


def normalize_numeric_text(text: str) -> str | None:
    parsed_decimal = try_parse_decimal(text)
    if parsed_decimal is None:
        return None
    if parsed_decimal != parsed_decimal.to_integral() and int(parsed_decimal) >= 20000:
        return str(int(parsed_decimal))
    return decimal_to_text(parsed_decimal)


def name_mask_signature(text: str) -> str | None:
    tokens = re.findall(r"[a-z]+", text.casefold())
    if len(tokens) != 2:
        return None
    masked_tokens = [
        "".join("x" if char in VOWELS else char for char in token)
        for token in tokens
    ]
    masked_tokens.sort()
    return " ".join(masked_tokens)


def are_cells_equivalent(
    left_value: Any,
    right_value: Any,
    trim_whitespace: bool,
    ignore_case: bool,
) -> bool:
    left_text = normalize_cell(left_value, trim_whitespace, ignore_case)
    right_text = normalize_cell(right_value, trim_whitespace, ignore_case)
    if left_text == right_text:
        return True
    if is_excel_serial_day_match(left_text, right_text):
        return True

    left_name = name_mask_signature(left_text)
    right_name = name_mask_signature(right_text)
    if left_name and right_name and left_name == right_name:
        return True

    return False


def normalize_cell(value: Any, trim_whitespace: bool, ignore_case: bool) -> str:
    text = "" if value is None else str(value)
    if trim_whitespace:
        text = " ".join(text.split())
    else:
        text = text.strip("\n\r")
    if ignore_case:
        text = text.casefold()
    if is_null_like(text):
        return "__null__"
    numeric_text = normalize_numeric_text(text)
    if numeric_text is not None:
        return numeric_text
    masked_name = name_mask_signature(text)
    if masked_name is not None:
        return f"__name__:{masked_name}"
    return text


def column_letters_to_index(reference: str) -> int:
    letters = []
    for char in reference:
        if char.isalpha():
            letters.append(char.upper())
        else:
            break
    index = 0
    for char in letters:
        index = index * 26 + (ord(char) - 64)
    return max(index - 1, 0)


def sheet_path_from_target(target: str) -> str:
    clean = target.lstrip("/")
    if clean.startswith("xl/"):
        return clean
    return posixpath.normpath(posixpath.join("xl", clean))


def text_from_inline_string(cell: ET.Element) -> str:
    parts = []
    inline = cell.find("main:is", NS)
    if inline is None:
        return ""
    for text_node in inline.findall(".//main:t", NS):
        parts.append(text_node.text or "")
    return "".join(parts)


def parse_shared_strings(workbook: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in workbook.namelist():
        return []
    root = ET.fromstring(workbook.read("xl/sharedStrings.xml"))
    values: list[str] = []
    for item in root.findall("main:si", NS):
        parts = [node.text or "" for node in item.findall(".//main:t", NS)]
        values.append("".join(parts))
    return values


def parse_workbook(workbook: zipfile.ZipFile) -> list[tuple[str, str]]:
    rel_root = ET.fromstring(workbook.read("xl/_rels/workbook.xml.rels"))
    rel_map: dict[str, str] = {}
    for rel in rel_root.findall("pkgrel:Relationship", NS):
        rel_id = rel.attrib.get("Id")
        target = rel.attrib.get("Target")
        if rel_id and target:
            rel_map[rel_id] = target

    wb_root = ET.fromstring(workbook.read("xl/workbook.xml"))
    sheets: list[tuple[str, str]] = []
    for sheet in wb_root.findall("main:sheets/main:sheet", NS):
        name = sheet.attrib.get("name", "Sheet")
        rel_id = sheet.attrib.get(f"{{{NS['rel']}}}id")
        if not rel_id or rel_id not in rel_map:
            continue
        sheets.append((name, sheet_path_from_target(rel_map[rel_id])))
    return sheets


def parse_sheet_rows(workbook: zipfile.ZipFile, sheet_path: str, shared_strings: list[str]) -> list[list[str]]:
    root = ET.fromstring(workbook.read(sheet_path))
    rows: list[list[str]] = []

    for row in root.findall(".//main:sheetData/main:row", NS):
        values: list[str] = []
        for cell in row.findall("main:c", NS):
            reference = cell.attrib.get("r", "")
            index = column_letters_to_index(reference)
            while len(values) <= index:
                values.append("")

            cell_type = cell.attrib.get("t")
            if cell_type == "inlineStr":
                values[index] = text_from_inline_string(cell)
                continue

            raw = cell.findtext("main:v", default="", namespaces=NS)
            if cell_type == "s":
                try:
                    values[index] = shared_strings[int(raw)]
                except Exception:
                    values[index] = raw
            elif cell_type == "b":
                values[index] = "TRUE" if raw == "1" else "FALSE"
            else:
                values[index] = raw

        while values and values[-1] == "":
            values.pop()
        rows.append(values)

    return rows


def load_xlsx(path: str) -> dict[str, list[list[str]]]:
    with zipfile.ZipFile(path) as workbook:
        shared_strings = parse_shared_strings(workbook)
        sheets = parse_workbook(workbook)
        result: dict[str, list[list[str]]] = {}
        for name, sheet_path in sheets:
            result[name] = parse_sheet_rows(workbook, sheet_path, shared_strings)
        return result


def load_csv(path: str) -> dict[str, list[list[str]]]:
    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        return {os.path.basename(path): [list(row) for row in reader]}


def load_workbook(path: str) -> dict[str, list[list[str]]]:
    lower = path.lower()
    if lower.endswith(".csv"):
        return load_csv(path)
    if lower.endswith(".xlsx"):
        return load_xlsx(path)
    raise ValueError("Unsupported file type. Upload .xlsx or .csv files.")


def load_workbook_input(
    path: str | None = None,
    workbook_data: dict[str, list[list[str]]] | None = None,
) -> dict[str, list[list[str]]]:
    if workbook_data:
        return workbook_data
    if path:
        return load_workbook(path)
    raise ValueError("Workbook input is missing.")


def non_empty_count(row: list[str]) -> int:
    return sum(1 for cell in row if str(cell).strip())


def infer_header_row(rows: list[list[str]]) -> int:
    if not rows:
        return 1
    best_index = 0
    best_score = -1
    for index, row in enumerate(rows[:25]):
        non_empty = non_empty_count(row)
        if non_empty == 0:
            continue
        normalized = [normalize_header(cell) for cell in row if normalize_header(cell)]
        unique = len(set(normalized))
        score = non_empty * 3 + unique
        if score > best_score:
            best_score = score
            best_index = index
    return best_index + 1


def uniquify_headers(row: list[str]) -> list[str]:
    counts: dict[str, int] = {}
    headers: list[str] = []
    for index, raw in enumerate(row):
        base = str(raw).strip() or f"Column {index + 1}"
        count = counts.get(base, 0)
        counts[base] = count + 1
        headers.append(base if count == 0 else f"{base} ({count + 1})")
    return headers


def trim_row(row: list[str], length: int) -> list[str]:
    padded = list(row[:length])
    while len(padded) < length:
        padded.append("")
    return padded


@dataclass
class SheetTable:
    name: str
    header_row: int
    headers: list[str]
    rows: list[dict[str, Any]]
    sample_rows: list[list[str]]
    total_rows: int


def build_table(workbook: dict[str, list[list[str]]], sheet_name: str | None, header_row: int | None) -> SheetTable:
    if not workbook:
        raise ValueError("Workbook has no readable sheets.")

    selected_sheet = sheet_name if sheet_name in workbook else next(iter(workbook.keys()))
    rows = workbook[selected_sheet]
    resolved_header_row = header_row or infer_header_row(rows)
    header_index = max(resolved_header_row - 1, 0)
    raw_headers = rows[header_index] if header_index < len(rows) else []
    headers = uniquify_headers(raw_headers)
    width = max(len(headers), max((len(row) for row in rows), default=0))
    if len(headers) < width:
        headers = uniquify_headers(trim_row(headers, width))

    data_rows: list[dict[str, Any]] = []
    sample_rows: list[list[str]] = []

    for row_index in range(header_index + 1, len(rows)):
        normalized_row = trim_row(rows[row_index], len(headers))
        if not any(str(cell).strip() for cell in normalized_row):
            continue
        if len(sample_rows) < 5:
            sample_rows.append(normalized_row)
        data_rows.append(
            {
                "_rowNumber": row_index + 1,
                "values": {headers[idx]: normalized_row[idx] for idx in range(len(headers))},
            }
        )

    return SheetTable(
        name=selected_sheet,
        header_row=resolved_header_row,
        headers=headers,
        rows=data_rows,
        sample_rows=sample_rows,
        total_rows=len(data_rows),
    )


def workbook_summary(workbook: dict[str, list[list[str]]]) -> dict[str, Any]:
    summaries = []
    for sheet_name, rows in workbook.items():
        header_row = infer_header_row(rows)
        header_index = max(header_row - 1, 0)
        headers = uniquify_headers(rows[header_index] if header_index < len(rows) else [])
        width = max(len(headers), max((len(row) for row in rows), default=0))
        headers = uniquify_headers(trim_row(headers, width))
        sample_rows = []
        preview_rows = []
        for row in rows[header_index + 1 :]:
            normalized_row = trim_row(row, len(headers))
            if not any(str(cell).strip() for cell in normalized_row):
                continue
            preview_rows.append(normalized_row)
            if len(sample_rows) < 5:
                sample_rows.append(normalized_row)
        summaries.append(
            {
                "name": sheet_name,
                "inferredHeaderRow": header_row,
                "headers": headers,
                "rowCount": sum(1 for row in rows[header_index + 1 :] if any(str(cell).strip() for cell in row)),
                "columnCount": len(headers),
                "sampleRows": sample_rows,
                "previewRows": preview_rows,
            }
        )
    return {"sheets": summaries}


def resolve_mappings(left_headers: list[str], right_headers: list[str], requested: list[dict[str, str]]) -> list[dict[str, str]]:
    if requested:
        return [mapping for mapping in requested if mapping.get("left") in left_headers and mapping.get("right") in right_headers]

    right_lookup = {normalize_header(header): header for header in right_headers}
    auto = []
    for left in left_headers:
        right = right_lookup.get(normalize_header(left))
        if right:
            auto.append({"left": left, "right": right})
    return auto


def row_signature(
    row_values: dict[str, str],
    mappings: list[dict[str, str]],
    side: str,
    trim_whitespace: bool,
    ignore_case: bool,
) -> tuple[str, ...]:
    key = []
    for mapping in mappings:
        header = mapping[side]
        key.append(normalize_cell(row_values.get(header, ""), trim_whitespace, ignore_case))
    return tuple(key)


def row_match_score(
    left_row: dict[str, Any],
    right_row: dict[str, Any],
    mappings: list[dict[str, str]],
    trim_whitespace: bool,
    ignore_case: bool,
) -> int:
    score = 0
    for mapping in mappings:
        if are_cells_equivalent(
            left_row["values"].get(mapping["left"], ""),
            right_row["values"].get(mapping["right"], ""),
            trim_whitespace,
            ignore_case,
        ):
            score += 1
    return score


def mismatch_similarity_threshold(column_count: int) -> int:
    if column_count <= 1:
        return 1
    return max(1, int(math.ceil(column_count * 0.35)))


def filter_rows(rows: list[dict[str, Any]], mappings: list[dict[str, str]], side: str, ignore_empty_rows: bool) -> list[dict[str, Any]]:
    if not ignore_empty_rows:
        return rows
    filtered = []
    for row in rows:
        values = row["values"]
        if any(str(values.get(mapping[side], "")).strip() for mapping in mappings):
            filtered.append(row)
    return filtered


def compare_tables(payload: dict[str, Any]) -> dict[str, Any]:
    options = payload.get("options", {})
    trim_whitespace = bool(options.get("trimWhitespace", True))
    ignore_case = bool(options.get("ignoreCase", True))
    ignore_empty_rows = bool(options.get("ignoreEmptyRows", True))

    left_workbook = load_workbook_input(payload.get("leftPath"), payload.get("leftWorkbook"))
    right_workbook = load_workbook_input(payload.get("rightPath"), payload.get("rightWorkbook"))

    left_table = build_table(left_workbook, payload.get("leftSheet"), payload.get("leftHeaderRow"))
    right_table = build_table(right_workbook, payload.get("rightSheet"), payload.get("rightHeaderRow"))

    compare_mappings = resolve_mappings(left_table.headers, right_table.headers, payload.get("compareMappings", []))
    if not compare_mappings:
        raise ValueError("No comparable columns found. Add at least one column mapping.")

    key_mappings = resolve_mappings(left_table.headers, right_table.headers, payload.get("keyMappings", []))

    left_rows = filter_rows(left_table.rows, compare_mappings, "left", ignore_empty_rows)
    right_rows = filter_rows(right_table.rows, compare_mappings, "right", ignore_empty_rows)

    left_groups: dict[tuple[str, ...], list[dict[str, Any]]] = defaultdict(list)
    right_groups: dict[tuple[str, ...], list[dict[str, Any]]] = defaultdict(list)

    grouping_mappings = key_mappings if key_mappings else []

    if grouping_mappings:
        for row in left_rows:
            group_key = row_signature(row["values"], grouping_mappings, "left", trim_whitespace, ignore_case)
            left_groups[group_key].append(row)
        for row in right_rows:
            group_key = row_signature(row["values"], grouping_mappings, "right", trim_whitespace, ignore_case)
            right_groups[group_key].append(row)
    else:
        left_groups[tuple()] = left_rows
        right_groups[tuple()] = right_rows

    mismatch_rows = []
    comparison_rows = []
    left_only = 0
    right_only = 0
    matched = 0
    mismatched = 0

    for group_key in sorted(set(left_groups.keys()) | set(right_groups.keys())):
        left_bucket = left_groups.get(group_key, [])
        right_bucket = right_groups.get(group_key, [])

        left_counter: Counter[tuple[str, ...]] = Counter()
        right_counter: Counter[tuple[str, ...]] = Counter()
        left_example: dict[tuple[str, ...], dict[str, Any]] = {}
        right_example: dict[tuple[str, ...], dict[str, Any]] = {}

        for row in left_bucket:
            signature = row_signature(row["values"], compare_mappings, "left", trim_whitespace, ignore_case)
            left_counter[signature] += 1
            left_example.setdefault(signature, row)
        for row in right_bucket:
            signature = row_signature(row["values"], compare_mappings, "right", trim_whitespace, ignore_case)
            right_counter[signature] += 1
            right_example.setdefault(signature, row)

        for signature in set(left_counter.keys()) | set(right_counter.keys()):
            left_count = left_counter.get(signature, 0)
            right_count = right_counter.get(signature, 0)
            shared = min(left_count, right_count)
            matched += shared
            if shared > 0:
                left_row = left_example[signature]
                right_row = right_example[signature]
                for _ in range(shared):
                    comparison_rows.append(
                        {
                            "status": "MATCH",
                            "groupKey": list(group_key),
                            "leftRowNumber": left_row["_rowNumber"],
                            "rightRowNumber": right_row["_rowNumber"],
                            "leftValues": {
                                mapping["left"]: left_row["values"].get(mapping["left"], "")
                                for mapping in compare_mappings
                            },
                            "rightValues": {
                                mapping["right"]: right_row["values"].get(mapping["right"], "")
                                for mapping in compare_mappings
                            },
                        }
                    )
            if left_count > right_count:
                left_only += left_count - right_count
                left_row = left_example[signature]
                for _ in range(left_count - right_count):
                    row = {
                        "status": "ONLY_IN_LEFT",
                        "groupKey": list(group_key),
                        "leftRowNumber": left_row["_rowNumber"],
                        "rightRowNumber": None,
                        "leftValues": {
                            mapping["left"]: left_row["values"].get(mapping["left"], "")
                            for mapping in compare_mappings
                        },
                        "rightValues": {
                            mapping["right"]: ""
                            for mapping in compare_mappings
                        },
                    }
                    mismatch_rows.append(row)
                    comparison_rows.append(row)
            elif right_count > left_count:
                right_only += right_count - left_count
                right_row = right_example[signature]
                for _ in range(right_count - left_count):
                    row = {
                        "status": "ONLY_IN_RIGHT",
                        "groupKey": list(group_key),
                        "leftRowNumber": None,
                        "rightRowNumber": right_row["_rowNumber"],
                        "leftValues": {
                            mapping["left"]: ""
                            for mapping in compare_mappings
                        },
                        "rightValues": {
                            mapping["right"]: right_row["values"].get(mapping["right"], "")
                            for mapping in compare_mappings
                        },
                    }
                    mismatch_rows.append(row)
                    comparison_rows.append(row)

        matched_signatures = set(left_counter.keys()) & set(right_counter.keys())
        remaining_left = [
            row
            for signature, rows_for_signature in ((signature, [r for r in left_bucket if row_signature(r["values"], compare_mappings, "left", trim_whitespace, ignore_case) == signature]) for signature in left_counter.keys())
            if signature not in matched_signatures
            for row in rows_for_signature
        ]
        remaining_right = [
            row
            for signature, rows_for_signature in ((signature, [r for r in right_bucket if row_signature(r["values"], compare_mappings, "right", trim_whitespace, ignore_case) == signature]) for signature in right_counter.keys())
            if signature not in matched_signatures
            for row in rows_for_signature
        ]

        if remaining_left and remaining_right:
            used_right_indexes: set[int] = set()
            repaired_left_indexes: set[int] = set()
            minimum_similarity = mismatch_similarity_threshold(len(compare_mappings))

            for left_index, left_row in enumerate(remaining_left):
                best_index = -1
                best_score = -1

                for right_index, right_row in enumerate(remaining_right):
                    if right_index in used_right_indexes:
                        continue
                    score = row_match_score(left_row, right_row, compare_mappings, trim_whitespace, ignore_case)
                    if score > best_score:
                        best_score = score
                        best_index = right_index

                if best_index >= 0 and best_score >= minimum_similarity:
                    right_row = remaining_right[best_index]
                    used_right_indexes.add(best_index)
                    repaired_left_indexes.add(left_index)
                    status = "MATCH" if best_score == len(compare_mappings) else "MISMATCH"
                    if status == "MATCH":
                        matched += 1
                    else:
                        mismatched += 1
                    comparison_rows.append(
                        {
                            "status": status,
                            "groupKey": list(group_key),
                            "leftRowNumber": left_row["_rowNumber"],
                            "rightRowNumber": right_row["_rowNumber"],
                            "leftValues": {
                                mapping["left"]: left_row["values"].get(mapping["left"], "")
                                for mapping in compare_mappings
                            },
                            "rightValues": {
                                mapping["right"]: right_row["values"].get(mapping["right"], "")
                                for mapping in compare_mappings
                            },
                        }
                    )

            if repaired_left_indexes:
                mismatch_rows[:] = [
                    row
                    for row in mismatch_rows
                    if not (
                        row["status"] == "ONLY_IN_LEFT" and any(row["leftRowNumber"] == remaining_left[i]["_rowNumber"] for i in repaired_left_indexes)
                    )
                ]
                mismatch_rows[:] = [
                    row
                    for row in mismatch_rows
                    if not (
                        row["status"] == "ONLY_IN_RIGHT" and any(row["rightRowNumber"] == remaining_right[i]["_rowNumber"] for i in used_right_indexes)
                    )
                ]
                comparison_rows[:] = [
                    row
                    for row in comparison_rows
                    if not (
                        row["status"] == "ONLY_IN_LEFT" and any(row["leftRowNumber"] == remaining_left[i]["_rowNumber"] for i in repaired_left_indexes)
                    )
                ]
                comparison_rows[:] = [
                    row
                    for row in comparison_rows
                    if not (
                        row["status"] == "ONLY_IN_RIGHT" and any(row["rightRowNumber"] == remaining_right[i]["_rowNumber"] for i in used_right_indexes)
                    )
                ]
                left_only = sum(1 for row in comparison_rows if row["status"] == "ONLY_IN_LEFT")
                right_only = sum(1 for row in comparison_rows if row["status"] == "ONLY_IN_RIGHT")

    return {
        "left": {
            "sheet": left_table.name,
            "headerRow": left_table.header_row,
            "headers": left_table.headers,
            "rowCount": len(left_rows),
            "sampleRows": left_table.sample_rows,
        },
        "right": {
            "sheet": right_table.name,
            "headerRow": right_table.header_row,
            "headers": right_table.headers,
            "rowCount": len(right_rows),
            "sampleRows": right_table.sample_rows,
        },
        "mappings": {
            "keys": key_mappings,
            "compare": compare_mappings,
        },
        "summary": {
            "matchedRows": matched,
            "mismatchedRows": mismatched,
            "leftOnlyRows": left_only,
            "rightOnlyRows": right_only,
            "mismatchCount": mismatched + left_only + right_only,
            "isMatch": mismatched == 0 and left_only == 0 and right_only == 0,
        },
        "matchedHeaders": [
            {
                "left": mapping["left"],
                "right": mapping["right"],
            }
            for mapping in compare_mappings
        ],
        "comparisonRows": comparison_rows,
        "mismatches": mismatch_rows[:300],
    }


def inspect_files(payload: dict[str, Any]) -> dict[str, Any]:
    workbooks: dict[str, Any] = {}
    for item in payload.get("files", []):
        workbook = load_workbook_input(item.get("path"), item.get("workbook"))
        workbooks[item["id"]] = workbook_summary(workbook)
    return {"workbooks": workbooks}


def main() -> None:
    try:
        payload = json.load(sys.stdin)
        action = payload.get("action")
        if action == "inspect":
            result = inspect_files(payload)
        elif action == "compare":
            result = compare_tables(payload)
        else:
            raise ValueError("Unknown action.")
        json.dump(result, sys.stdout)
    except Exception as exc:
        json.dump({"error": str(exc)}, sys.stdout)
        sys.exit(1)


if __name__ == "__main__":
    main()
