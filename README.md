# skills

我的个人 agent 技能库 —— AI 时代，人人都有自己的 agent。

这个仓库是我与 CLI agent（Claude Code / CodeBuddy / Codex）协同工作的"数字化分身"：
别人交给我的工作，agent 先通过这里的技能做一遍，我作为 mentor 拍板和纠偏。
每个任务中遇到的错误都会沉淀回这个仓库，让它跟着我一起成长。

## 新机器 bootstrap

```bash
git clone https://github.com/entorick/skills.git
cd skills
./install.sh        # 把所有技能 symlink 到 ~/.claude/skills 和 ~/.codebuddy/skills
```

symlink 而非拷贝：agent 在任务中迭代技能 = 直接修改本仓库，`git diff` 可见，commit 即沉淀。

## 更新技能到最新

```bash
./scripts/self-update.sh    # 从 origin/main 拉取最新技能并重挂 symlink
```

或直接让 agent 用 `self-update` 技能。脚本用 git SHA 对比远端、`--ff-only` 快进拉取，
工作区有未提交改动时自动 stash→拉取→pop，绝不静默丢数据。

## CLI agent 完成通知

给本机各 CLI agent 工具（CodeBuddy / Claude Code / Codex / OpenCode）注入「会话完成 → 钉钉通知」：

```bash
node scripts/agent-notify/cli.js install      # 检测已安装的 agent，自动注入 hook
node scripts/agent-notify/cli.js notify-test  # 发一条测试消息验证
node scripts/agent-notify/cli.js status       # 查看检测结果与钉钉配置
```

webhook 读取 `~/agent-board/config.json` 的 notify 字段（每机一份，不进 git）。

## 目录导览

| 路径 | 作用 |
|------|------|
| `skills/<类别>/<技能名>/` | 技能本体：SKILL.md（定义）+ 脚本 + 测试 |
| `index.md` | 技能注册表 |
| `install.sh` | 一键安装/卸载（`--remove`），自动清理指向已删技能的断链 |
| `scripts/validate.py` | 提交前校验：frontmatter、注册表同步、跑各技能测试 |
| `scripts/self-update.sh` | 从 origin/main 拉取最新技能并重挂 symlink |
| `scripts/agent-notify/` | CLI agent 完成通知安装器（零依赖 Node，钉钉 hook） |
| `templates/` | 新技能模板 |
| `CLAUDE.md` | 给 agent 看的仓库指引（结构、创建技能、迭代规范） |

## 当前技能

见 [index.md](index.md)。

## 协作约定

- 改完跑 `./scripts/validate.py`，全绿再提交（CI 会跑同样的检查）
- 提交用 conventional commits，按技能 scope：`fix(zentao): ...`
- 凭证类文件（如 `.config.json`）只进 `.gitignore`，永不提交
