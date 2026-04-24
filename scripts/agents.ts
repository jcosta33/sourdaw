#!/usr/bin/env node
/**
 * agents.ts — local multi-agent workspace launcher
 *
 * Usage:
 *   node scripts/agents.ts <subcommand> [options]
 *
 * Subcommands: new, open, list, show, task, remove, prune, doctor, path, focus, pick
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, accessSync, constants, readdirSync } from 'fs';
import { join, resolve, isAbsolute } from 'path';
import { spawnSync, spawn } from 'child_process';

import { loadConfig } from './agents/config.ts';
import { toSlug, deriveNames, nextDuplicateSlug } from './agents/slug.ts';
import {
    getRepoRoot,
    getRepoName,
    worktreeList,
    findWorktreeForBranch,
    worktreeCreate,
    worktreeRemove,
    worktreePrune,
    isWorktreeDirty,
    getStatusSummary,
    gitAvailable,
    isBranchMergedInto,
    deleteBranch,
    listBranchesByPrefix,
    worktreeSync,
} from './agents/git.ts';
import { createOrUpdateTaskFile } from './agents/template.ts';
import { resolveBackend, launch, checkBackend } from './agents/terminal.ts';
import { colors, c, red, green, yellow, blue, cyan, dim, bold, success, info, warn as printWarn, error as printError, box } from './agents/colors.ts';
import { parseArgs, findMarkdownFiles, fzfSelect, promptInput } from './agents/cli.ts';

// ─── Argument parser ─────────────────────────────────────────────────────────

// ─── Helpers ─────────────────────────────────────────────────────────────────

function die(msg) {
    printError(msg);
    process.exit(1);
}

function warn(msg) {
    printWarn(msg);
}

async function loadAdapter(agentName) {
    const allowed = ['claude', 'gemini', 'codex', 'kimi', 'opencode'];
    if (!allowed.includes(agentName)) {
        die(`Unknown agent "${agentName}". Supported: ${allowed.join(', ')}`);
    }
    return import(`./agents/adapters/${agentName}.ts`);
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
        .filter((w) => w.branch && w.branch.startsWith('agent/'))
        .map((w) => ({ slug: w.branch.slice(6), branch: w.branch, path: w.path }));
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
    const widths = cols.map((_, ci) => Math.max(...rows.map((r) => (r[ci] || '').length), cols[ci].length));
    const header = cols.map((c, i) => c.padEnd(widths[i])).join('  ');
    const sep = widths.map((w) => '-'.repeat(w)).join('  ');
    const body = rows.map((r) => cols.map((_, i) => (r[i] || '').padEnd(widths[i])).join('  '));
    return [header, sep, ...body].join('\n');
}

const KNOWN_AGENTS = ['claude', 'gemini', 'codex', 'kimi', 'opencode'];

// ─── Config loaders ──────────────────────────────────────────────────────────

function loadTaskTypes(repoRoot) {
    const typesPath = join(repoRoot, 'scripts', 'agents', 'task-types.json');
    try {
        return JSON.parse(readFileSync(typesPath, 'utf8'));
    } catch (e) {
        console.warn(`Warning: could not load task-types.json: ${e.message}`);
        return [];
    }
}

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

    // If the first positional looks like a file path, treat it as the spec
    let specFile = flags.get('spec') || '';
    if (!specFile && titlePositional.length > 0) {
        const first = titlePositional[0];
        if (first.endsWith('.md') || first.includes('/')) {
            specFile = first;
            titlePositional = titlePositional.slice(1);
        }
    }

    let title = titlePositional.join(' ').trim();

    // Derive title from spec filename when none given
    if (!title && specFile) {
        const specBase = specFile.split('/').pop().replace(/\.md$/i, '');
        title = specBase.replace(/[-_]+/g, ' ').trim();
    }

    // Interactive mode: no spec and no title — drop into guided wizard
    let interactiveType = '';

    if (!specFile && !title) {
        if (!agentCommandAvailable('fzf')) {
            die(
                'Usage: agents new [agent] <"Task title" | path/to/spec.md>\n\n' +
                    'Install fzf for interactive mode:\n  brew install fzf'
            );
        }

        const repoRootEarly = getRepoRoot();
        const taskTypes = loadTaskTypes(repoRootEarly);

        console.log('');

        // Step 1: Task type
        const typeItems = taskTypes.map((t) => `${t.id.padEnd(10)}  —  ${t.description}`);
        const selectedTypeRaw = fzfSelect(typeItems, { prompt: 'type > ' });
        if (!selectedTypeRaw) process.exit(0);
        interactiveType = selectedTypeRaw.split(/\s+—\s+/)[0].trim();
        const taskTypeDef = taskTypes.find((t) => t.id === interactiveType);

        // Step 2: Reference doc — source folder depends on task type.
        //   feature  → .agents/specs
        //   refactor → .agents/audits
        //   spec     → .agents/research
        //   fix      → null (no picker)
        const docsSource = taskTypeDef?.docsSource;
        if (docsSource) {
            const docsDir = join(repoRootEarly, '.agents', docsSource);
            const docsLabel = taskTypeDef?.docsLabel || 'Reference';
            const skipLabel = `(skip — no ${docsLabel.toLowerCase()})`;
            const docFiles = findMarkdownFiles(docsDir);
            if (docFiles.length) {
                const docItems = taskTypeDef?.requiresDoc ? docFiles : [skipLabel, ...docFiles];
                const selectedDoc = fzfSelect(docItems, {
                    prompt: `${docsSource} > `,
                    preview: `cat "${docsDir}/{}" 2>/dev/null || echo ""`,
                });
                if (!selectedDoc) process.exit(0);
                if (selectedDoc !== skipLabel) {
                    specFile = `.agents/${docsSource}/${selectedDoc}`;
                    const derived = selectedDoc.split('/').pop().replace(/\.md$/i, '').replace(/[-_]+/g, ' ').trim();
                    title = promptInput(`Title [${derived}]: `, derived);
                }
            } else if (taskTypeDef?.requiresDoc) {
                die(
                    `No ${docsLabel.toLowerCase()} files found under .agents/${docsSource}/ — a ${docsLabel.toLowerCase()} is required for "${interactiveType}" tasks.`
                );
            }
        }

        // Step 3: Title (if not derived from spec)
        if (!title) {
            title = promptInput('Task title: ', '');
        }
        if (!title) process.exit(0);

        // Step 4: Agent — skip if already specified as a positional
        if (!agentFromPositional) {
            const selectedAgent = fzfSelect(KNOWN_AGENTS, { prompt: 'agent > ' });
            if (selectedAgent) agentFromPositional = selectedAgent;
        }

        console.log('');
    }

    if (!title) {
        die('Usage: agents new [agent] <"Task title" | path/to/spec.md>');
    }

    const repoRoot = getRepoRoot();
    const repoName = getRepoName(repoRoot);
    const config = loadConfig(repoRoot);
    ensureRuntimeDirs(repoRoot);

    // Resolve type — interactive values take priority, then --type flag
    const taskType = interactiveType || flags.get('type') || '';

    const agentName = flags.get('agent') || agentFromPositional || config.defaultAgent;
    const baseBranch = flags.get('base') || config.defaultBaseBranch;
    const terminal = flags.get('terminal') || config.defaultTerminal;
    const noLaunch = flags.has('no-launch');
    const duplicate = flags.has('duplicate');
    const suffix = flags.get('suffix') || '';
    const agentArgsRaw = flags.get('agent-args') || '';
    const jsonOutput = flags.has('json');
    const maxLen = config.slugMaxLen || 60;

    // Prefix slug with task type so branch + worktree names carry the type
    // (e.g. agent/feature-add-fader, ../repo--feature-add-fader).
    const typePrefix = taskType ? `${taskType}-` : '';
    const titleMaxLen = Math.max(1, maxLen - typePrefix.length);
    let slug = typePrefix + toSlug(title, titleMaxLen);
    if (suffix) slug = `${slug}-${toSlug(suffix, 20)}`;

    const templateDir = join(repoRoot, 'scripts', 'agents', 'templates');

    // Handle duplicate mode — find next available slug using git worktrees
    if (duplicate) {
        const existingSlugs = new Set(listAgentWorktrees(repoRoot).map((w) => w.slug));
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

    // Create task file inside the worktree (not the main repo) so Claude can read it on launch
    const taskFileAbs = join(worktreeAbs, names.taskFile);
    if (config.writeTaskTemplateOnCreate) {
        mkdirSync(join(worktreeAbs, '.agents/tasks'), { recursive: true });
        createOrUpdateTaskFile(taskFileAbs, templateDir, {
            title,
            slug,
            parent: flags.get('parent') || '',
            agent: agentName,
            branch: names.branch,
            baseBranch,
            worktreePath: names.worktreePath,
            taskFile: names.taskFile,
            specFile,
            createdAt: new Date().toISOString(),
            type: taskType,
            commands: config.commands,
        });
    }

    if (jsonOutput) {
        printJson({ slug, branch: names.branch, worktreePath: worktreeAbs, taskFile: names.taskFile });
        if (noLaunch) return;
    } else {
        success(`Created sandbox: ${cyan(slug)}`);
        box(slug, [
            `${dim('Branch:')}    ${names.branch}`,
            `${dim('Worktree:')}  ${worktreeAbs}`,
            `${dim('Task file:')} ${names.taskFile}`,
        ]);
        if (noLaunch) {
            console.log(dim('(--no-launch: skipping terminal open)\n'));
            return;
        }
    }

    await openAt({
        slug,
        title,
        agentName,
        terminal,
        repoRoot,
        worktreeAbs,
        names,
        agentArgsRaw,
        promptContent: names.taskFile,
    });
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
    if (!slug) die('Usage: agents open <slug> [claude|gemini|codex|opencode]');

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

    // Create task file if missing (e.g. worktree predates this feature, or reuse path from cmdNew)
    const taskFileAbs = join(worktreeAbs, names.taskFile);
    if (config.writeTaskTemplateOnCreate && !existsSync(taskFileAbs)) {
        const templateDir = join(repoRoot, 'scripts', 'agents', 'templates');
        mkdirSync(join(worktreeAbs, '.agents/tasks'), { recursive: true });
        createOrUpdateTaskFile(taskFileAbs, templateDir, {
            title: slug,
            slug,
            agent: agentName,
            branch: names.branch,
            baseBranch: config.defaultBaseBranch,
            worktreePath: names.worktreePath,
            taskFile: names.taskFile,
            specFile: '',
            createdAt: new Date().toISOString(),
            commands: config.commands,
        });
        if (!jsonOutput) console.log(`Created missing task file: ${names.taskFile}`);
    }

    if (jsonOutput) printJson({ slug, branch: names.branch, worktreePath: worktreeAbs, taskFile: names.taskFile });

    await openAt({
        slug,
        title: slug,
        agentName,
        terminal,
        noLaunch,
        jsonOutput,
        repoRoot,
        worktreeAbs,
        names,
        agentArgsRaw,
        promptContent: names.taskFile,
    });
}

/**
 * Shared launch logic used by both `new` and `open`.
 */
async function openAt({
    slug,
    title,
    agentName,
    terminal,
    noLaunch = false,
    jsonOutput = false,
    repoRoot,
    worktreeAbs,
    names,
    agentArgsRaw,
    promptContent = '',
}) {
    if (noLaunch) return;

    const adapter = await loadAdapter(agentName);
    const extraArgs = agentArgsRaw ? agentArgsRaw.split(/\s+/).filter(Boolean) : [];
    const agentArgs = adapter.buildArgs(slug, extraArgs, {
        taskFile: promptContent,
        branch: names.branch,
        worktreePath: worktreeAbs,
    });
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
        title,
        slug,
        branch: names.branch,
        taskFile: names.taskFile,
        agent: agentName,
    });
}

// ─── Subcommand: list ────────────────────────────────────────────────────────

async function cmdList(argv) {
    const { flags } = parseArgs(argv);
    const jsonOutput = flags.has('json');
    const dirtyOnly = flags.has('dirty-only');

    const repoRoot = getRepoRoot();
    const sandboxes = listAgentWorktrees(repoRoot);
    const globalState = readState(repoRoot);

    const enriched = sandboxes.map((s) => {
        const state = globalState[s.slug] || {};
        let processStatus = dim('-');
        let rawStatus = 'unknown';
        
        if (state.status === 'running') {
            if (state.pid) {
                const alive = isProcessRunning(state.pid);
                if (alive) {
                    processStatus = green('[RUNNING]');
                    rawStatus = 'running';
                } else {
                    processStatus = red('[CRASHED]');
                    rawStatus = 'crashed';
                }
            } else {
                processStatus = green('[LAUNCHED]');
                rawStatus = 'launched';
            }
        } else if (state.status) {
            processStatus = dim(`[${state.status.toUpperCase()}]`);
            rawStatus = state.status;
        }

        return {
            ...s,
            gitStatus: getStatusSummary(s.path),
            processStatus,
            rawStatus,
            pid: state.pid || null,
            agent: state.agent || 'unknown',
        };
    });

    const finalRows = dirtyOnly ? enriched.filter((s) => s.gitStatus.startsWith('dirty')) : enriched;

    if (jsonOutput) {
        printJson(finalRows.map(r => ({ slug: r.slug, branch: r.branch, worktree: r.path, gitStatus: r.gitStatus, status: r.rawStatus, pid: r.pid, agent: r.agent })));
        return;
    }

    if (!finalRows.length) {
        console.log('No agent sandboxes found.');
        return;
    }

    const rows = finalRows.map((s) => [s.slug, s.branch, s.processStatus, s.gitStatus]);
    console.log(formatTable(rows, ['SLUG', 'BRANCH', 'STATUS', 'GIT STATUS']));
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

    info(`Sandbox Details`);
    box(slug, [
        `${dim('Branch:')}    ${names.branch}`,
        `${dim('Worktree:')}  ${worktreeAbs}`,
        `${dim('Task file:')} ${names.taskFile}`,
        `${dim('Status:')}    ${gitStatus.includes('dirty') ? yellow(gitStatus) : green(gitStatus)}`,
    ]);
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

    const worktreeAbs = findWorktreePath(slug, repoRoot);
    if (!worktreeAbs) die(`No active worktree for "${slug}". Is it checked out?`);

    const taskFileAbs = join(worktreeAbs, names.taskFile);
    if (!existsSync(taskFileAbs)) {
        die(`Task file not found at: ${taskFileAbs}`);
    }

    let note = flags.get('append');
    
    // Interactive prompt if no append flag provided
    if (!note) {
        console.log(`\n${cyan('Interactive Steering')}: Append a note or instructions for ${bold(slug)}`);
        console.log(dim('(Leave empty and press Enter to cancel)\n'));
        note = await promptInput('feedback> ', '');
    }

    if (note && note.trim() !== '') {
        const content = readFileSync(taskFileAbs, 'utf8');
        const appended = content.trimEnd() + `\n\n## Human Feedback (${new Date().toISOString()})\n${note}\n`;
        writeFileSync(taskFileAbs, appended, 'utf8');
        success(`Appended feedback to: ${names.taskFile}`);
    } else {
        console.log('No feedback provided. Cancelled.');
    }
}

import { writeMemory, readMemory } from './agents/memory.ts';
import { generateContextMap } from './agents/context.ts';
import { renameSymbol } from './agents/ast.ts';

// ─── Phase 1: Context & Memory Commands ──────────────────────────────────────

async function cmdContext(argv) {
    const { positional } = parseArgs(argv);
    const dir = positional[0] || '';
    const repoRoot = getRepoRoot();
    const map = generateContextMap(repoRoot, dir);
    console.log(JSON.stringify(map, null, 2));
}

async function cmdMemory(argv) {
    const { flags, positional } = parseArgs(argv);
    const action = positional[0];
    const repoRoot = getRepoRoot();

    if (action === 'get') {
        const topic = positional[1];
        if (!topic) die('Usage: agents memory get <topic>');
        const val = readMemory(repoRoot, topic);
        if (val) console.log(val);
        else console.log(`No memory found for topic: ${topic}`);
    } else if (action === 'set') {
        const topic = positional[1];
        const val = flags.get('val');
        if (!topic || !val) die('Usage: agents memory set <topic> --val "content"');
        const file = writeMemory(repoRoot, topic, val);
        success(`Saved memory to ${file}`);
    } else if (action === 'list') {
        const topics = readMemory(repoRoot);
        if (topics.length) topics.forEach(t => console.log(`- ${t}`));
        else console.log('No memories saved.');
    } else {
        die('Usage: agents memory <get|set|list>');
    }
}

async function cmdAst(argv) {
    const { flags, positional } = parseArgs(argv);
    const action = positional[0];
    const repoRoot = getRepoRoot();

    if (action === 'rename') {
        const file = flags.get('file');
        const oldName = flags.get('old');
        const newName = flags.get('new');
        if (!file || !oldName || !newName) die('Usage: agents ast rename --file path/to/file.ts --old name --new newName');
        
        const res = renameSymbol(repoRoot, file, oldName, newName);
        if (res.success) success(`Renamed ${oldName} -> ${newName} in ${file}`);
        else die(`Rename failed: ${res.error}`);
    } else {
        die('Usage: agents ast <rename>');
    }
}

// ─── Subcommand: remove ──────────────────────────────────────────────────────

async function cmdRemove(argv) {
    const { flags, positional } = parseArgs(argv);
    const slug = positional[0];
    if (!slug) die('Usage: agents remove <slug> [--force]');

    const force = flags.has('force');
    const repoRoot = getRepoRoot();

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
            removeState(repoRoot, slug);
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

    // Task file lives inside the worktree — it's gone when the worktree is removed.

    console.log(`\nSandbox "${slug}" removed.`);
}

// ─── Subcommand: prune ───────────────────────────────────────────────────────

async function cmdPrune(argv) {
    const { flags } = parseArgs(argv);
    const force = flags.has('force');

    const repoRoot = getRepoRoot();
    const config = loadConfig(repoRoot);
    const baseBranch = config.defaultBaseBranch;

    // Prune stale worktree metadata first
    console.log('Running git worktree prune...');
    worktreePrune(repoRoot);

    // Build a map of branch → worktree path for active worktrees
    const activeWorktrees = listAgentWorktrees(repoRoot);
    const activeByBranch = new Map(activeWorktrees.map((s) => [s.branch, s]));

    // Scan all local agent/* branches (catches orphaned branches with no worktree)
    const allAgentBranches = listBranchesByPrefix('agent/', repoRoot);

    if (!allAgentBranches.length) {
        console.log('No agent branches found.\nDone.');
        return;
    }

    console.log(`\nScanning ${allAgentBranches.length} agent branch(es)...\n`);

    let cleaned = 0;

    for (const branch of allAgentBranches) {
        const slug = branch.slice(6); // strip 'agent/'
        const active = activeByBranch.get(branch);
        const isMerged = isBranchMergedInto(branch, baseBranch, repoRoot);
        const hasWorktree = !!active;

        // Skip branches that are not merged and still have an active worktree
        if (!isMerged && hasWorktree) continue;

        // Skip branches that are not merged and have no worktree only if not --force
        if (!isMerged && !hasWorktree && !force) continue;

        const reason = isMerged ? 'merged' : 'orphaned (no worktree)';
        console.log(`  ${slug}  [${reason}]`);

        // Remove active worktree if present
        if (active) {
            if (!force && isWorktreeDirty(active.path)) {
                console.log(`    Skipping — dirty worktree (use --force to override)\n`);
                continue;
            }
            try {
                worktreeRemove(active.path, force, repoRoot);
                removeState(repoRoot, slug);
                console.log(`    Removed worktree: ${active.path}`);
            } catch (e) {
                warn(`Could not remove worktree for "${slug}": ${e.message}`);
            }
        }

        // Delete the branch
        try {
            deleteBranch(branch, repoRoot, true); // always force-delete since we verified merge or --force
            console.log(`    Deleted branch:   ${branch}`);
        } catch (e) {
            warn(`Could not delete branch "${branch}": ${e.message}`);
        }

        console.log('');
        cleaned++;
    }

    if (!cleaned) {
        console.log('Nothing to clean up.\n  - Use --force to also remove orphaned branches with no worktree.');
    }

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
    check(
        'Runtime dir exists: .agents/tasks',
        existsSync(join(repoRoot, '.agents/tasks')),
        'Run: mkdir -p .agents/tasks'
    );

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
                check(
                    `Agent "${agentName}" command "${agentConfig.command}" on PATH`,
                    false,
                    `Install ${agentName} CLI or add it to your PATH`
                );
            } else {
                check(`Agent "${agentName}" command "${agentConfig.command}" on PATH`, true);
                warnCheck(
                    `Agent "${agentName}" authentication status unknown`,
                    'Start a session manually once to verify credentials.'
                );
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
    const editor =
        flags.get('editor') ||
        config.preferredEditor ||
        process.env.VISUAL ||
        process.env.EDITOR ||
        candidates.find(agentCommandAvailable) ||
        'open';

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

    const slugs = listAgentWorktrees(repoRoot).map((w) => w.slug);

    if (!slugs.length) {
        console.log('No active sandboxes to pick from.');
        return;
    }

    const scriptPath = new URL(import.meta.url).pathname;
    const result = spawnSync(
        'fzf',
        [
            '--prompt',
            'sandbox> ',
            '--preview',
            `node "${scriptPath}" show {}`,
            '--preview-window',
            'right:55%:wrap',
            '--height',
            '40%',
            '--border',
        ],
        {
            input: slugs.join('\n'),
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'inherit'],
        }
    );

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
  pnpm agents:new                   Interactive spec/agent picker (requires fzf)
  pnpm agents:new <"Task title" | spec.md>
  pnpm agents -- <subcommand> [options]

Core subcommands:
  new     [title|spec.md]   Create or reopen a sandbox — interactive if no args given
  open    <slug>            Reopen an existing sandbox
  list                      List all active sandboxes
  show    <slug>            Show detailed info for a sandbox
  task    <slug>            Interactive prompt to append human feedback to the task file
  validate                  Run configured linters/typechecks and truncate output for LLMs
  test                      Run vitest wrapper with smart log truncation
  test-radius <file>        Calculate blast radius of a file and test impacted specs
  pr      <slug>            Auto-commit changes and generate PR based on task file
  epic    <file>            Decompose a markdown list into child tasks
  triage  <file>            Convert unstructured bug report into a strict spec
  arch                      Lint and enforce cross-module boundary invariants
  review  <slug>            Spawn an adversarial peer-review agent session
  chat    <slug> [msg]      Send or read an IPC message with another agent
  repro                     Verify that tests were modified before source code
  screenshot [url]          Use Playwright to capture a screenshot for LLM visual validation
  compress <file>           Strip function bodies from a TS file to save context tokens
  graph    <file>           Extract and map the import dependencies of a module
  references <symbol>       Fast codebase scan to find usages of a symbol or class
  docs     <file>           Extract and format JSDoc blocks from a module
  complexity <file>         Calculate cyclomatic heuristic to enforce maintainability
  audit-sec  <file>         Scan for common dangerous patterns and secrets
  dead-code  <file>         Find exported symbols that are never imported
  format     <file>         Wrapper for Prettier/ESLint fixes with truncated output
  logs       <slug>         View the execution output logs of a running agent
  health                    Run pre-flight environment checks for the Swarm
  epic    <file>            Decompose a markdown list into child tasks
  triage  <file>            Convert unstructured bug report into a strict spec
  arch                      Lint and enforce cross-module boundary invariants
  review  <slug>            Spawn an adversarial peer-review agent session
  chat    <slug> [msg]      Send or read an IPC message with another agent
  repro                     Verify that tests were modified before source code
  refactor <dir> <goal>     Break a massive refactor into 5-file tasks
  deps                      Find outdated packages and generate upgrade tasks
  migrate <file> <lang>     Spawn a translator and verifier agent pair
  fuzz    <file> <func>     Generate unexpected test permutations for a function
  chaos   <start|stop>      Inject latency and mock network failures locally
  visual  <baseline|compare> Screenshot-based visual regression comparison
  knowledge <query>         Semantic search across past tasks, PRs, and specs
  telemetry                 Dashboard for tracking Swarm resource/token usage
  profile <cmd>             Analyze Node process and assign perf agent
  daemon                    Background watcher that runs test-radius on human saves
  heal                      Self-healing CI hotfix generator for broken branches
  find    <type> <target>   Semantic search (class, interface, extends, implements)
  mock    <file> <Name>     Instantly generate TS mock factory for an interface
  ui                        Launch real-time persistent Swarm Terminal UI
  compress <file>           Strip function bodies from a TS file to save context tokens
  graph    <file>           Extract and map the import dependencies of a module
  references <symbol>       Fast codebase scan to find usages of a symbol or class
  docs     <file>           Extract and format JSDoc blocks from a module
  complexity <file>         Calculate cyclomatic heuristic to enforce maintainability
  audit-sec  <file>         Scan for common dangerous patterns and secrets
  dead-code  <file>         Find exported symbols that are never imported
  format     <file>         Wrapper for Prettier/ESLint fixes with truncated output
  logs       <slug>         View the execution output logs of a running agent
  health                    Run pre-flight environment checks for the Swarm
  context [dir]             Generate semantic map of exported symbols for RAG
  memory  <get|set|list>    Global memory bank for agent-to-agent invariant tracking
  ast     rename            Structural rename utility for safely modifying symbols
  sync    <slug>            Rebase a sandbox onto its base branch
  remove  <slug>            Remove a sandbox and its worktree
  prune                     Remove merged/orphaned sandboxes
  doctor                    Run preflight checks

QOL subcommands:
  path    <slug>            Print worktree path (for cd \$(...) or scripts)
  focus   <slug>            Open worktree in editor (cursor/code/zed/subl)
  pick                      fzf fuzzy-picker over active sandboxes

Flags for \`new\`:
  --agent <name>            Agent to launch: claude (default), gemini, codex, opencode
  --type <type>             Task type: feature, refactor, fix, spec
  --spec <path>             Spec file to embed in task (also accepted as positional)
  --base <branch>           Base branch (default: main)
  --terminal <backend>      Terminal backend: current (default), terminal, iterm
  --duplicate               Force a new sandbox even if slug already exists
  --suffix <text>           Append a suffix to the slug
  --agent-args "<args>"     Extra args forwarded to the agent CLI
  --no-launch               Create sandbox without launching the agent
  --json                    Machine-readable output

Flags for \`prune\`:
  --force                   Also remove orphaned branches and skip dirty check

Flags for \`list\`:
  --dirty-only              Show only sandboxes with uncommitted changes
  --json                    Machine-readable output

Flags for \`focus\`:
  --editor <cmd>            Override editor (e.g. --editor=zed)

Shell integration (optional):
  source scripts/agents/shell.sh    Adds short aliases: anew, aopen, alist, apick…

Examples:
  pnpm agents:new                                              # interactive picker
  pnpm agents:new 'Fix auth redirect loop'
  pnpm agents:new .agents/specs/architecture-refactor/team4-session.md
  pnpm agents:new gemini 'Refactor settings'
  pnpm agents:open fix-auth-redirect-loop
  pnpm agents:pick
  pnpm agents:prune
  pnpm agents:prune --force
  pnpm agents:list -- --dirty-only
`);
}

// ─── Main dispatch ───────────────────────────────────────────────────────────

const [, , subcommand, ...rawRest] = process.argv;
// pnpm/npm inject a bare '--' before forwarded flags — strip it so our parseArgs sees real flags
const rest = rawRest[0] === '--' ? rawRest.slice(1) : rawRest;

const commands = {
    new: cmdNew,
    open: cmdOpen,
    list: cmdList,
    show: cmdShow,
    task: cmdTask,
    validate: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/validate.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    test: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/test.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    'test-radius': async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/test-radius.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    pr: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/pr.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    screenshot: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/screenshot.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    ui: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/ui.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    compress: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/compress.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    graph: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/graph.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    references: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/references.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    docs: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/docs.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    complexity: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/complexity.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    'audit-sec': async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/audit-sec.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    'dead-code': async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/dead-code.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    format: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/format.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    logs: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/logs.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    health: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/health.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    epic: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/epic.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    triage: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/triage.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    arch: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/arch.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    review: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/review.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    chat: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/chat.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    repro: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/repro.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    find: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/find.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    mock: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/mock.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    daemon: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/daemon.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    heal: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/heal.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    refactor: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/refactor.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    deps: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/deps.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    migrate: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/migrate.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    fuzz: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/fuzz.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    chaos: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/chaos.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    visual: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/visual.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    knowledge: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/knowledge.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    telemetry: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/telemetry.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    profile: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/profile.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    release: async () => {
        const { spawnSync } = await import('child_process');
        const scriptPath = new URL('./agents/release.ts', import.meta.url).pathname;
        const res = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exit(res.status || 0);
    },
    context: cmdContext,
    memory: cmdMemory,
    ast: cmdAst,
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

handler(rest).catch((e) => {
    console.error(`\nFatal: ${e.message}\n`);
    process.exit(1);
});
