---
name: teams-chat-export
description: 导出本机 Microsoft Teams 聊天记录为 markdown 全量历史（含翻页）。触发词：导出 Teams 聊天记录、备份 Teams 对话、Teams chat export、聊天记录保存/归档、构建聊天时间线。基于 zaungast 直读本地缓存。
---

# Teams 聊天记录导出

把本机新版 Teams（com.microsoft.teams2）的聊天记录导出为 markdown：每个会话一个文件 + index.md 索引。用于聊天归档、项目复盘的事实时间线构建等。

## 方案选择（先说结论）

| 需求 | 用哪个 |
|------|--------|
| 导出全量历史 / 归档 | **本 skill（zaungast）** |
| 只看某会话最近几条消息 | local-mcp 的 `teams_read_chat_messages` 更快 |

**不要用 local-mcp 做导出**：`teams_read_chat_messages` 最多返回最新 50 条，无翻页参数（2026-07-21 实测：缓存补满后仍只回 50 条）。zaungast 直读本地缓存数据库，可翻页拿全量（同群实测 50 条 → 1,553 条）。

## 前置条件（缺一个都会失败或导不全）

1. **缓存预热（人工步骤，无法自动化）**：在 Teams 客户端打开每个目标会话，向上滚动到需要导出的最早日期（`Cmd+Home` 直达首条）。从未打开过的群本地缓存为空，导不出来。
2. **Node ≥ 22.5**：`node -v` 检查。没有就 `brew install node@22`；无权限时手动下二进制解压到 `~/node22`（脚本已把两处加进 PATH）。
3. 新版 Teams 桌面端处于登录状态（zaungast 只读本地缓存，不需要 Graph/API key）。

## 操作步骤

1. **看缓存里有什么**：运行 `python3 export_teams.py --list-only`（脚本与本 SKILL.md 同目录）。输出每个会话的消息条数——条数明显偏少的，就是缓存没预热，回第 0 步滚动后重查。
2. **全量导出**：`python3 export_teams.py --output-dir <目标目录>`；只导部分用 `--only "<名字正则>"`。
3. **验证覆盖**：打开输出目录的 `index.md`，逐行核对"最早消息"是否到达预期日期。没到达 → 回 Teams 滚动补缓存 → 重跑（重复消息会自动去重，可安全重跑）。

## 输出约定

- 文件命名：会话名转安全文件名（特殊字符→`_`，保留中文），如 `AI_Chatbot_业务快速沟通群.md`。
- 正文：`### [时间] 发送人` + 消息体；回复折叠为 `↳`；空消息体写 `[图片/视频/多媒体内容]` 占位符。
- `index.md`：`| 文件 | 类型 | 条数 | 最早消息 | 最晚消息 |`。

## 踩坑清单（都是实测踩过的）

1. local-mcp 50 条硬限制、无翻页 —— 见上方"方案选择"。
2. 缓存预热只能人工滚动；滚完务必 `--list-only` 复核条数再导。
3. npm 缓存目录属 root 导致 npx 失败 → 脚本已内置 `npm_config_cache=/tmp/npm-zaungast` 绕过。
4. 分页会返回重叠消息 → 脚本按 `时间:发送人` 去重（实测 3,079 原始 → 1,553 唯一）。
5. **zaungast 时间戳可能不含年份**（`MM-DD HH:MM`）。跨年分析需自行推断年份；跨年同一天同一发送人会误去重，极端情况下知道即可。
6. 游标从响应头 `older:<ts>:<ts>` 提取；若 zaungast 升级改了格式，先 `--list-only` 冒烟。
7. 数据量大时**不要把消息内容经 prompt 传递保存**（烧 token）——一律用脚本直接落盘；分析时也是写脚本处理落盘的 md，而非把内容贴进对话。

## 已知边界

- 仅 macOS 新版 Teams（缓存路径 `~/Library/Containers/com.microsoft.teams2/Data`）。
- 只能导出缓存里有的内容；服务端有而本地没加载的，唯一的桥就是人工滚动。
- 参考笔记：`~/obsidian/AI-Agent/zaungast-teams-export-tool.md`（注意：其中 `conversation_id`/`before` 参数名已过时，实测以本脚本用的 `conversation`/`cursor` 为准）。
