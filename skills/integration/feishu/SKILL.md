---
name: feishu
description: 通过 lark-cli（@larksuite/cli）访问飞书文档/表格/Wiki/多维表格/云空间 —— 本机装了 lark-cli 就等于有了一个飞书 MCP。触发词：飞书文档、读飞书/导出飞书文档、feishu doc/wiki/sheets/base/drive、lark-cli、lark mcp、ihaier.feishu.cn。含检测/安装 lark-cli、导出文档为 markdown。
allowed-tools: Bash(python:*), Bash(npm:*), Bash(lark-cli:*)
---

# 飞书资源访问（lark-cli）

`lark-cli`（npm 包 `@larksuite/cli`，官方飞书/Lark 开放平台 CLI）在本机装好后等价于一个本地飞书 MCP：可读 docx / wiki / sheets / base / drive 资源，无需自建 MCP server。本 skill 帮 agent 免于每次重踩同样的坑（`--raw` 不是 flag、bot 缺权限、wiki 要先 unwrap、markdown 正文含占位标签等）。

配套脚本 `feishu.py`（与本 SKILL.md 同目录）封装了检测、安装、导出三件套；纯解析层有 pytest，不连飞书。

## 方案选择（先说结论）

| 需求 | 用哪个 |
|------|--------|
| 导出全量文档为本地 markdown / 归档 | **本 skill 的 `feishu.py fetch`** |
| 只读某段 / 关键词定位 | `lark-cli docs +fetch --scope outline\|section\|range\|keyword` |
| 读 wiki 文档 | 先 `lark-cli drive +inspect --url <wiki URL> --as user` unwrap 成 docx token，再 `docs +fetch` |
| 下载文档内附件/素材 | `lark-cli drive +download` / `docs +media-download`（注意 bot 通常无权限，需 `--as user`） |
| 创建/编辑文档 | `lark-cli docs +create` / `docs +update --command ...`，AI 用前必读内嵌 skill |
| 表格/多维表格/幻灯片/审批/任务/IM 等 | `lark-cli <domain> --help` + `lark-cli skills read lark-<domain>` |

**核心原则**：文档正文一律 `--format json` 落盘再用脚本提取，**不要把正文经 prompt 传递**（烧 token，且大文档易截断）。

## 前置条件

1. **Node + npm**：`node -v` / `npm -v`。本机 Node v24、npm prefix `h:\nodejs\node_global`。
2. **lark-cli 已装**：`python feishu.py doctor` 检测；缺失则 `python feishu.py install`。
3. **应用凭据已绑定 + 认证 ready**：`lark-cli auth status` 看 `bot` / `user` 两个身份都 `available: true`。未就绪按下面“首次安装/配置 SOP”走。

## 首次安装 / 配置 SOP

### 1. 装 lark-cli

```bash
python feishu.py install          # 等价：npm install -g @larksuite/cli
```

二进制落在 npm prefix 下的 `lark-cli`（本机 `h:\nodejs\node_global\lark-cli`）。注意**可执行文件名是 `lark-cli`，不是 `lark`** —— `which lark` 即使已装也空，`npx lark` 会拉到无关包 `lark@2.x`。

### 2. 绑定飞书应用凭据（人工，含密钥）

在飞书开放平台建一个自建应用，拿到 App ID + App Secret，然后：

```bash
# 非交互（secret 走 stdin，避免出现在进程列表）：
echo -n '<APP_SECRET>' | lark-cli config init --app-id <APP_ID> --app-secret-stdin --brand feishu

# 或交互式建/选应用：
lark-cli config init --new
```

- `--brand feishu` = 国内站（`*.feishu.cn`）；海外 Lark 用 `--brand lark`。
- 配置文件：`~/.lark-cli/config.json`（Windows: `C:\Users\<user>\.lark-cli\config.json`），`lark-cli config show` 查看当前绑定。
- 其它配置命令：`lark-cli config show|bind|default-as|remove|strict-mode`，`lark-cli profile add|list|use|rename|remove`（多 profile 时切；**agent 未经用户同意勿切/删 profile**）。

### 3. 用户认证（Device Flow，交互，必做一次）

```bash
lark-cli auth login                 # 浏览器扫码授权，默认申请推荐 scope
lark-cli auth login --domain docs,drive,sheets,base,wiki   # 限定域
lark-cli auth login --recommend     # 只申请自动批准 scope
```

**Agent 两步法**（harness 只回最终消息时）：`lark-cli auth login --no-wait --json` 拿验证 URL/二维码 → 作为回合最终消息交给用户 → 用户确认授权后 `lark-cli auth login --device-code <code>` 完成。

bot 身份（应用身份）装好凭据即有 tenant token，能读公开 docx；user 身份能读私有文档/wiki/附件，但需用户 OAuth 一次。

### 4. 自检

```bash
python feishu.py doctor                      # 解析 doctor + whoami + auth status，给就绪裁决
lark-cli doctor                              # 配置/认证/连通性
lark-cli auth status                         # 最全：bot+user 状态 + scope 列表 + token 过期时间
lark-cli whoami                              # 只看当前身份
```

`doctor` 输出 `ready: True`（bot + user 都可用）即可开始读写。

## 读写文档 SOP

### 读正文（导出 markdown）

```bash
python feishu.py fetch --doc "<URL或token>" --output-dir <目录> [--as bot|user] [--name <文件名>]
```

等价于：

```bash
lark-cli docs +fetch --doc "https://ihaier.feishu.cn/docx/UTKEdMS03oth1axtFqccsqv8nob" \
  --doc-format markdown --as bot --format json > <name>.raw.json
# 正文在 .data.document.content，用 python 提取写到 <name>.md
```

- 先 `--as bot`（对公开 docx 常有 `docx:document:readonly`）；失败再 `--as user`。
- `--doc` 接受完整 URL 或裸 token。`--doc-format markdown|xml`（默认 markdown，导出归档用；编辑/精修改 xml）。
- 局部读：`--scope outline|section|range|keyword`、`--detail with-ids|full`、`--max-depth`、`--start-block-id`/`--end-block-id`、`--keyword "部署|发布|上线"`（`|` = OR）。详见 `lark-cli skills read lark-doc references/lark-doc-fetch.md`。

### wiki URL —— 必须先 unwrap

wiki URL 不能直接 `docs +fetch`。先 inspect 拿到底层 docx token：

```bash
lark-cli drive +inspect --url "https://ihaier.feishu.cn/wiki/VKQVwwwhKidbz8kKdjjc5MUGn2G" --as user
# 输出 data.wiki_node.obj_token = "EDLXdICeUo4BV0xx7uqcE8yynHd"
lark-cli docs +fetch --doc "EDLXdICeUo4BV0xx7uqcE8yynHd" --doc-format markdown --as user
```

`feishu.py fetch` 检测到 `/wiki/` URL 会自动 inspect unwrap 再 fetch。bot 对 wiki node 常无权限（`131006 node permission denied`），wiki 一律 `--as user`。

### 创建 / 编辑

```bash
lark-cli docs +create --content '<title>标题</title><p>内容</p>'           # XML 默认
lark-cli docs +update --doc "<URL>" --command append --content '<p>...</p>'
lark-cli docs +update --doc "<URL>" --command str_replace --old "<old>" --new "<new>"  # 局部精修
```

**AI 用前必读内嵌 skill**（版本与当前 CLI 匹配，勿 grep 本地 SKILL.md）：

```bash
lark-cli skills read lark-doc                       # 文档域总览
lark-cli skills read lark-doc references/lark-doc-fetch.md
lark-cli skills read lark-doc references/lark-doc-xml.md
lark-cli skills list                                # 所有域 skill
```

局部精修（`str_replace`/`block_insert_after`/`block_replace`/`block_delete`/`block_move_after`）用 XML（`--doc-format xml`，默认）；整段导入可用 markdown。连续写操作按 `lark-doc-update.md` 的 Block ID 生命周期判断旧 ID 能否复用。

### 其它域

| 域 | 用途 | 命令 |
|----|------|------|
| `drive` | 云空间/附件/复制/导入导出/权限 | `lark-cli drive +download/+import/+export/+inspect/+copy` |
| `sheets` | 电子表格 | `lark-cli sheets --help` |
| `base` | 多维表格（表/字段/记录/视图） | `lark-cli base --help` |
| `wiki` | Wiki 空间/节点 | `lark-cli wiki --help` |
| `markdown` | Drive-native Markdown 文件 | `lark-cli markdown --help` |
| 其它 | approval/attendance/calendar/contact/im/mail/okr/task/vc/... | `lark-cli --help` 列全 |

各域先 `<domain> --help` 看子命令（优先 `+shortcut`，次选 raw API），再 `lark-cli skills read lark-<domain>` 读工作流。万能逃生舱：`lark-cli api <METHOD> <path>` 按 HTTP 路径调任意端点，`--page-all` 自动翻页。

## 踩坑清单（均为 2026-07-24 实测）

1. **`--raw` 不是 lark-cli 的 flag**：`... +fetch --raw` 报 `unknown flag "--raw"`，`lark-cli --raw docs +fetch` 报 `unknown command "+fetch"`，且 `> file` 会先截断再失败 → 落 **0 字节空文件**。改用 `--format json > x.raw.json` 再 Python 提取 `.data.document.content`，或 `--jq '.data.document.content'`。`feishu.py fetch` 已用前者。
2. **bot 只有 `docx:document:readonly`**：公开 docx fetch 可成；但 `drive +download/+preview` 报 `99991672` 缺 `drive:file:*`，wiki `+inspect` 报 `131006`。切 `--as user`；user token 失效再 `lark-cli auth login`。
3. **markdown 正文非纯 md**：含 `<whiteboard token=...>`、`<cite doc-id=... file-type=... title=... type=...>`、`<title>...</title>` 占位标签 —— 嵌入资源是占位符，要拿实体得跟 `drive +download` / `docs +media-download` / `lark-whiteboard`。
4. **`npx lark` 拉到无关包** `lark@2.x`；可执行文件名是 `lark-cli`，npm 包是 `@larksuite/cli`。
5. **`which lark` 即使已装也空** —— 检测必须查 `lark-cli`。`feishu.py doctor` 已按此检测。
6. **不要把文档正文经 prompt 传递**（烧 token，大文档易截断）—— 一律 `--format json` 直连落盘，分析也写脚本处理落盘文件。
7. **输出大文档时 Bash 捕获中文可能乱码**；lark-cli JSON 本身是干净 UTF-8 —— 优先重定向到文件，不要 `| head`。
8. `lark-cli api` 逃生舱可绕过缺 scope 的 typed 命令（如调 `/drive/v1/files/{token}/statistics`），但 user token 仍需对应 scope。

## 已知边界

- 国内站（`ihaier.feishu.cn`，brand=feishu）与海外 Lark（`larksuite.com`，brand=lark）不同，绑定时 `--brand` 选对。
- 只能读服务端存在且当前身份有权限的内容；无权限的文档（如海尔 VPP 登录对接文档 `EECDdvXTZoaUoXxy9GUcq5ztn3f`）需先在飞书开放平台后台给应用/用户授权，或换 `--as user`。
- 高危写操作（`docs +update` 的部分 command、`base` 删表/删字段等）标 `high-risk-write`，需 `--yes` 且用户确认后执行。
- `lark-cli skills read lark-doc` 内嵌 skill 建议“文档操作默认 `--as user`、首次前 `auth login`”；实测公开 docx 用 `--as bot` 也能读，bot 失败再回退 user。
- `--jq '.data.document.content'` 直出是否带 JSON wrapper 未实测（会话里直接走了 JSON+Python 提取）—— 优先用 `--format json` 落盘 + `feishu.py` 提取，行为确定。
