#!/usr/bin/env fontforge
"""Build a display-only Greek-look font from a local font that already contains Greek glyphs.

Usage:
  fontforge -script build-kalima-font.py INPUT_FONT OUTPUT_FONT

Use only a font whose license permits modification. The generated font is intended
for personal display use in applications that let you choose a document font.
"""

import os
import sys
import fontforge
import psMat

if len(sys.argv) != 3:
    raise SystemExit("Usage: fontforge -script build-kalima-font.py INPUT_FONT OUTPUT_FONT")

input_path, output_path = sys.argv[1], sys.argv[2]
font = fontforge.open(input_path)

font.familyname = "Kalima"
font.fullname = "Kalima Regular"
font.fontname = "Kalima-Regular"
font.version = "1.0"
font.comment = "Personal display font with Latin slots replaced by Greek-looking glyphs."

single_map = {
    "a": "α", "c": "κ", "d": "δ", "e": "ε", "f": "φ", "g": "γ",
    "h": "η", "i": "ι", "k": "κ", "l": "λ", "m": "μ", "n": "ν",
    "o": "ο", "p": "π", "q": "θ", "r": "ρ", "s": "σ", "t": "τ",
    "u": "υ", "v": "β", "w": "ω", "x": "ξ", "y": "υ", "z": "ζ",
    "A": "Α", "C": "Κ", "D": "Δ", "E": "Ε", "F": "Φ", "G": "Γ",
    "H": "Η", "I": "Ι", "K": "Κ", "L": "Λ", "M": "Μ", "N": "Ν",
    "O": "Ο", "P": "Π", "Q": "Θ", "R": "Ρ", "S": "Σ", "T": "Τ",
    "U": "Υ", "V": "Β", "W": "Ω", "X": "Ξ", "Y": "Υ", "Z": "Ζ"
}

multi_map = {
    "b": "μπ", "j": "τζ",
    "B": "ΜΠ", "J": "ΤΖ"
}


def require_glyph(ch):
    codepoint = ord(ch)
    if codepoint not in font:
        raise RuntimeError(f"Input font lacks required glyph {ch!r} (U+{codepoint:04X})")
    return font[codepoint]


def copy_glyph(source_char, destination_char):
    require_glyph(source_char)
    font.selection.none()
    font.selection.select(ord(source_char))
    font.copy()
    font.selection.none()
    font.selection.select(ord(destination_char))
    font.paste()
    destination = font[ord(destination_char)]
    destination.unicode = ord(destination_char)
    destination.glyphname = f"veil_{ord(destination_char):04X}"


def compose_glyph(source_chars, destination_char):
    sources = [require_glyph(ch) for ch in source_chars]
    destination = font.createChar(ord(destination_char), f"veil_{ord(destination_char):04X}")
    destination.clear()

    x = 0
    for source in sources:
        destination.addReference(source.glyphname, psMat.translate(x, 0))
        x += source.width
    destination.width = x


for latin, greek in single_map.items():
    copy_glyph(greek, latin)

for latin, greek_sequence in multi_map.items():
    compose_glyph(greek_sequence, latin)

os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
font.generate(output_path)
font.close()
print(f"Generated: {output_path}")
