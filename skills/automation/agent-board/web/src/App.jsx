import React, { useEffect, useState, useCallback } from 'react';
import { api } from './api.js';

const COLUMNS = [
  ['todo', '待办'],
  ['doing', '进行中'],
  ['review', '待审核'],
  ['done', '已完成'],
  ['failed', '失败'],
];

function Board() {
  const [board, setBoard] = useState(null);
  const [form, setForm] = useState({ title: '', cwd: '', agent: '', body: '' });
  const [showForm, setShowForm] = useState(false);
  const refresh = useCallback(() => api.board().then(setBoard), []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!board) return <p>加载中…</p>;

  const onDrop = (e, to) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (id) api.moveCard(id, to).then(refresh);
  };

  const submit = () => {
    api.addCard({ ...form, agent: form.agent || undefined, body: form.body || undefined }).then(() => {
      setForm({ title: '', cwd: '', agent: '', body: '' });
      setShowForm(false);
      refresh();
    });
  };

  return (
    <div>
      <div className="bar">
        <button onClick={() => setShowForm(!showForm)}>{showForm ? '收起' : '+ 新任务'}</button>
        <button onClick={refresh}>刷新</button>
      </div>
      {showForm && (
        <div className="card-form">
          <input placeholder="标题 *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input placeholder="执行目录 cwd *（如 ~/github/xxx）" value={form.cwd} onChange={(e) => setForm({ ...form, cwd: e.target.value })} />
          <select value={form.agent} onChange={(e) => setForm({ ...form, agent: e.target.value })}>
            <option value="">默认 agent</option>
            <option value="codebuddy">codebuddy</option>
            <option value="claude">claude</option>
            <option value="codex">codex</option>
          </select>
          <textarea placeholder="给 agent 的 prompt（缺省用标题）" rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          <button disabled={!form.title || !form.cwd} onClick={submit}>创建</button>
        </div>
      )}
      <div className="board">
        {COLUMNS.map(([col, label]) => (
          <div key={col} className={`col col-${col}`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, col)}>
            <h3>
              {label} <span className="count">{board[col]?.length || 0}</span>
            </h3>
            {(board[col] || []).map((c) => (
              <div key={c.id} className="task" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', c.id)}>
                <div className="task-title">{c.title}</div>
                <div className="task-meta">
                  {c.agent && <span className="tag">{c.agent}</span>}
                  {c.attempts > 0 && <span className="tag warn">重试 {c.attempts}</span>}
                </div>
                {c.bodyPreview && c.bodyPreview !== c.title && <div className="task-body">{c.bodyPreview}</div>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Doctor() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.doctor().then(setData);
  }, []);
  if (!data) return <p>检测中…</p>;
  return (
    <table className="table">
      <tbody>
        {data.checks.map((c) => (
          <tr key={c.name} className={c.ok ? 'ok' : c.level === 'required' ? 'bad' : ''}>
            <td>{c.ok ? '✓' : c.level === 'required' ? '✗' : '·'}</td>
            <td>{c.name}</td>
            <td>{c.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Skills() {
  const [skills, setSkills] = useState(null);
  const [log, setLog] = useState('');
  useEffect(() => {
    api.skills().then(setSkills);
  }, []);
  if (!skills) return <p>加载中…</p>;
  return (
    <div>
      <div className="bar">
        <button
          onClick={() => api.installSkills().then((r) => setLog(r.output || r.error || 'done'))}
        >
          安装全部技能（symlink 到已检测的 agent）
        </button>
      </div>
      {log && <pre className="log">{log}</pre>}
      <table className="table">
        <tbody>
          {skills.map((s) => (
            <tr key={`${s.category}/${s.name}`}>
              <td>{s.category}</td>
              <td>
                <b>{s.name}</b>
              </td>
              <td>{s.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Settings() {
  const [cfg, setCfg] = useState(null);
  const [msg, setMsg] = useState('');
  const [hookLog, setHookLog] = useState('');
  useEffect(() => {
    api.config().then(setCfg);
  }, []);
  if (!cfg) return <p>加载中…</p>;
  const set = (path, value) => {
    const next = structuredClone(cfg);
    const keys = path.split('.');
    let o = next;
    for (const k of keys.slice(0, -1)) o = o[k];
    o[keys.at(-1)] = value;
    setCfg(next);
  };
  const save = () => api.saveConfig(cfg).then(() => setMsg('已保存'));
  return (
    <div className="settings">
      <h3>通知（钉钉）</h3>
      <label>
        webhook
        <input value={cfg.notify.dingtalk_webhook} onChange={(e) => set('notify.dingtalk_webhook', e.target.value)} />
      </label>
      <label>
        @ 手机号
        <input value={cfg.notify.at_mobile} onChange={(e) => set('notify.at_mobile', e.target.value)} />
      </label>
      <label>
        机器人安全关键词（若机器人设了"自定义关键词"必填）
        <input value={cfg.notify.keyword || ''} onChange={(e) => set('notify.keyword', e.target.value)} />
      </label>
      <label>
        <input type="checkbox" checked={cfg.notify.on_review} onChange={(e) => set('notify.on_review', e.target.checked)} /> 任务完成（待审核）时通知
      </label>
      <label>
        <input type="checkbox" checked={cfg.notify.on_failed} onChange={(e) => set('notify.on_failed', e.target.checked)} /> 任务失败时通知
      </label>
      <label>
        <input type="checkbox" checked={cfg.notify.on_session_stop} onChange={(e) => set('notify.on_session_stop', e.target.checked)} /> 交互 session 结束时通知
      </label>
      <h3>执行</h3>
      <label>
        默认 agent
        <select value={cfg.default_agent} onChange={(e) => set('default_agent', e.target.value)}>
          <option value="codebuddy">codebuddy</option>
          <option value="claude">claude</option>
          <option value="codex">codex</option>
        </select>
      </label>
      <label>
        最大重试次数
        <input type="number" min="1" max="20" value={cfg.retry.max_attempts} onChange={(e) => set('retry.max_attempts', Number(e.target.value))} />
      </label>
      <div className="bar">
        <button onClick={save}>保存</button>
        <button onClick={() => api.notifyTest().then((r) => setMsg(r.ok ? '测试消息已发送 ✓' : `失败：${r.reason || JSON.stringify(r)}`))}>发测试消息</button>
        <span>{msg}</span>
      </div>
      <h3>Hooks（完成通知 / 429 自动重试）</h3>
      <div className="bar">
        <button onClick={() => api.hooks('enable').then((r) => setHookLog(r.results.map((x) => `${x.agent}: ${x.detail}`).join('\n')))}>启用</button>
        <button onClick={() => api.hooks('disable').then((r) => setHookLog(r.results.map((x) => `${x.agent}: ${x.detail}`).join('\n')))}>停用</button>
      </div>
      {hookLog && <pre className="log">{hookLog}</pre>}
    </div>
  );
}

const TABS = [
  ['board', '看板'],
  ['doctor', '环境'],
  ['skills', '技能'],
  ['settings', '设置'],
];

export default function App() {
  const [tab, setTab] = useState('board');
  return (
    <div className="app">
      <header>
        <h1>agent-board</h1>
        <nav>
          {TABS.map(([key, label]) => (
            <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {tab === 'board' && <Board />}
        {tab === 'doctor' && <Doctor />}
        {tab === 'skills' && <Skills />}
        {tab === 'settings' && <Settings />}
      </main>
    </div>
  );
}
