export default {
  name: 'claude',
  bin: 'claude',
  runArgs(prompt) {
    return ['-p', prompt, '--dangerously-skip-permissions'];
  },
  resumeArgs() {
    return ['-c', '-p', '继续', '--dangerously-skip-permissions'];
  },
};
