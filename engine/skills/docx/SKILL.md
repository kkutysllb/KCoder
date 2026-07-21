---
id: docx
name: Word Document
---
# Word Document Skill

Use this skill whenever the user wants to create, read, edit, or manipulate Word documents (.docx files).

## Tooling

- **python-docx** — primary library for creating and editing .docx files
- Install check: `pip3 show python-docx || pip3 install python-docx`

## Creating Documents

### Structure Template
```python
from docx import Document
from docx.shared import Inches, Pt, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH

doc = Document()
# Title
doc.add_heading('Document Title', level=0)
# Body with styles
doc.add_paragraph('Body text', style='Normal')
# Tables
table = doc.add_table(rows=2, cols=3, style='Table Grid')
# Images
doc.add_picture('image.png', width=Inches(4))
doc.save('output.docx')
```

### Formatting Best Practices
- Use built-in heading levels (Heading 1-4) for document outline
- Set consistent fonts: Chinese content needs CJK-compatible font (e.g., 宋体/微软雅黑)
- Add page numbers via section footer when requested
- Use styles rather than inline formatting for consistency

## Reading Documents

```python
from docx import Document
doc = Document('input.docx')
for para in doc.paragraphs:
    print(f"[{para.style.name}] {para.text}")
for table in doc.tables:
    for row in table.rows:
        print([cell.text for cell in row.cells])
```

## Editing Documents
- Locate paragraphs by text content, modify runs for partial edits
- Preserve existing styles when inserting content
- For tracked changes: note that python-docx has limited support; suggest manual review for complex change tracking

## Rules

- Verify output by reopening the file and checking paragraph count
- Never corrupt existing documents — work on a copy first
- Report file path and document stats (pages estimate, word count) to the user
