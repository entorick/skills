async function req(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return res.json();
}

export const api = {
  board: () => req('/api/board'),
  doctor: () => req('/api/doctor'),
  skills: () => req('/api/skills'),
  config: () => req('/api/config'),
  saveConfig: (cfg) => req('/api/config', { method: 'POST', body: JSON.stringify(cfg) }),
  addCard: (card) => req('/api/cards', { method: 'POST', body: JSON.stringify(card) }),
  moveCard: (id, to) => req(`/api/cards/${id}/move`, { method: 'POST', body: JSON.stringify({ to }) }),
  notifyTest: () => req('/api/notify-test', { method: 'POST' }),
  installSkills: () => req('/api/skills/install', { method: 'POST' }),
  hooks: (action, agent) => req(`/api/hooks/${action}`, { method: 'POST', body: JSON.stringify(agent ? { agent } : {}) }),
};
