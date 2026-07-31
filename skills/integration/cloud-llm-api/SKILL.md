---
name: cloud-llm-api
description: 调用国内云端大模型 API（DeepSeek / 智谱 GLM / Moonshot Kimi / 百川 / Azure OpenAI）—— endpoint、模型名、认证方式、思考开关、温度限制、上下文上限等实测坑点。触发词：调用 DeepSeek/GLM/Kimi/百川 API、云端大模型 API、cloud llm api、openai 兼容接口、thinking mode、enable_thinking。提供 key 即可直接调用，不用查文档。
allowed-tools: Bash(node:*), Bash(curl:*), Bash(npm:*)
---

# 云端大模型 API 调用手册（实测 2026-07）

本 skill 沉淀了 5 家云端大模型 API 的实测调用经验。**提供 API key 即可直接调用**，无需查文档。配套脚本 `probe.js`（与本 SKILL.md 同目录）可一键探活。

## 快速参考表

| 供应商 | baseUrl | 认证 | 代表模型 | 上下文 | 温度限制 | 关思考参数 |
|--------|---------|------|----------|--------|----------|------------|
| DeepSeek | `https://api.deepseek.com/v1` | `Authorization: Bearer <key>` | `deepseek-v4-flash` / `deepseek-v4-pro` | 1M | 思考模式忽略 temperature | `thinking:{type:"disabled"}` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `Authorization: Bearer <key>` | `glm-5.2` | 1M | 无限制 | `thinking:{type:"disabled"}` |
| Moonshot Kimi | `https://api.moonshot.cn/v1` | `Authorization: Bearer <key>` | `kimi-k2.6` / `kimi-k2.7-code` | 256K | **只允许 temperature=1** | **`enable_thinking:false`**（不是 thinking:type:disabled） |
| 百川 | `https://api.baichuan-ai.com/v1` | `Authorization: Bearer <key>` | `Baichuan-M3` / `Baichuan-M2` | **仅 ~10K**（必须拆批） | 无限制 | 关不掉（budget_tokens 风格） |
| Azure OpenAI | `https://<resource>.openai.azure.com/openai` | `api-key: <key>`（header） | deployment 名（非模型名） | 视 deployment | gpt-5.x 不设 temperature | `reasoning_effort=none` |

## 各供应商详解

### DeepSeek

- **Base URL**: `https://api.deepseek.com/v1`（或 `https://api.deepseek.com`，`/v1` 可省略）
- **模型**: `deepseek-v4-flash`（便宜快）、`deepseek-v4-pro`（强但贵 3×）
- **思考模式**: 默认开启；关思考发 `thinking: {"type": "disabled"}`
- **温度**: 思考模式下 temperature 被忽略（设了不报错但无效）；非思考模式正常使用
- **max_tokens**: 最大输出 384K，建议设 32768
- **并发限制**: flash 2500 RPM、pro 500 RPM
- **价格**（2026-07）: flash $0.14/M input(cache miss) + $0.28/M output；pro $0.435/M + $0.87/M

```bash
# 最小调用
curl https://api.deepseek.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -d '{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"ok"}],"max_tokens":16}'

# 关思考
curl https://api.deepseek.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -d '{"model":"deepseek-v4-pro","messages":[{"role":"user","content":"ok"}],"max_tokens":16,"thinking":{"type":"disabled"}}'

# 列出可用模型
curl https://api.deepseek.com/v1/models -H "Authorization: Bearer $DEEPSEEK_API_KEY"
```

### 智谱 GLM

- **Base URL**: `https://open.bigmodel.cn/api/paas/v4`
- **模型**: `glm-5.2`（最新旗舰）、`glm-5.1`（需单独购买资源包，余额不足时报 error 1113）
- **思考模式**: 默认开启（completion 含 reasoning_content + reasoning_tokens）；关思考发 `thinking: {"type": "disabled"}`
- **max_tokens**: 最大输出 128K，建议设 32768（思考模式 completion 可达 2 万 token/题）
- **注意**: glm-5.1 和 glm-5.2 是**独立计费**的——5.2 有余额不代表 5.1 可用

```bash
curl https://open.bigmodel.cn/api/paas/v4/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GLM_API_KEY" \
  -d '{"model":"glm-5.2","messages":[{"role":"user","content":"ok"}],"max_tokens":16}'

# 关思考
curl https://open.bigmodel.cn/api/paas/v4/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GLM_API_KEY" \
  -d '{"model":"glm-5.2","messages":[{"role":"user","content":"ok"}],"max_tokens":16,"thinking":{"type":"disabled"}}'
```

### Moonshot Kimi

- **Base URL**: `https://api.moonshot.cn/v1`
- **模型**: `kimi-k2.6`（通用，支持开/关思考）、`kimi-k2.7-code`（编程专用，**强制思考关不掉**）、`kimi-k3`（最强但贵，用户通常不用）
- **温度**: **只允许 temperature=1**（思考模式）。关思考模式下允许 temperature=0.6。传 0 或其他值会 HTTP 400
- **关思考**: 必须用 `enable_thinking: false`（DashScope 风格）。**不要用** `thinking: {"type": "disabled"}`——Kimi 会报 HTTP 400「invalid temperature: only 0.6 is allowed」，此报错文案有误导性（实际是 thinking 参数格式不对）
- **TPM 限制**: 账号级约 383895 token/分钟。全量 prompt ~150K/case 时，concurrency≥3 易撞 429。建议 concurrency=2
- **引擎过载**: 间歇性返回 429 `engine_overloaded_error`（非配额问题，服务端容量），需停跑等恢复（通常 10-30 分钟）
- **账号 suspend**: 余额耗尽时账号被 suspend，充值后恢复

```bash
# 调用（必须 temperature=1）
curl https://api.moonshot.cn/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MOONSHOT_API_KEY" \
  -d '{"model":"kimi-k2.6","messages":[{"role":"user","content":"ok"}],"max_tokens":16,"temperature":1}'

# 关思考（用 enable_thinking，不是 thinking:type:disabled）
curl https://api.moonshot.cn/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MOONSHOT_API_KEY" \
  -d '{"model":"kimi-k2.6","messages":[{"role":"user","content":"ok"}],"max_tokens":16,"temperature":1,"enable_thinking":false}'

# 列出可用模型（含 context_length、supports_reasoning 等元数据）
curl https://api.moonshot.cn/v1/models -H "Authorization: Bearer $MOONSHOT_API_KEY"
```

### 百川

- **Base URL**: `https://api.baichuan-ai.com/v1`
- **模型**:
  - `Baichuan-M3`（医疗旗舰，2026-01）、`Baichuan-M2`（2025-08）——输入上限仅 ~10240 token
  - `Baichuan4-Turbo`（通用，32K 上下文）、`Baichuan4`、`Baichuan4-Air`
  - `Baichuan3-Turbo-128k`（128K 上下文，适合长 prompt）
- **思考模式**: M3 默认开思考（输出含 reasoning_content），**关不掉**——传 `thinking: {"type": "disabled"}` 会报 `budget_tokens is null`；传 `enable_thinking: false` 无效。M2 无思考
- **输入上限**: M3/M2 仅 ~10240 token（实测 batchSize≥4 会 HTTP 500 `llm_eng_error`）。长 prompt 必须拆批：M3 用 batchSize=3（29批/case），M2 用 batchSize=4（22批/case）
- **max_tokens**: M3/M2 最大 32768；Baichuan4 系列仅 2048
- **价格**（2026-07）: M3 输入 0.01 元/千token + 输出 0.03 元/千token；M2 输入 0.002 + 输出 0.02

```bash
# 最小调用
curl https://api.baichuan-ai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $BAICHUAN_API_KEY" \
  -d '{"model":"Baichuan-M3","messages":[{"role":"user","content":"ok"}],"max_tokens":16}'

# 列出可用模型（含 max_input_length、max_tokens）
curl https://api.baichuan-ai.com/v1/models -H "Authorization: Bearer $BAICHUAN_API_KEY"
```

### Azure OpenAI

- **Endpoint**: `https://<resource-name>.openai.azure.com/openai`
- **认证**: header `api-key: <key>`（不是 Bearer）
- **模型**: Azure 用 **deployment 名**而非模型名。URL 路径含 deployment：`/openai/deployments/<deployment-name>/chat/completions?api-version=2025-01-01-preview`
- **推理模型 (gpt-5.x)**: 用 `max_completion_tokens`（不含 `max_tokens`），不设 `temperature`；`reasoning_effort` 支持 `none`/`low`/`medium`/`high`（gpt-5.1 默认 none，须显式开 medium/high 否则秒回空）
- **非推理模型 (gpt-4o)**: 用 `max_tokens` + `temperature=0`
- **关思考**: `reasoning_effort=none`（等价于关思考）
- **脚本适配**: eval 脚本按 deployment 名自动区分推理/非推理：`/^gpt-4o/i` → 非推理参数，其余 → 推理参数

```bash
# gpt-5.x（推理模型）
curl "https://<resource>.openai.azure.com/openai/deployments/<deployment>/chat/completions?api-version=2025-01-01-preview" \
  -H "Content-Type: application/json" \
  -H "api-key: $AZURE_OPENAI_API_KEY" \
  -d '{"messages":[{"role":"user","content":"ok"}],"max_completion_tokens":32768,"reasoning_effort":"medium"}'

# gpt-4o（非推理）
curl "https://<resource>.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2025-01-01-preview" \
  -H "Content-Type: application/json" \
  -H "api-key: $AZURE_OPENAI_API_KEY" \
  -d '{"messages":[{"role":"user","content":"ok"}],"max_tokens":16000,"temperature":0}'
```

## 坑点速查

| 坑 | 供应商 | 现象 | 解决 |
|----|--------|------|------|
| temperature=0 被 400 拒 | Kimi | `invalid temperature: only 1 is allowed` | 思考模式必须 `temperature=1` |
| thinking:disabled 被 400 拒 | Kimi | `invalid temperature: only 0.6 is allowed`（文案误导） | 改用 `enable_thinking:false` |
| batchSize≥4 HTTP 500 | 百川 M3 | `llm_eng_error Internal Server Error` | 降到 batchSize=3 |
| 余额不足但 error 1113 | GLM | `余额不足或无可用资源包` | 5.1/5.2 独立计费，5.2 有余额不代表 5.1 可用 |
| gpt-5.1 秒回空 | Azure | `finish_reason: stop` 但 content 为空 | 默认 `reasoning_effort=none`，须显式设 `medium` |
| 账号 suspend | Kimi | `account is suspended due to insufficient balance` | 充值后恢复 |
| 引擎过载 | Kimi | `engine_overloaded_error`（非配额） | 停跑等 10-30 分钟，不要硬闯 |
| thinking:disabled 报 budget_tokens | 百川 M3 | `The property budget_tokens is null` | M3 思考关不掉，不要传 thinking 参数 |

## 配套脚本：probe.js

`probe.js`（与本 SKILL.md 同目录）一键探活：给定供应商 + key，发送最小请求验证连通性，并打印可用模型列表。

```bash
# 用法
node probe.js --provider=deepseek --key=sk-xxx
node probe.js --provider=glm --key=xxx.yyy
node probe.js --provider=kimi --key=sk-xxx
node probe.js --provider=baichuan --key=sk-xxx
node probe.js --provider=azure --key=xxx --endpoint=https://xxx.openai.azure.com --deployment=gpt-5.6-sol
```

## OpenAI 兼容接口适配要点

DeepSeek / GLM / Kimi / 百川均兼容 OpenAI Chat Completions 格式（`/v1/chat/completions`），但有以下差异需注意：

1. **关思考参数不统一**: DeepSeek/GLM 用 `thinking:{"type":"disabled"}`，Kimi 用 `enable_thinking:false`，百川关不掉。脚本需按供应商切换参数风格
2. **temperature 限制**: Kimi 强制 temperature=1（思考模式）；其余供应商无限制
3. **max_tokens 上限**: 各家不同（百川 M4 系列仅 2048，DeepSeek 384K），超限不报错但被截断
4. **models 列表端点**: DeepSeek/Kimi/百川 支持 `GET /v1/models`；GLM 不支持（需查文档）
5. **速率限制**: Kimi 有账号级 TPM（~383895）；DeepSeek 有 RPM（flash 2500/pro 500）；百川/GLM 无明确文档
