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

## 目录导览

| 路径 | 作用 |
|------|------|
| `skills/<类别>/<技能名>/` | 技能本体：SKILL.md（定义）+ 脚本 + 测试 |
| `index.md` | 技能注册表 |
| `install.sh` | 一键安装/卸载（`--remove`） |
| `scripts/validate.py` | 提交前校验：frontmatter、注册表同步、跑各技能测试 |
| `templates/` | 新技能模板 |
| `CLAUDE.md` | 给 agent 看的仓库指引（结构、创建技能、迭代规范） |

## 当前技能

见 [index.md](index.md)。

## 协作约定

- 改完跑 `./scripts/validate.py`，全绿再提交（CI 会跑同样的检查）
- 提交用 conventional commits，按技能 scope：`fix(zentao): ...`
- 凭证类文件（如 `.config.json`）只进 `.gitignore`，永不提交
