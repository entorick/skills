---
name: skill-mining
description: 定期回顾本机 CLI agent 工作记录（CodeBuddy/Claude Code 历史、shell 历史），识别值得沉淀为 skill 的重复手工流程。触发词：回顾工作记录、找可沉淀的流程、skill 挖掘、哪些流程值得自动化。
---

# Skill Mining — 从工作记录挖掘可沉淀流程

建议每月跑一次。目标：找出重复发生、耗时、易错、上下文重的手工流程，裁决后沉淀进本仓库。

## SOP

### 1. 扫描：生成摘要

运行本目录的 `scan_history.py`（默认 30 天窗，`-o digest.md` 落盘）。摘要聚合 5 类源：

- CodeBuddy 全部 prompt 历史
- Claude Code 各项目会话的用户 prompt（按项目分组）
- shell 手工命令，**连续重试运行标 ⚠×N** —— 这是最强的人工痛点信号，优先看（判例：`git clone` 连续重试 20 次 → 代理问题）
- memory 库存、已安装 skills —— 避免重复提议

摘要之外，对重点项目可再读该项目的 git log / 大 transcript 补证据。

### 2. 识别候选信号

命中越多越值得沉淀：

- **重复 ≥3 次**（md2word 判例：同一需求出现 4 次才沉淀，前 3 次每次手工转换都丢 `** **` 加粗）
- **每次都犯同样的错**（用户原话特征："之前每次都遗漏"）
- **耗时/耗 token**：超大会话、大量 subagent
- **上下文重**：每次都要重新解释背景、路径、人员名单
- **流程固定**：步骤序列跨次稳定，可写成 SOP
- **方案已收敛**：工具链不再更换

### 3. 裁决：业务耦合度测试（核心取舍）

对每个候选问一句：**离开当前项目，它还能跑吗？**

| 情况 | 处置 |
|------|------|
| 纯工具链、无业务判断 | **优先沉淀为 skill**（判例：teams-chat-export） |
| 依赖特定项目的代码库/人员/口径/系统实例 | 不做通用 skill。业务知识/教训 → memory；写作口径/责任人 → 项目 playbook 或 CLAUDE.md；只有骨架可迁移且确有多项目需求时，才做成"通用框架 + 业务配置文件" |
| 方案未定型（工具还在换） | 观察项，暂缓（判例：teams 导出在 zaungast 收敛前不沉淀） |
| 一次性任务（打包 zip 等） | 不沉淀 |
| 已在 skills 库存或 memory 中 | 不重复提议 |

### 4. 报告

输出候选表交用户裁决，**不要自行全做**：

```
| 候选 | 证据（日期/次数） | 痛点 | 建议形态（skill/playbook/memory/脚本） | 优先级 |
```

已沉淀的 skill 也列一行作为对照（验证"重复 N 次才沉淀"的判例价值）。

### 5. 沉淀执行（仅对用户批准的候选）

按本仓库 CLAUDE.md "Adding a New Skill" 流程。要点：

- 从实战脚本/会话通用化：去硬编码路径、去项目专属逻辑（判例：export_teams.py 去掉写死的输出目录和项目专属报表）
- 补上当时缺的检查能力（判例：`--list-only` 先看缓存覆盖再决定要不要手动操作）
- 解析层必须有 pytest（fixture 驱动，不依赖真实外部服务）
- 踩坑清单进 SKILL.md，每条注明实测日期
- `scripts/validate.py` 全绿（本机注意：默认 `python3` 是 3.6 会崩，用 `python3.10 scripts/validate.py`）→ `install.sh` 挂 symlink
- conventional commit（`feat(<skill>): ...`）；**默认留用户 review，用户明说"直接提交"才 commit/push**
