export default {
  name: 'codebuddy',
  bin: 'codebuddy',
  /** First run: headless print mode, unattended permissions. */
  runArgs(prompt) {
    return ['-p', prompt, '--permission-mode', 'auto'];
  },
  /** Retry: continue previous session, keep context. */
  resumeArgs() {
    return ['-c', '-p', '继续', '--permission-mode', 'auto'];
  },
};
