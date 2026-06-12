import { spawnSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs, fzfSelect, findMarkdownFiles, promptInput } from './agents/cli.ts';
import { toSlug } from './agents/slug.ts';
import { findWorktreeForBranch, getRepoRoot, worktreeCreate } from './agents/git.ts';
import { loadConfig } from './agents/config.ts';
import { resolveBackend, checkBackend, launch } from './agents/terminal.ts';
import { colors, bold, cyan, green, red, yellow, box, dim } from './agents/colors.ts';
import { createOrUpdateTaskFile } from './agents/template.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = getRepoRoot();

function dirname(path) {
    const parts = path.split('/');
    parts.pop();
    return parts.join('/') || '.';
}

function die(msg) {
    console.error(`\x1b[31mError:\x1b[0m ${msg}`);
    process.exit(1);
}

const KNOWN_AGENTS = ['claude', 'gemini', 'codex', 'kimi', 'opencode'];

async function run() {
    let args = process.argv.slice(2);
    if (args[0] === '--') args = args.slice(1);

    if (args.length > 0 && args[0] === 'review') {
        return cmdReview(args.slice(1));
    }

    if (args.length > 0 && args[0] === 'new') {
        args = args.slice(1);
    }

    const { flags, positional } = parseArgs(args);

    if (flags.has('help') || (positional.length === 0 && args.includes('--help'))) {
        console.log(`
Usage: 
  pnpm delegator:new [agent] <"Title"> [file1] [file2] ...
  pnpm delegator:review <slug>

Launches a "Lead Engineer" agent whose sole purpose is to orchestrate multiple
worker agents concurrently using git worktrees.

Arguments (new):
  agent    (Optional) The agent to launch (e.g. claude, gemini, codex). Defaults to claude.
  title    A short title for the delegation session (e.g. "Fix auth and limits")
  files    Paths to specs, audits, or bugs that need to be delegated.

Arguments (review):
  slug     The slug of the worker sandbox to review (e.g. "feature-auth").
  
Flags:
  --agent <name>        Override agent
  --terminal <backend>  Override terminal
  --no-launch           Skip launching terminal
  
Example:
  pnpm delegator:new gemini "Fix auth and limits" .agents/specs/auth.md .agents/bugs/rate-limit.md
  pnpm delegator:review feature-auth
        `);
        process.exit(0);
    }

    let agent = flags.get('agent') || 'claude';
    let titlePositional = positional;

    if (titlePositional.length > 0 && KNOWN_AGENTS.includes(titlePositional[0])) {
        agent = titlePositional[0];
        titlePositional = titlePositional.slice(1);
    }

    let title = '';
    let taskFiles = [];

    // If we have positionals left, first is title, rest are files
    if (titlePositional.length > 0) {
        title = titlePositional[0];
        taskFiles = titlePositional.slice(1).map((f) => resolve(process.cwd(), f));
    }

    // Interactive Wizard
    if (!title || taskFiles.length === 0) {
        const hasFzf = spawnSync('which', ['fzf'], { encoding: 'utf8' }).status === 0;
        if (!hasFzf) {
            die('Interactive mode requires fzf. Install fzf or provide title and files as arguments.');
        }

        if (!title) {
            title = await promptInput('Delegation Title: ', '');
            if (!title) process.exit(0);
        }

        if (taskFiles.length === 0) {
            const agentDirs = ['.agents/specs', '.agents/audits', '.agents/bugs', '.agents/research'];
            let allFiles = [];
            for (const dir of agentDirs) {
                const absDir = join(REPO_ROOT, dir);
                if (existsSync(absDir)) {
                    const files = findMarkdownFiles(absDir);
                    allFiles.push(...files.map((f) => join(dir, f)));
                }
            }

            if (allFiles.length === 0) {
                die('No markdown files found in .agents/ (specs, audits, bugs, research).');
            }

            console.log(`\n${cyan('Select tasks to delegate')} (Tab to multi-select, Enter to confirm):`);
            const selectedFiles = fzfSelect(allFiles, {
                prompt: 'tasks> ',
                multi: true,
                preview: `cat "{}" 2>/dev/null || echo ""`,
            });

            if (!selectedFiles || selectedFiles.length === 0) {
                console.log('No tasks selected. Exiting.');
                process.exit(0);
            }

            taskFiles = selectedFiles.map((f) => resolve(REPO_ROOT, f));

            // Allow selecting agent interactively if not passed
            if (!flags.get('agent') && !positional.some((p) => KNOWN_AGENTS.includes(p))) {
                const selectedAgent = fzfSelect(KNOWN_AGENTS, { prompt: 'agent> ' });
                if (selectedAgent) agent = selectedAgent;
            }
        }
    }

    for (const file of taskFiles) {
        if (!existsSync(file)) {
            die(`Input file not found: ${file}`);
        }
    }

    function inferType(filePath) {
        if (filePath.includes('.agents/research/')) return 'spec';
        if (filePath.includes('.agents/audits/')) return 'refactor';
        if (filePath.includes('.agents/specs/')) return 'feature';
        if (filePath.includes('.agents/bugs/')) return 'fix';
        return 'feature';
    }

    const tasks = taskFiles.map((file, i) => {
        const type = inferType(file);
        const name = file.split('/').pop().replace('.md', '');
        return { file: file.replace(REPO_ROOT + '/', ''), type, name, id: `Task ${i + 1}` };
    });

    const slug = `delegator-${toSlug(title, 40)}`;
    const branchName = `agent/${slug}`;
    const worktreeAbs = resolve(REPO_ROOT, `../webdaw--${slug}`);

    console.log(`\n\x1b[34m[Delegator]\x1b[0m Preparing Lead Engineer session: ${cyan(slug)} (${agent})`);

    const existingWT = findWorktreeForBranch(branchName, REPO_ROOT);
    if (!existingWT && !existsSync(worktreeAbs)) {
        console.log(dim(`Creating integration worktree at ${worktreeAbs}...`));
        worktreeCreate(worktreeAbs, branchName, 'main', REPO_ROOT);
    } else if (existingWT) {
        console.log(dim(`Worktree already exists at ${existingWT}`));
    }

    const taskFileAbs = join(worktreeAbs, `.agents/tasks/${slug}.md`);
    mkdirSync(join(worktreeAbs, '.agents/tasks'), { recursive: true });

    const templateContent = `# ${title}

## Metadata

- Slug: ${slug}
- Role: Lead Engineer / Orchestrator
- Status: active

---

## Objective

You are the Lead Engineer. You have been assigned multiple tasks to complete.
Your job is NOT to write the code yourself. Your job is to intelligently delegate these tasks to a team of worker agents running in parallel, and then rigorously review their work before merging.

## Assigned Tasks

${tasks
    .map(
        (t) => `### ${t.id}: ${t.name}
- **Type:** ${t.type}
- **Input:** \`${t.file}\`
- **Launch Command:**
  \`\`\`bash
  pnpm agents:new --type ${t.type} --spec "${t.file}" --terminal current --agent-args='-p "Read the objective, execute the plan, write the tests, run typecheck, commit the result, and exit 0."' -- "${t.name}" &
  \`\`\`
`
    )
    .join('\n')}

---

## Orchestration Rules

1. **Autonomous Worker Mode:** Use the exact launch commands provided above. They include the \`&\` to run in the background. Capture their PIDs and \`wait\` for them.
   Example:
   \`\`\`bash
   pnpm agents:new ... &
   P1=$!
   pnpm agents:new ... &
   P2=$!
   wait $P1 $P2
   \`\`\`

2. **Adversarial Review (The Skeptic Persona):** Once a worker finishes, you MUST use the review macro with the \`--feedback\` flag to generate a comprehensive report of their changes and automatically append it to their task file:
   \`\`\`bash
   pnpm delegator:review <worker-slug> --feedback
   \`\`\`
   Read the output carefully. It will show the diff, typecheck results, and dependency validation. Do not trust the worker blindly.

3. **Iterate or Merge:** If the worker's branch is flawless, you may merge it into YOUR current integration branch (\`${branchName}\`). If it fails your review, the feedback was already appended to their task file by the review command. You just need to relaunch them to fix it:
   \`\`\`bash
   pnpm agents:open <worker-slug> --terminal current --agent-args='-p "Read the new feedback at the bottom of your task file and fix the issues. Commit and exit 0 when done."' &
   \`\`\`

---

## Plan

1. Analyze the assigned tasks.
2. Launch the workers in parallel using the provided commands.
3. Wait for them to finish.
4. Perform an adversarial review of each worker's branch.
5. Merge successful branches, kick back failures.

---

## Progress Log

- [ ] Analyze inputs
- [ ] Launch workers
- [ ] Wait for completion
${tasks.map((t) => `- [ ] Review ${t.id}`).join('\n')}

---

## Findings

(Record any architectural issues or worker failures here)

---

## Final Review

Stop. Before you consider this delegation complete, did you verify the workers mathematically and behaviorally? Did you run the compiler on their merged branches in this integration worktree?

Once all workers are successfully merged into your integration branch (\`${branchName}\`), write a final summary of what was accomplished and provide clear instructions for the human developer on how to test this integration branch locally before they manually merge it into main.`;

    writeFileSync(taskFileAbs, templateContent, 'utf8');

    if (flags.has('no-launch')) {
        console.log(green(`\n✓ Sandbox created: ${slug}`));
        return;
    }

    const config = loadConfig(REPO_ROOT);
    const terminal = flags.get('terminal') || config.defaultTerminal;
    const backend = resolveBackend(terminal);

    const backendCheck = checkBackend(backend);
    if (!backendCheck.ok) {
        die(`Terminal backend "${backend}" not available: ${backendCheck.reason}`);
    }

    const adapter = await import(`./agents/adapters/${agent}.ts`);
    const agentArgs = adapter.buildArgs(slug, [], {
        taskFile: `.agents/tasks/${slug}.md`,
        branch: branchName,
        worktreePath: worktreeAbs,
    });

    console.log(dim(`Launching Lead Engineer in ${backend}...`));
    launch(backend, worktreeAbs, adapter.command, agentArgs, {
        title: `Lead: ${title}`,
        slug,
        branch: branchName,
        taskFile: `.agents/tasks/${slug}.md`,
        agent,
    });
}

async function cmdReview(args) {
    const { flags, positional } = parseArgs(args);
    if (positional.length === 0) {
        die('Usage: pnpm delegator:review <slug> [--feedback]');
    }
    const slug = positional[0];
    const isFeedback = flags.has('feedback');

    // The slug provided is the exact slug. Branch is `agent/<slug>`.
    const branchName = `agent/${slug}`;
    const worktreePath = findWorktreeForBranch(branchName, REPO_ROOT);

    if (!worktreePath) {
        die(`Worktree for branch ${branchName} not found. Is the sandbox active?`);
    }

    const config = loadConfig(REPO_ROOT);
    const cmds = config.commands || {};
    const cmdTypecheckStr = cmds.typecheck || 'pnpm typecheck';
    const cmdValidateDepsStr = cmds.validateDeps || 'pnpm deps:validate';

    const [tcCmd, ...tcArgs] = cmdTypecheckStr.split(' ');
    const [depsCmd, ...depsArgs] = cmdValidateDepsStr.split(' ');

    // Try to determine the base branch from the task file
    let baseBranch = 'main';
    const taskFileAbs = join(worktreePath, `.agents/tasks/${slug}.md`);
    if (existsSync(taskFileAbs)) {
        const taskFileContent = readFileSync(taskFileAbs, 'utf8');
        const baseMatch = taskFileContent.match(/-\s+Base:\s+([^\r\n]+)/);
        if (baseMatch && baseMatch[1]) {
            baseBranch = baseMatch[1].trim();
        }
    }

    let report = `\n## Delegator Review (${new Date().toISOString()})\n\n`;

    console.log(`\n${bold(cyan('┌'))} ${bold(cyan('Adversarial Review Report:'))} ${cyan(slug)}`);
    console.log(`${cyan('│')} ${cyan('Worktree:')} ${worktreePath}`);
    console.log(`${cyan('│')} ${cyan('Base Branch:')} ${baseBranch}`);
    console.log(`${cyan('└' + '─'.repeat(50))}\n`);

    console.log(bold(yellow(`1. Diff (${baseBranch}...HEAD):`)));
    const diffResult = spawnSync('git', ['diff', `${baseBranch}...HEAD`, '--stat'], {
        cwd: worktreePath,
        encoding: 'utf8',
    });
    const diffOut = diffResult.stdout || '(No changes)\n';
    console.log(diffOut || dim('(No changes)'));
    report += `### Diff (${baseBranch}...HEAD)\n\`\`\`text\n${diffOut.trim()}\n\`\`\`\n\n`;

    console.log(bold(yellow(`2. Typecheck (${cmdTypecheckStr}):`)));
    const typecheckResult = spawnSync(tcCmd, tcArgs, { cwd: worktreePath, encoding: 'utf8' });
    let tcStatus = 'Failed';
    if (typecheckResult.status === 0) {
        console.log(green('✓ Typecheck passed.'));
        tcStatus = 'Passed';
    } else {
        console.log(red('✗ Typecheck failed:'));
        console.log(typecheckResult.stdout);
    }

    // Truncate overly long compiler errors for the LLM
    let tcOut = typecheckResult.stdout || '';
    if (tcOut.split('\\n').length > 50) {
        tcOut = tcOut.split('\\n').slice(0, 50).join('\\n') + '\\n... (truncated for brevity)';
    }
    report += `### Typecheck: ${tcStatus}\n\`\`\`text\n${tcOut.trim()}\n\`\`\`\n\n`;

    console.log('\n' + bold(yellow(`3. Dependency Validation (${cmdValidateDepsStr}):`)));
    const depsResult = spawnSync(depsCmd, depsArgs, { cwd: worktreePath, encoding: 'utf8' });
    let depsStatus = 'Failed';
    if (depsResult.status === 0) {
        console.log(green('✓ Dependencies valid (No architectural violations).'));
        depsStatus = 'Passed';
    } else {
        console.log(red('✗ Dependency validation failed:'));
        console.log(depsResult.stdout);
    }

    let depsOut = depsResult.stdout || '';
    if (depsOut.split('\\n').length > 50) {
        depsOut = depsOut.split('\\n').slice(0, 50).join('\\n') + '\\n... (truncated for brevity)';
    }
    report += `### Dependency Validation: ${depsStatus}\n\`\`\`text\n${depsOut.trim()}\n\`\`\`\n\n`;

    if (isFeedback) {
        if (existsSync(taskFileAbs)) {
            appendFileSync(taskFileAbs, report, 'utf8');
            console.log('\n' + bold(green(`✓ Review automatically appended to worker's task file.`)));
        } else {
            console.log('\n' + bold(red(`✗ Cannot append feedback: Task file not found at ${taskFileAbs}`)));
        }
    } else {
        console.log('\n' + bold(cyan('Done. Use the results above to formulate your feedback for the worker.')) + '\n');
    }
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
