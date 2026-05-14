#!/usr/bin/env python3
"""Convert Tamzen 8x16 Bold (BDF format, hand-designed pixel font) into
TypeScript bitmap glyph data for the GIF exporter.

Run when the bundled font needs updating:

    python3 scripts/rasterize-tamzen.py /path/to/Tamzen8x16b.bdf

Emits TypeScript glyph data to src/lib/gif/tamzen-bold.ts. The runtime never
parses the BDF — it just reads the embedded bitmaps.

Tamzen is unlike Cascadia: there's no TTF rasterisation, no thresholding, no
anti-aliasing. Each glyph is a hand-placed 8×16 bitmap drawn by a type
designer for exactly this resolution. Quality is independent of pixel size.
"""
from __future__ import annotations

import sys
from pathlib import Path

GLYPH_W = 8
GLYPH_H = 16

# Symbols Tamzen doesn't ship — we paint them ourselves. RepoGarden's renderer
# emits these as decorative cells (vibe glyphs, brand strip, star field).
# Each row is the bottom 8 bits of an int, MSB = leftmost pixel.
HAND_DRAWN_OVERRIDES: dict[str, list[int]] = {
    "·": [  # U+00B7 middle dot
        0b00000000, 0b00000000, 0b00000000, 0b00000000,
        0b00000000, 0b00000000, 0b00000000, 0b00011000,
        0b00011000, 0b00000000, 0b00000000, 0b00000000,
        0b00000000, 0b00000000, 0b00000000, 0b00000000,
    ],
    "•": [  # U+2022 bullet
        0b00000000, 0b00000000, 0b00000000, 0b00000000,
        0b00000000, 0b00111100, 0b01111110, 0b01111110,
        0b01111110, 0b00111100, 0b00000000, 0b00000000,
        0b00000000, 0b00000000, 0b00000000, 0b00000000,
    ],
    "★": [  # U+2605 black star
        0b00000000, 0b00000000, 0b00010000, 0b00010000,
        0b00111000, 0b00111000, 0b01111100, 0b11111110,
        0b11111110, 0b01111100, 0b00111000, 0b01101100,
        0b11000110, 0b00000000, 0b00000000, 0b00000000,
    ],
    "✦": [  # U+2726 black four-pointed star
        0b00000000, 0b00000000, 0b00010000, 0b00010000,
        0b00111000, 0b01111100, 0b11111110, 0b01111100,
        0b00111000, 0b00010000, 0b00010000, 0b00000000,
        0b00000000, 0b00000000, 0b00000000, 0b00000000,
    ],
    "✧": [  # U+2727 white four-pointed star
        0b00000000, 0b00000000, 0b00010000, 0b00010000,
        0b00101000, 0b01000100, 0b10000010, 0b01000100,
        0b00101000, 0b00010000, 0b00010000, 0b00000000,
        0b00000000, 0b00000000, 0b00000000, 0b00000000,
    ],
    "⋆": [  # U+22C6 star operator (smaller four-point star)
        0b00000000, 0b00000000, 0b00000000, 0b00000000,
        0b00010000, 0b00111000, 0b01111100, 0b00111000,
        0b00010000, 0b00000000, 0b00000000, 0b00000000,
        0b00000000, 0b00000000, 0b00000000, 0b00000000,
    ],
}


def parse_bdf(path: Path) -> dict[str, list[int]]:
    """Return {char: rows[]} for every encoded glyph in the BDF."""
    glyphs: dict[str, list[int]] = {}
    with path.open("r", encoding="latin-1") as f:
        lines = f.read().splitlines()
    i = 0
    cur_enc = -1
    cur_rows: list[int] = []
    cur_bbx: tuple[int, int, int, int] | None = None
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("ENCODING"):
            cur_enc = int(line.split()[1])
        elif line.startswith("BBX"):
            parts = line.split()
            cur_bbx = (int(parts[1]), int(parts[2]), int(parts[3]), int(parts[4]))
        elif line == "BITMAP":
            i += 1
            cur_rows = []
            while i < len(lines) and lines[i].strip() != "ENDCHAR":
                cur_rows.append(int(lines[i].strip(), 16))
                i += 1
            if 0 <= cur_enc < 0x10000 and cur_bbx is not None:
                # Pad/clip the glyph to a fixed GLYPH_W × GLYPH_H matrix so the
                # exported data is uniform. BDF rows may be narrower than 8 if
                # the glyph's BBX width is < 8, but Tamzen 8x16 keeps everything
                # at 8 wide; we still normalize defensively.
                normalized = normalize_glyph(cur_rows, cur_bbx)
                glyphs[chr(cur_enc)] = normalized
            cur_enc = -1
            cur_bbx = None
            cur_rows = []
        i += 1
    return glyphs


def normalize_glyph(rows: list[int], bbx: tuple[int, int, int, int]) -> list[int]:
    """Place a glyph (with its BBX offsets) onto a fixed GLYPH_W × GLYPH_H
    bitmap, top-left aligned to the typographic baseline expectation.

    Tamzen's font bounding box is (8, 16, 0, -4): cells are 8×16 with baseline
    at row 12 (16 + (-4)). The glyph's yoff places its bottom relative to the
    baseline; descenders extend below. We compose into a 16-row matrix
    matching that geometry."""
    gw, gh, gxoff, gyoff = bbx
    out = [0] * GLYPH_H
    # baseline row in our fixed output = GLYPH_H + font_y_offset. For Tamzen
    # 8x16 the font yoff is -4, so baseline = 12.
    baseline = GLYPH_H + (-4)
    top = baseline - gh - gyoff  # row index where this glyph's top sits
    bytes_per_row = max(1, (gw + 7) // 8)
    for ry, raw in enumerate(rows):
        out_y = top + ry
        if not (0 <= out_y < GLYPH_H):
            continue
        # Shift glyph bits to land at gxoff. Tamzen has gxoff=0 mostly.
        shifted = 0
        for bx in range(gw):
            # Pixel set if bit (high-to-low) is on.
            byte_idx = bx // 8
            bit_idx = 7 - (bx % 8)
            byte_val = (raw >> (8 * (bytes_per_row - 1 - byte_idx))) & 0xff
            if (byte_val >> bit_idx) & 1:
                target_bit = GLYPH_W - 1 - (gxoff + bx)
                if 0 <= target_bit < GLYPH_W:
                    shifted |= 1 << target_bit
        out[out_y] |= shifted
    return out


def emit(path: Path, glyphs: dict[str, list[int]]) -> None:
    lines = [
        "// AUTO-GENERATED by scripts/rasterize-tamzen.py — do not edit by hand.",
        "// Source: Tamzen 8x16 Bold (sunaku/tamzen-font, MIT).",
        "// Hand-designed 8×16 bitmap font — no rasterisation, no anti-aliasing.",
        "// Each row is a left-aligned 8-bit mask packed in the low bits of a number.",
        "",
        f"export const FONT_W = {GLYPH_W};",
        f"export const FONT_H = {GLYPH_H};",
        "export const FONT_KERN = 0;",
        "",
        "export const FONT_GLYPHS: Record<string, readonly number[]> = {",
    ]
    for ch in sorted(glyphs.keys(), key=ord):
        rows = glyphs[ch]
        if ch == "\\":
            key = '"\\\\"'
        elif ch == '"':
            key = "'\"'"
        elif 0x20 <= ord(ch) < 0x7F:
            key = f'"{ch}"'
        else:
            key = f'"\\u{ord(ch):04x}"'
        row_str = ", ".join(f"0x{r:02x}" for r in rows)
        lines.append(f"  {key}: [{row_str}],")
    lines.append("};")
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: rasterize-tamzen.py <path-to-Tamzen8x16b.bdf>", file=sys.stderr)
        return 1
    bdf = Path(sys.argv[1]).expanduser().resolve()
    if not bdf.is_file():
        print(f"font not found: {bdf}", file=sys.stderr)
        return 1
    glyphs = parse_bdf(bdf)
    # Apply hand-drawn overrides for symbols Tamzen doesn't ship.
    for ch, rows in HAND_DRAWN_OVERRIDES.items():
        glyphs[ch] = list(rows[:GLYPH_H])
    out = Path(__file__).resolve().parent.parent / "src" / "lib" / "gif" / "tamzen-bold.ts"
    emit(out, glyphs)
    overrode = ", ".join(HAND_DRAWN_OVERRIDES.keys())
    print(f"wrote {out} ({len(glyphs)} glyphs; overrode {overrode})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
