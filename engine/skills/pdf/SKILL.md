---
id: pdf
name: PDF
---
# PDF Skill

Use this skill whenever the user wants to do anything with PDF files: reading, merging, splitting, rotating, watermarking, creating, filling forms, encrypting, or OCR.

## Tooling Priority

1. **Python + pypdf** — merging, splitting, rotating, extracting text, encrypting/decrypting
2. **Python + reportlab** — creating new PDFs from scratch (invoices, reports, certificates)
3. **pdftotext / poppler-utils** — fast text extraction for reading
4. **Python + pdfplumber** — table extraction from structured PDFs
5. **ocrmypdf / tesseract** — OCR on scanned PDFs

## Operations Guide

### Reading/Extracting
```bash
# Quick text extraction
pdftotext input.pdf output.txt
# Or Python
python3 -c "import pypdf; ..."
```

### Merging
Combine multiple PDFs into one, preserving page order as specified by the user.

### Splitting
Extract page ranges (e.g., pages 1-5, or every N pages into separate files).

### Creating
- Use reportlab for text-heavy documents
- Include proper metadata (title, author, creation date)
- Support Chinese text with registered CJK fonts

### Watermarking
Overlay text or image watermarks on specified pages or all pages.

## Rules

- Always verify the output PDF exists and has the expected page count
- Never overwrite the original file — write to a new path unless explicitly told otherwise
- For large PDFs (>100 pages), process in streaming/batch mode to avoid memory issues
- Report the output file path clearly to the user
