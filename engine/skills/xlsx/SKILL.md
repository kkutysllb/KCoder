---
id: xlsx
name: Spreadsheet
---
# Spreadsheet Skill

Use this skill any time a spreadsheet file is the primary input or output: .xlsx, .xlsm, .csv, or .tsv files.

## Tooling

- **openpyxl** — reading/writing .xlsx with formulas, styles, charts
- **pandas** — data analysis, cleaning, format conversion
- Install check: `pip3 show openpyxl pandas || pip3 install openpyxl pandas`

## Operations

### Reading
```python
import openpyxl
wb = openpyxl.load_workbook('file.xlsx', data_only=False)  # keep formulas
ws = wb.active
for row in ws.iter_rows(values_only=True):
    print(row)
```

### Creating
- Set column widths for readability
- Use number formats for currency/dates/percentages
- Add headers with bold styling and freeze panes
- Include formulas (=SUM, =AVERAGE) rather than hardcoded totals where appropriate

### Editing
- Load with `data_only=False` to preserve existing formulas
- Modify only targeted cells; never rewrite the entire sheet unnecessarily
- Preserve conditional formatting and data validation when possible

### Data Cleaning
- Detect and fix: misplaced headers, merged cells causing shifts, inconsistent types
- Normalize dates to ISO format unless told otherwise
- Report what was cleaned (rows fixed, values coerced)

### Conversion
- CSV ↔ XLSX: preserve encoding (detect UTF-8/GBK for Chinese content)
- Multiple CSVs → multi-sheet workbook
- XLSX → JSON/Markdown table for further processing

## Rules

- The deliverable must be a spreadsheet file (not a script or report about the data)
- Verify output: reopen and check dimensions + sample cells
- For files >100k rows, use pandas with chunked reading
- Never silently drop data — report any rows/values that couldn't be processed
