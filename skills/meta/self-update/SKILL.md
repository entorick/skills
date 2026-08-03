---
name: self-update
description: 从远端仓库 origin/main 拉取最新技能并重挂 symlink。触发词：更新技能、技能升级、拉最新 skills、同步技能库、self-update。
---

# Self-Update — 拉取技能库最新版本

让本机技能库与云端 `origin/main` 保持同步的唯一通道。

**只运行脚本 `scripts/self-update.sh`，不要用 curl/下载等其他方式更新**——更新通道只能是 git，这样本仓库的 symlink 迭代闭环才不被破坏。

## 执行

```bash
cd <本仓库根目录>            # 含 install.sh 的目录
./scripts/self-update.sh
```

脚本会自动处理：

1. `git fetch origin`（走仓库已配置的 SSH remote，私有仓库无需额外认证）
2. 若当前在 feature 分支且工作区干净，先切到 `main`；工作区脏则拒绝并提示
3. 用 git commit SHA（而非时间戳）对比本地 `main` 与 `origin/main`：
   - 一致 → 打印 "Up to date"，退出
   - 落后 → `git pull --ff-only`（只快进，绝不产生 merge commit）
4. 工作区有未提交改动时：自动 `git stash -u` → 拉取 → `git stash pop`；pop 冲突则停下并打印恢复命令，绝不静默丢改动
5. 拉取后重跑 `install.sh`，同步新增/改名/删除技能的 symlink

## 报告

运行完向用户报告：

- 拉了多少个提交（或 up to date）
- 若脚本拒绝执行，说明原因（未提交改动 / 本地领先未推送 / 网络失败）和下一步命令

## 注意

- 本地 `main` 领先 `origin/main`（有未推送提交）时脚本拒绝合并——先 push 再更新
- 更新后停留在 `main` 分支；如需回到原 feature 分支自行 `git checkout`
