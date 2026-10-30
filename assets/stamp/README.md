# Local seal rendering assets

All seal text, reference-image analysis, preview generation and PNG generation run in the browser. Seal text is converted to SVG outlines with the vendored OpenType.js 1.3.4 (MIT), so preview and export need no installed fonts, external font API, or remote text processing.

Fonts were obtained on 2026-10-30 from the Google Fonts repository. Each original license is alongside its font. These OFL fonts permit commercial document-image use.

- `fonts/myeongjo.ttf`: Noto Serif KR, static weight 700 instance of https://github.com/google/fonts/blob/main/ofl/notoserifkr/NotoSerifKR%5Bwght%5D.ttf
- `fonts/gothic.ttf`: Noto Sans KR, static weight 700 instance of https://github.com/google/fonts/blob/main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf
- `fonts/batang.ttf`: Gowun Batang Bold, https://github.com/google/fonts/tree/main/ofl/gowunbatang
- `fonts/brush.ttf`: Nanum Brush Script Regular, https://github.com/google/fonts/tree/main/ofl/nanumbrushscript
- `vendor/opentype.min.js`: https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.min.js

Noto static instances were generated using fontTools 4.66.1 `instantiateVariableFont(font, {'wght': 700}, inplace=True)` and saved as TTF. No glyph subsetting or outline replacement was performed. Noto fonts contain common Hangul/Hanja; Gowun/Nanum files here are Hangul-oriented. The renderer checks `charToGlyphIndex()` for every entered character and refuses export if any glyph is absent, rather than silently dropping characters or drawing .notdef boxes. Rare Hanja outside a font's cmap produce the same warning.

Seal-script and Gungseo fonts are not bundled because an appropriate licensed asset was not established. Reference analysis estimates ink bounding ratio and roundness only; it does not perform OCR, infer legal status, or reproduce a sample automatically.
