from __future__ import annotations

import json
from pathlib import Path

import pdfplumber


COURSE_DIR = Path(r"F:\AI课程\产品专项")
OUTPUT_DIR = Path("tmp/course-extract")
REQUESTED_PREFIXES = (
    "1-1", "1-2", "2-1", "2-2", "3-1", "3-2",
    "4-1", "4-2", "5-1", "5-2", "6-1",
)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest: list[dict[str, object]] = []
    for path in sorted(COURSE_DIR.glob("*.pdf")):
        if not path.name.startswith(REQUESTED_PREFIXES):
            continue
        output = OUTPUT_DIR / f"{path.stem}.txt"
        if output.exists() and output.stat().st_size > 0:
            page_count = output.read_text(encoding="utf-8").count("===== PAGE ")
            manifest.append({"source": str(path), "pages": page_count, "text": str(output)})
            continue
        pages: list[str] = []
        with pdfplumber.open(path) as pdf:
            for number, page in enumerate(pdf.pages, start=1):
                text = (page.extract_text(x_tolerance=2, y_tolerance=3) or "").strip()
                pages.append(f"\n\n===== PAGE {number} =====\n{text}")
        output.write_text("".join(pages), encoding="utf-8")
        manifest.append({"source": str(path), "pages": len(pages), "text": str(output)})
    (OUTPUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
