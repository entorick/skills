export default {
  name: 'codex',
  bin: 'codex',
  runArgs(prompt) {
    return ['exec', prompt, '--full-auto'];
  },
  resumeArgs() {
    return ['exec', 'resume', '--last', '继续', '--full-auto'];
  },
};
