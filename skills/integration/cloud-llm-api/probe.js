/* eslint-disable */
/**
 * cloud-llm-api probe.js — 一键探活云端大模型 API
 *
 * 用法:
 *   node probe.js --provider=deepseek --key=sk-xxx
 *   node probe.js --provider=glm --key=xxx.yyy
 *   node probe.js --provider=kimi --key=sk-xxx
 *   node probe.js --provider=baichuan --key=sk-xxx
 *   node probe.js --provider=azure --key=xxx --endpoint=https://xxx.openai.azure.com --deployment=gpt-5.6-sol
 *
 * 输出: 连通性 ✓/✗ + 模型列表（如支持）+ 首个响应样本
 */
const https = require('https');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)=(.*)$/);
  return m ? [m[1], m[2]] : [a.replace(/^--/, ''), 'true'];
}));

const PROVIDERS = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    auth: key => ({ Authorization: `Bearer ${key}` }),
    modelsPath: '/models',
    chatModel: 'deepseek-v4-flash',
    chatBody: { model: 'deepseek-v4-flash', messages: [{ role: 'user', content: '回复ok' }], max_tokens: 16 },
  },
  glm: {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    auth: key => ({ Authorization: `Bearer ${key}` }),
    modelsPath: null, // GLM 不支持 /models
    chatModel: 'glm-5.2',
    chatBody: { model: 'glm-5.2', messages: [{ role: 'user', content: '回复ok' }], max_tokens: 16 },
  },
  kimi: {
    baseUrl: 'https://api.moonshot.cn/v1',
    auth: key => ({ Authorization: `Bearer ${key}` }),
    modelsPath: '/models',
    chatModel: 'kimi-k2.6',
    chatBody: { model: 'kimi-k2.6', messages: [{ role: 'user', content: '回复ok' }], max_tokens: 16, temperature: 1 },
  },
  baichuan: {
    baseUrl: 'https://api.baichuan-ai.com/v1',
    auth: key => ({ Authorization: `Bearer ${key}` }),
    modelsPath: '/models',
    chatModel: 'Baichuan-M3',
    chatBody: { model: 'Baichuan-M3', messages: [{ role: 'user', content: '回复ok' }], max_tokens: 16 },
  },
  azure: {
    auth: key => ({ 'api-key': key }),
    modelsPath: null,
    // Azure 需要 endpoint + deployment
    chatUrl: (endpoint, deployment) => `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=2025-01-01-preview`,
    chatBody: { messages: [{ role: 'user', content: '回复ok' }], max_completion_tokens: 16 },
  },
};

function req(url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const h = { 'Content-Type': 'application/json', ...headers };
    if (data) h['Content-Length'] = Buffer.byteLength(data);
    const r = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: body ? 'POST' : 'GET', headers: h, timeout: 30000 }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(d); } catch { parsed = d.slice(0, 500); }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  const provider = args.provider;
  if (!provider || !PROVIDERS[provider]) {
    console.error('用法: node probe.js --provider=<deepseek|glm|kimi|baichuan|azure> --key=<key> [--endpoint=...] [--deployment=...]');
    process.exit(1);
  }
  const p = PROVIDERS[provider];
  const key = args.key;
  if (!key) { console.error('缺少 --key'); process.exit(1); }
  const headers = p.auth(key);

  console.log(`\n🔍 探活 ${provider}`);

  // 1. 列出模型（如支持）
  if (p.modelsPath) {
    const baseUrl = p.baseUrl;
    try {
      const r = await req(`${baseUrl}${p.modelsPath}`, headers);
      if (r.status === 200 && Array.isArray(r.body.data)) {
        const models = r.body.data.map(m => m.id || m.model).filter(Boolean);
        console.log(`📋 可用模型 (${models.length}): ${models.join(', ')}`);
      } else {
        console.log(`📋 模型列表: HTTP ${r.status}`, typeof r.body === 'string' ? r.body.slice(0, 200) : JSON.stringify(r.body).slice(0, 200));
      }
    } catch (e) {
      console.log(`📋 模型列表: 请求失败 ${e.message}`);
    }
  }

  // 2. 最小 chat 调用
  let chatUrl;
  if (provider === 'azure') {
    if (!args.endpoint || !args.deployment) { console.error('Azure 需要 --endpoint 和 --deployment'); process.exit(1); }
    chatUrl = p.chatUrl(args.endpoint.replace(/\/+$/, ''), args.deployment);
  } else {
    chatUrl = `${p.baseUrl}/chat/completions`;
  }
  try {
    const r = await req(chatUrl, headers, p.chatBody);
    if (r.status === 200 && r.body.choices) {
      const content = r.body.choices[0]?.message?.content || '(空)';
      const reasoning = r.body.choices[0]?.message?.reasoning_content ? ' [含思考]' : '';
      const usage = r.body.usage ? ` prompt=${r.body.usage.prompt_tokens} completion=${r.body.usage.completion_tokens}` : '';
      console.log(`✅ Chat 连通: "${content}"${reasoning}${usage}`);
    } else {
      const errMsg = r.body?.error?.message || r.body?.msg || JSON.stringify(r.body).slice(0, 300);
      console.log(`❌ Chat 失败: HTTP ${r.status} — ${errMsg}`);
    }
  } catch (e) {
    console.log(`❌ Chat 请求错误: ${e.message}`);
  }
  console.log();
}

main().catch(e => { console.error(e); process.exit(1); });
