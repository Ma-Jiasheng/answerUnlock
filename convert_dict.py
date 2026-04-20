#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


def pick_phonetic(content: dict) -> str:
    for key in ("ukphone", "usphone", "phone"):
        value = content.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def pick_meaning(content: dict) -> str:
    trans = content.get("trans")
    if isinstance(trans, list):
        items = []
        for item in trans:
            if not isinstance(item, dict):
                continue
            text = item.get("tranCn")
            if isinstance(text, str) and text.strip():
                items.append(text.strip())
        if items:
            return "；".join(items)

    syno = content.get("syno", {})
    if isinstance(syno, dict):
        synos = syno.get("synos")
        if isinstance(synos, list):
            for s in synos:
                if not isinstance(s, dict):
                    continue
                text = s.get("tran")
                if isinstance(text, str) and text.strip():
                    return text.strip()
    return ""


def parse_line(line: str) -> dict | None:
    line = line.strip()
    if not line:
        return None

    obj = json.loads(line)
    word = obj.get("headWord")
    if not isinstance(word, str) or not word.strip():
        word = (
            obj.get("content", {})
            .get("word", {})
            .get("wordHead", "")
        )
    word = word.strip() if isinstance(word, str) else ""
    if not word:
        return None

    content = (
        obj.get("content", {})
        .get("word", {})
        .get("content", {})
    )
    if not isinstance(content, dict):
        content = {}

    return {
        "word": word,
        "phonetic": pick_phonetic(content),
        "meaning": pick_meaning(content),
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert dictionary JSONL to simplified JSON."
    )
    parser.add_argument("input", help="Input json file path (one JSON object per line)")
    parser.add_argument(
        "-o",
        "--output",
        default="dict_simplified.json",
        help="Output json file path (default: dict_simplified.json)",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    records = []
    with input_path.open("r", encoding="utf-8") as f:
        for idx, line in enumerate(f, start=1):
            try:
                item = parse_line(line)
                if item:
                    records.append(item)
            except json.JSONDecodeError as exc:
                print(f"Skip line {idx}: invalid json ({exc})")

    with output_path.open("w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)

    print(f"Done. {len(records)} records -> {output_path}")


if __name__ == "__main__":
    main()
