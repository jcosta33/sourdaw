#!/usr/bin/env node
/**
 * agents.mjs — local multi-agent workspace launcher
 *
 * Usage:
 *   node scripts/agents.mjs <subcommand> [options]
 *
 * Subcommands: new, open, list, show, task, remove, prune, doctor, path, focus, pick
 */

import { existsSync, mkdirSync, unlinkSync, readFileSync, writeFileSync, accessSync, constants } from 'fs';
import { join, resolve, isAbsolute } from 'path';
import { spawnSync, spawn } from 'child_process';

import { loadConfig } from './agents/config.mjs';
import { toSlug, deriveNames, nextDuplicateSlug } from './agents/slug.mjs';
import {
  getRepoRoot, getRepoName,
  worktreeList, findWorktreeForBranch, worktreeCreate, worktreeRemove,
  worktreePrune, isWorktreeDirty, getStatusSummary, gitAvailable,
} from './agents/git.mjs';
import { createOrUpdateTaskFile } from './agents/template.mjs';
import { resolveBackend, launch, checkBackend } from './agents/terminal.mjs';

// ─── Argument parser ─────────────────────────────────────────────────────────

// Flags that never consume the next argument
const BOOLEAN_FLAGS = new Set([
  'no-launch', 'json', 'duplicate', 'force', 'dirty-only', 'sparse',
]);

/**
 * Minimal arg parser — no external deps.
 * Handles --flag, --flag value, and --flag=value forms.
 * Returns { flags: Map<string, string|true>, positional: string[] }
 */
function parseArgs(argv) {
  const flags = new Map();
  const positional = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--') {
      // POSIX end-of-flags sentinel — everything after is positional
      for (let j = i + 1; j < argv.length; j++) positional.push(argv[j]);
      break;
    }
    if (arg.startsWith('--')) {
      // Handle --key=value
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        const val = arg.slice(eqIdx + 1);
        flags.set(key, val);
        i++;
        continue;
      }
      const key = arg.slice(2);
      const isBoolean = BOOLEAN_FLAGS.has(key);
      const next = argv[i + 1];
      if (isBoolean || !next || next.startsWith('--')) {
        flags.set(key, true);
      } else {
        flags.set(key, next);
        i++;
      }
    } else {
      positional.push(arg);
    }
    i++;
  }
  return { flags, positional };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function die(msg) {
  console.error(`\nError: ${msg}\n`);
  process.exit(1);
}

function warn(msg) {
  console.warn(`Warning: ${msg}`);
}

async function loadAdapter(agentName) {
  const allowed = ['claude', 'gemini', 'codex'];
  if (!allowed.includes(agentName)) {
    die(`Unknown agent "${agentName}". Supported: ${allowed.join(', ')}`);
  }
  return import(`./agents/adapters/${agentName}.mjs`);
}

function ensureRuntimeDirs(repoRoot) {
  const abs = join(repoRoot, '.agents/tasks');
  if (!existsSync(abs)) mkdirSync(abs, { recursive: true });
}

/**
 * List all agent worktrees as { slug, branch, path } objects.
 * Derived from git worktrees with an agent/* branch.
 */
function listAgentWorktrees(repoRoot) {
  return worktreeList(repoRoot)
    .filter(w => w.branch && w.branch.startsWith('agent/'))
    .map(w => ({ slug: w.branch.slice(6), branch: w.branch, path: w.path }));
}

/**
 * Find the worktree path for a slug. Returns null if not checked out.
 */
function findWorktreePath(slug, repoRoot) {
  return findWorktreeForBranch(`agent/${slug}`, repoRoot);
}

function resolveWorktreePath(pattern, repoRoot) {
  return isAbsolute(pattern) ? pattern : resolve(repoRoot, pattern);
}

function agentCommandAvailable(cmd) {
  const result = spawnSync('which', [cmd], { encoding: 'utf8', stdio: 'pipe' });
  return result.status === 0;
}

function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

function formatTable(rows, cols) {
  const widths = cols.map((_, ci) => Math.max(...rows.map(r => (r[ci] || '').length), cols[ci].length));
  const header = cols.map((c, i) => c.padEnd(widths[i])).join('  ');
  const sep = widths.map(w => '-'.repeat(w)).join('  ');
  const body = rows.map(r => cols.map((_, i) => (r[i] || '').padEnd(widths[i])).join('  '));
  return [header, sep, ...body].join('\n');
}

const KNOWN_AGENTS = ['claude', 'gemini', 'codex'];

// ─── Subcommand: new ─────────────────────────────────────────────────────────

async function cmdNew(argv) {
  const { flags, positional } = parseArgs(argv);

  let agentFromPositional = null;
  let titlePositional = positional;

  // Allow: agents new claude "Fix auth redirect loop"
  if (positional.length > 0 && KNOWN_AGENTS.includes(positional[0])) {
    agentFromPositional = positional[0];
    titlePositional = positional.slice(1);
  }

  const title = titlePositional.join(' ').trim();

  if (!title) {
    die('Usage: agents new [claude|gemini|codex] "Task title"\n\nProvide a human-readable task title.');
  }

  const repoRoot = getRepoRoot();
  const repoName = getRepoName(repoRoot);
  const config = loadConfig(repoRoot);
  ensureRuntimeDirs(repoRoot);

  const agentName = flags.get('agent') || agentFromPositional || config.defaultAgent;
  const baseBranch = flags.get('base') || config.defaultBaseBranch;
  const terminal = flags.get('terminal') || config.defaultTerminal;
  const noLaunch = flags.has('no-launch');
  const duplicate = flags.has('duplicate');
  const suffix = flags.get('suffix') || '';
  const agentArgsRaw = flags.get('agent-args') || '';
  const jsonOutput = flags.has('json');
  const maxLen = config.slugMaxLen || 60;

  let slug = toSlug(title, maxLen);
  if (suffix) slug = `${slug}-${toSlug(suffix, 20)}`;

  const templateDir = join(repoRoot, '.agents', 'templates');

  // Handle duplicate mode — find next available slug using git worktrees
  if (duplicate) {
    const existingSlugs = new Set(listAgentWorktrees(repoRoot).map(w => w.slug));
    if (existingSlugs.has(slug)) slug = nextDuplicateSlug(slug, existingSlugs);
  }

  const names = deriveNames(slug, repoName, config);
  const worktreeAbs = resolveWorktreePath(names.worktreePath, repoRoot);

  // Check if branch already checked out somewhere
  const existingWT = findWorktreeForBranch(names.branch, repoRoot);
  if (existingWT) {
    if (config.reuseExistingByDefault && !duplicate) {
      if (!jsonOutput) console.log(`Sandbox "${slug}" already exists — reopening.\n`);
      const reopenArgs = [slug, '--agent', agentName];
      if (noLaunch) reopenArgs.push('--no-launch');
      if (jsonOutput) reopenArgs.push('--json');
      if (flags.has('terminal')) reopenArgs.push('--terminal', terminal);
      return cmdOpen(reopenArgs);
    }
    if (existingWT !== worktreeAbs) {
      die(
        `Branch "${names.branch}" is already checked out at:\n  ${existingWT}\n\n` +
        `Use --duplicate to create a separate sandbox, or:\n  npm run agents:open -- ${slug}`
      );
    }
  }

  // Create worktree if it doesn't exist
  if (!existsSync(worktreeAbs)) {
    if (!jsonOutput) console.log(`Creating worktree at ${worktreeAbs}...`);
    try {
      worktreeCreate(worktreeAbs, names.branch, baseBranch, repoRoot);
    } catch (e) {
      die(`Failed to create worktree:\n  ${e.message}\n\nPath: ${worktreeAbs}\nBranch: ${names.branch}`);
    }
  } else {
    if (!jsonOutput) console.log(`Worktree already exists at ${worktreeAbs}`);
  }

  // Create task file
  const taskFileAbs = join(repoRoot, names.taskFile);
  if (config.writeTaskTemplateOnCreate) {
    createOrUpdateTaskFile(taskFileAbs, templateDir, {
      title, slug, agent: agentName,
      branch: names.branch, baseBranch,
      worktreePath: names.worktreePath,
      taskFile: names.taskFile,
      createdAt: new Date().toISOString(),
    });
  }

  if (jsonOutput) {
    printJson({ slug, branch: names.branch, worktreePath: worktreeAbs, taskFile: names.taskFile });
    if (noLaunch) return;
  } else {
    console.log(`\nCreated sandbox: ${slug}`);
    console.log(`  Branch:    ${names.branch}`);
    console.log(`  Worktree:  ${worktreeAbs}`);
    console.log(`  Task file: ${names.taskFile}`);
    if (noLaunch) {
      console.log('\n(--no-launch: skipping terminal open)');
      return;
    }
    console.log('');
  }

  await openAt({ slug, title, agentName, terminal, repoRoot, worktreeAbs, names, agentArgsRaw });
}

// ─── Subcommand: open ────────────────────────────────────────────────────────

async function cmdOpen(argv) {
  const { flags, positional } = parseArgs(argv);

  // Allow: agents open claude fix-auth-redirect-loop  OR  agents open fix-auth-redirect-loop claude
  let agentFromPositional = null;
  let slugPositional = positional;

  if (positional.length >= 2 && KNOWN_AGENTS.includes(positional[0])) {
    agentFromPositional = positional[0];
    slugPositional = positional.slice(1);
  } else if (positional.length >= 2 && KNOWN_AGENTS.includes(positional[1])) {
    agentFromPositional = positional[1];
    slugPositional = [positional[0]];
  }

  const slug = slugPositional[0];
  if (!slug) die('Usage: agents open <slug> [claude|gemini|codex]');

  const repoRoot = getRepoRoot();
  const config = loadConfig(repoRoot);
  ensureRuntimeDirs(repoRoot);

  const worktreeAbs = findWorktreePath(slug, repoRoot);
  if (!worktreeAbs) {
    die(`No sandbox found for slug "${slug}".\nRun: npm run agents:list`);
  }

  const repoName = getRepoName(repoRoot);
  const names = deriveNames(slug, repoName, config);
  const agentName = flags.get('agent') || agentFromPositional || config.defaultAgent;
  const terminal = flags.get('terminal') || config.defaultTerminal;
  const noLaunch = flags.has('no-launch');
  const jsonOutput = flags.has('json');
  const agentArgsRaw = flags.get('agent-args') || '';

  if (jsonOutput) printJson({ slug, branch: names.branch, worktreePath: worktreeAbs, taskFile: names.taskFile });

  await openAt({ slug, title: slug, agentName, terminal, noLaunch, jsonOutput,
    repoRoot, worktreeAbs, names, agentArgsRaw });
}

/**
 * Shared launch logic used by both `new` and `open`.
 */
async function openAt({ slug, title, agentName, terminal, noLaunch = false, jsonOutput = false,
  repoRoot, worktreeAbs, names, agentArgsRaw }) {

  if (noLaunch) return;

  const adapter = await loadAdapter(agentName);
  const extraArgs = agentArgsRaw ? agentArgsRaw.split(/\s+/).filter(Boolean) : [];
  const agentArgs = adapter.buildArgs(slug, extraArgs);
  const backend = resolveBackend(terminal);

  const backendCheck = checkBackend(backend);
  if (!backendCheck.ok) {
    die(`Terminal backend "${backend}" not available: ${backendCheck.reason}`);
  }

  if (!agentCommandAvailable(adapter.command)) {
    die(
      `Agent command "${adapter.command}" not found on PATH.\n\n` +
      `Install it or check your PATH, then try again.`
    );
  }

  launch(backend, worktreeAbs, adapter.command, agentArgs, {
    title, slug, branch: names.branch, taskFile: names.taskFile, agent: agentName,
  });
}

// ─── Subcommand: list ────────────────────────────────────────────────────────

async function cmdList(argv) {
  const { flags } = parseArgs(argv);
  const jsonOutput = flags.has('json');
  const dirtyOnly = flags.has('dirty-only');

  const repoRoot = getRepoRoot();
  const sandboxes = listAgentWorktrees(repoRoot);

  const enriched = sandboxes.map(s => ({
    ...s,
    gitStatus: getStatusSummary(s.path),
  }));

  const finalRows = dirtyOnly ? enriched.filter(s => s.gitStatus.startsWith('dirty')) : enriched;

  if (jsonOutput) {
    printJson(finalRows);
    return;
  }

  if (!finalRows.length) {
    console.log('No agent sandboxes found.');
    return;
  }

  const rows = finalRows.map(s => [s.slug, s.branch, s.path, s.gitStatus]);
  console.log(formatTable(rows, ['SLUG', 'BRANCH', 'WORKTREE', 'STATUS']));
}

// ─── Subcommand: show ────────────────────────────────────────────────────────

async function cmdShow(argv) {
  const { flags, positional } = parseArgs(argv);
  const slug = positional[0];
  const jsonOutput = flags.has('json');

  if (!slug) die('Usage: agents show <slug>');

  const repoRoot = getRepoRoot();
  const repoName = getRepoName(repoRoot);
  const config = loadConfig(repoRoot);

  const worktreeAbs = findWorktreePath(slug, repoRoot);
  if (!worktreeAbs) die(`No sandbox found for slug "${slug}".`);

  const names = deriveNames(slug, repoName, config);
  const gitStatus = getStatusSummary(worktreeAbs);
  const info = { slug, branch: names.branch, worktreePath: worktreeAbs, taskFile: names.taskFile, gitStatus };

  if (jsonOutput) {
    printJson(info);
    return;
  }

  console.log('');
  console.log(`Sandbox: ${slug}`);
  console.log(`${'─'.repeat(50)}`);
  console.log(`  Branch:    ${names.branch}`);
  console.log(`  Worktree:  ${worktreeAbs}`);
  console.log(`  Task file: ${names.taskFile}`);
  console.log(`  Status:    ${gitStatus}`);
  console.log('');
}

// ─── Subcommand: task ────────────────────────────────────────────────────────

async function cmdTask(argv) {
  const { flags, positional } = parseArgs(argv);
  const slug = positional[0];
  if (!slug) die('Usage: agents task <slug> [--append "note"]');

  const repoRoot = getRepoRoot();
  const repoName = getRepoName(repoRoot);
  const config = loadConfig(repoRoot);
  const names = deriveNames(slug, repoName, config);

  if (flags.has('append')) {
    const note = flags.get('append');
    const taskFileAbs = join(repoRoot, names.taskFile);
    if (existsSync(taskFileAbs)) {
      const content = readFileSync(taskFileAbs, 'utf8');
      const appended = content.trimEnd() + `\n\n<!-- note: ${new Date().toISOString()} -->\n${note}\n`;
      writeFileSync(taskFileAbs, appended, 'utf8');
      console.log(`Appended note to: ${names.taskFile}`);
    } else {
      warn(`Task file not found: ${names.taskFile}`);
    }
  } else {
    console.log('No changes made. Use --append.');
  }
}

// ─── Subcommand: remove ──────────────────────────────────────────────────────

async function cmdRemove(argv) {
  const { flags, positional } = parseArgs(argv);
  const slug = positional[0];
  if (!slug) die('Usage: agents remove <slug> [--force]');

  const force = flags.has('force');
  const repoRoot = getRepoRoot();
  const repoName = getRepoName(repoRoot);
  const config = loadConfig(repoRoot);

  const worktreeAbs = findWorktreePath(slug, repoRoot);

  if (worktreeAbs) {
    if (!force && isWorktreeDirty(worktreeAbs)) {
      die(
        `Worktree "${slug}" has uncommitted changes:\n  ${worktreeAbs}\n\n` +
        `Commit or stash your changes, then retry, or use --force:\n  npm run agents:remove -- ${slug} --force`
      );
    }
    try {
      worktreeRemove(worktreeAbs, force, repoRoot);
      console.log(`Removed worktree: ${worktreeAbs}`);
    } catch (e) {
      if (force) {
        warn(`git worktree remove failed (${e.message}) — cleaning up files anyway.`);
      } else {
        die(`Failed to remove worktree:\n  ${e.message}\n\nUse --force to override.`);
      }
    }
  } else {
    console.log(`No active worktree for "${slug}" (already removed).`);
  }

  const names = deriveNames(slug, repoName, config);
  const taskFileAbs = join(repoRoot, names.taskFile);
  if (existsSync(taskFileAbs)) { unlinkSync(taskFileAbs); console.log(`Removed task file: ${names.taskFile}`); }

  console.log(`\nSandbox "${slug}" removed.`);
}

// ─── Subcommand: prune ───────────────────────────────────────────────────────

async function cmdPrune() {
  const repoRoot = getRepoRoot();
  console.log('Running git worktree prune...');
  worktreePrune(repoRoot);
  console.log('Done.');
}

// ─── Subcommand: doctor ──────────────────────────────────────────────────────

async function cmdDoctor(argv) {
  const { flags } = parseArgs(argv);
  const agentArg = flags.get('agent');

  let ok = true;
  const check = (label, pass, msg) => {
    const icon = pass ? '✓' : '✗';
    console.log(`  ${icon}  ${label}`);
    if (!pass && msg) console.log(`     → ${msg}`);
    if (!pass) ok = false;
  };
  const warnCheck = (label, msg) => {
    console.log(`  ⚠  ${label}`);
    if (msg) console.log(`     → ${msg}`);
  };

  console.log('\nDoctor: running preflight checks...\n');

  // 1. Inside a git repo
  let repoRoot;
  try {
    repoRoot = getRepoRoot();
    check('Inside a git repository', true);
  } catch (e) {
    check('Inside a git repository', false, e.message);
    process.exit(1);
  }

  // 2. git available
  check('git is installed', gitAvailable(), 'Install git from https://git-scm.com');

  // 3. Config parses
  let config;
  try {
    config = loadConfig(repoRoot);
    check('scripts/agents/config.json is valid', true);
  } catch (e) {
    check('scripts/agents/config.json is valid', false, e.message);
  }

  // 4. Runtime dir exists
  check('Runtime dir exists: .agents/tasks', existsSync(join(repoRoot, '.agents/tasks')), 'Run: mkdir -p .agents/tasks');

  // 5. Worktree parent dir writable
  if (config) {
    const repoName = getRepoName(repoRoot);
    const pattern = (config.worktreeDirPattern || '../{repoName}--{slug}')
      .replace('{repoName}', repoName)
      .replace('{slug}', '_test_');
    const parentAbs = resolve(repoRoot, pattern, '..');
    try {
      accessSync(parentAbs, constants.W_OK);
      check('Worktree parent directory is writable', true);
    } catch {
      check('Worktree parent directory is writable', false, `Cannot write to: ${parentAbs}`);
    }
  }

  // 6. Terminal backend
  if (config) {
    const backend = resolveBackend(config.defaultTerminal);
    const backendCheck = checkBackend(backend);
    check(`Terminal backend "${backend}" is supported`, backendCheck.ok, backendCheck.reason);
  }

  // 7. Agent command
  if (config) {
    const agentName = agentArg || config.defaultAgent;
    const agentConfig = config.agents?.[agentName];
    if (agentConfig) {
      const avail = agentCommandAvailable(agentConfig.command);
      if (!avail) {
        check(`Agent "${agentName}" command "${agentConfig.command}" on PATH`, false,
          `Install ${agentName} CLI or add it to your PATH`);
      } else {
        check(`Agent "${agentName}" command "${agentConfig.command}" on PATH`, true);
        warnCheck(`Agent "${agentName}" authentication status unknown`,
          'Start a session manually once to verify credentials.');
      }
    }
  }

  // 8. fzf (optional — soft warn only)
  if (!agentCommandAvailable('fzf')) {
    warnCheck('fzf not found — agents:pick will not work', 'brew install fzf');
  }

  console.log('');
  if (ok) {
    console.log('All checks passed.\n');
  } else {
    console.log('Some checks failed. Fix the issues above and re-run.\n');
    process.exit(1);
  }
}

// ─── Subcommand: path ────────────────────────────────────────────────────────

async function cmdPath(argv) {
  const { positional } = parseArgs(argv);
  const slug = positional[0];
  if (!slug) die('Usage: agents path <slug>');

  const repoRoot = getRepoRoot();
  const worktreeAbs = findWorktreePath(slug, repoRoot);
  if (!worktreeAbs) die(`No sandbox found for slug "${slug}".`);

  process.stdout.write(worktreeAbs + '\n');
}

// ─── Subcommand: focus ───────────────────────────────────────────────────────

async function cmdFocus(argv) {
  const { flags, positional } = parseArgs(argv);
  const slug = positional[0];
  if (!slug) die('Usage: agents focus <slug> [--editor <cmd>]');

  const repoRoot = getRepoRoot();
  const config = loadConfig(repoRoot);

  const worktreeAbs = findWorktreePath(slug, repoRoot);
  if (!worktreeAbs) die(`No sandbox found for slug "${slug}".`);

  // Resolve editor: flag > config > $VISUAL > $EDITOR > auto-detect > open (Finder)
  const candidates = ['cursor', 'code', 'zed', 'subl'];
  const editor = flags.get('editor')
    || config.preferredEditor
    || process.env.VISUAL
    || process.env.EDITOR
    || candidates.find(agentCommandAvailable)
    || 'open';

  // Use spawn + unref so GUI editors (cursor, code) return immediately
  // without blocking the terminal
  const child = spawn(editor, [worktreeAbs], {
    stdio: 'ignore',
    detached: true,
  });
  child.on('error', (e) => {
    console.error(`\nError: Failed to open editor "${editor}": ${e.message}`);
    console.error(`Set preferredEditor in scripts/agents/config.json or pass --editor <cmd>\n`);
    process.exit(1);
  });
  child.unref();

  console.log(`Opened ${editor}: ${worktreeAbs}`);
}

// ─── Subcommand: pick ────────────────────────────────────────────────────────

async function cmdPick(argv) {
  const { flags } = parseArgs(argv);
  const agentOverride = flags.get('agent');
  const noLaunch = flags.has('no-launch');

  const repoRoot = getRepoRoot();

  if (!agentCommandAvailable('fzf')) {
    die(
      'fzf is not installed.\n\n' +
      'Install it with:\n' +
      '  brew install fzf        (macOS)\n' +
      '  apt install fzf         (Ubuntu/Debian)\n' +
      '  https://github.com/junegunn/fzf'
    );
  }

  const slugs = listAgentWorktrees(repoRoot).map(w => w.slug);

  if (!slugs.length) {
    console.log('No active sandboxes to pick from.');
    return;
  }

  const scriptPath = new URL(import.meta.url).pathname;
  const result = spawnSync('fzf', [
    '--prompt', 'sandbox> ',
    '--preview', `node "${scriptPath}" show {}`,
    '--preview-window', 'right:55%:wrap',
    '--height', '40%',
    '--border',
  ], {
    input: slugs.join('\n'),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  if (result.status !== 0 || !result.stdout.trim()) {
    // User cancelled fzf (ESC or q) — exit cleanly
    process.exit(0);
  }

  const selected = result.stdout.trim();
  const openArgs = [selected];
  if (agentOverride) openArgs.push('--agent', agentOverride);
  if (noLaunch) openArgs.push('--no-launch');
  await cmdOpen(openArgs);
}

// ─── Subcommand: help ────────────────────────────────────────────────────────

function cmdHelp() {
  console.log(`
agents — local multi-agent workspace launcher

Usage:
  npm run agents -- <subcommand> [options]

Core subcommands:
  new     <title>           Create or reopen an agent sandbox
  open    <slug>            Open an existing sandbox
  list                      List all active sandboxes
  show    <slug>            Show detailed info for a sandbox
  task    <slug>            Update task metadata or append notes
  remove  <slug>            Remove a sandbox
  prune                     Clean stale worktree metadata
  doctor                    Run preflight checks

QOL subcommands:
  path    <slug>            Print worktree path (for cd \$(...) or scripts)
  focus   <slug>            Open worktree in editor (cursor/code/zed/subl)
  pick                      fzf fuzzy-picker over active sandboxes

Flags for \`new\`:
  --agent <name>            Agent to launch (claude, gemini, codex)
  --base <branch>           Base branch for the worktree
  --terminal <backend>      Terminal backend (current, terminal, iterm)
  --duplicate               Force a new sandbox even if slug exists
  --suffix <text>           Append suffix to slug
  --agent-args "<args>"     Extra args passed to the agent CLI
  --no-launch               Create sandbox without opening terminal
  --json                    Machine-readable output

Flags for \`list\`:
  --dirty-only              Show only dirty worktrees
  --json                    Machine-readable output

Flags for \`focus\`:
  --editor <cmd>            Override editor (e.g. --editor=zed)

Shell integration (optional):
  source scripts/agents/shell.sh    Adds short functions: anew, aopen, alist, apick…

Examples:
  npm run agents:new -- "Fix auth redirect loop"
  npm run agents:new:claude -- "Fix auth redirect loop"
  npm run agents:new -- gemini --base develop "Refactor settings"
  npm run agents:open -- fix-auth-redirect-loop codex
  npm run agents:pick
  npm run agents:focus -- fix-auth-redirect-loop
  cd \$(npm run --silent agents:path -- fix-auth-redirect-loop)
  npm run agents:list -- --dirty-only
`);
}

// ─── Main dispatch ───────────────────────────────────────────────────────────

const [,, subcommand, ...rest] = process.argv;

const commands = {
  new: cmdNew,
  open: cmdOpen,
  list: cmdList,
  show: cmdShow,
  task: cmdTask,
  remove: cmdRemove,
  prune: cmdPrune,
  doctor: cmdDoctor,
  path: cmdPath,
  focus: cmdFocus,
  pick: cmdPick,
  help: async () => cmdHelp(),
};

if (!subcommand || subcommand === '--help' || subcommand === '-h') {
  cmdHelp();
  process.exit(0);
}

const handler = commands[subcommand];
if (!handler) {
  console.error(`Unknown subcommand: "${subcommand}"\nRun: npm run agents -- help`);
  process.exit(1);
}

handler(rest).catch(e => {
  console.error(`\nFatal: ${e.message}\n`);
  process.exit(1);
});
