---
name: md2word
description: 把 Markdown 文件转换为 Word (.docx)。遵循个人排版习惯：** 转真正加粗、不输出任何分隔符/水平线/分页符、表格转原生 Word 表格、中文微软雅黑。触发词：md转word、markdown转docx、转换一个word版。
---

# md2word — Markdown 转 Word

使用 python-docx 转换，不依赖 pandoc。转换脚本 `md2word.py` 与本文件同目录。

## 何时使用

用户要求把 .md 文件转成 Word / docx 时。

## 执行步骤

1. 确认源文件存在；输出路径默认同名 .docx，用户指定则用指定路径。
2. 运行（脚本与 SKILL.md 同目录，用该目录的绝对路径调用）：
   ```bash
   python3 <技能目录>/md2word.py <input.md> [output.docx]
   ```
3. 若报缺依赖，执行 `pip3 install python-docx` 后重试。
4. 转换后必须验证（解压 document.xml 或转文本检查）：
   - 字面 `**` 残留数为 0（`** **` 必须变成真正的加粗 run）
   - 表格数量与源文件一致
   - 无分页符、无水平线等分隔符元素

## 个人排版约定（已固化在脚本中，不要改变行为）

- `**文本**` → 真正加粗，绝不允许字面 ** 出现在 Word 里
- 不要分隔符：跳过 `---`/`***`/`___` 水平线，不加分页符；表格 `|---|` 分隔行丢弃；引用块（`>`）转普通段落，不用带边框的引用样式
- markdown 表格 → 原生 Word 表格（Table Grid 边框，表头加粗）
- 标题层级：`#` → Title，`##` → Heading 1，`###` → Heading 2
- 代码块和 `` `行内代码` `` → Consolas 等宽字体
- 中文正文微软雅黑，西文 Calibri

## 避免

- 不要用 textutil 或直接改后缀的方式转换（会残留字面 markdown 符号）
- 不要引入 pandoc 依赖（本机未安装，python-docx 足够）
