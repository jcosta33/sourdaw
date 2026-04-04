import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const DEFAULTS = {
  defaultBaseBranch: 'main',
  worktreeDirPattern: '../{repoName}--{slug}',
  defaultTerminal: 'auto',
  defaultAgent: 'claude',
  agents: {
    claude: { command: 'claude', args: [] },
    gemini: { command: 'gemini', args: [] },
    codex: { command: 'codex', args: [] },
  },
  reuseExistingByDefault: true,
  writeTaskTemplateOnCreate: true,
  openTaskFileInBanner: true,
  allowSparseCheckout: false,
  slugMaxLen: 60,
};

/**
 * Load and merge scripts/agents/config.json with defaults.
 * @param {string} repoRoot
 * @returns {object}
 */
export function loadConfig(repoRoot) {
  const configPath = join(repoRoot, 'scripts', 'agents', 'config.json');
  if (!existsSync(configPath)) {
    return { ...DEFAULTS };
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (e) {
    throw new Error(`Config file invalid JSON at ${configPath}: ${e.message}`);
  }
  return {
    ...DEFAULTS,
    ...raw,
    agents: { ...DEFAULTS.agents, ...(raw.agents || {}) },
  };
}
