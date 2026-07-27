# -*- coding: utf-8 -*-
"""Tests for md2word — asserts the personal layout conventions the skill promises:
no literal ** residue, no horizontal rules / page breaks, native tables, real bold.
"""
import os
import subprocess
import sys
import zipfile

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "md2word.py")

docx = pytest.importorskip("docx", reason="python-docx not installed")

FIXTURE = """\
# 标题一

这是**加粗文本**和普通文本，以及 `行内代码`。

---

## 二级标题

| 名称 | 说明 |
|------|------|
| foo  | **粗体格** |
| bar  | 普通格 |

> 引用块转普通段落

- 无序项一
- 无序项二

1. 有序项一

```python
code_line = 1
```
"""


@pytest.fixture(scope="module")
def converted(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("md2word")
    src = tmp / "fixture.md"
    dst = tmp / "out.docx"
    src.write_text(FIXTURE, encoding="utf-8")
    subprocess.run([sys.executable, SCRIPT, str(src), str(dst)],
                   check=True, capture_output=True)
    return dst


def _all_text(doc):
    parts = [p.text for p in doc.paragraphs]
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                parts.append(cell.text)
    return "\n".join(parts)


def test_no_literal_double_asterisk_residue(converted):
    doc = docx.Document(str(converted))
    assert "**" not in _all_text(doc)


def test_bold_becomes_real_bold_run(converted):
    doc = docx.Document(str(converted))
    bold_texts = [r.text for p in doc.paragraphs for r in p.runs if r.bold]
    assert "加粗文本" in bold_texts


def test_table_is_native_with_header_bold(converted):
    doc = docx.Document(str(converted))
    assert len(doc.tables) == 1
    table = doc.tables[0]
    assert len(table.rows) == 3  # 表头 + 2 数据行（|---| 分隔行已丢弃）
    header = table.rows[0]
    assert all(r.bold for cell in header.cells for p in cell.paragraphs for r in p.runs)


def test_no_page_breaks_or_horizontal_rules(converted):
    with zipfile.ZipFile(str(converted)) as z:
        xml = z.read("word/document.xml").decode("utf-8")
    assert 'w:br w:type="page"' not in xml
    assert "w:pBdr" not in xml  # 水平线/引用边框类装饰


def test_heading_and_quote_and_code(converted):
    doc = docx.Document(str(converted))
    styles = {p.style.name: p.text for p in doc.paragraphs}
    assert styles.get("Title") == "标题一"
    assert styles.get("Heading 1") == "二级标题"
    # 引用块转普通段落（Normal 样式，无引用边框）
    assert any(p.style.name == "Normal" and "引用块" in p.text for p in doc.paragraphs)
    # 代码行为 Consolas 等宽
    code_runs = [r for p in doc.paragraphs for r in p.runs if "code_line" in r.text]
    assert code_runs and all(r.font.name == "Consolas" for r in code_runs)
