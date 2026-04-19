import { spawnSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Utilities to get repo paths
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const AGENTS_BIN = join(REPO_ROOT, 'scripts', 'agents.mjs');

function dirname(path) {
    const parts = path.split('/');
    parts.pop();
    return parts.join('/') || '.';
}

function die(msg) {
    console.error(`\x1b[31mError:\x1b[0m ${msg}`);
    process.exit(1);
}

function generateSlug(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 50);
}

// ─── Main Orchestrator Logic ─────────────────────────────────────────────────

async function run() {
    let args = process.argv.slice(2);
    
    if (args.length === 0 || args[0] === '--help') {
        console.log(`
Usage: pnpm delegator:new [agent] [title] [file1] [file2] ...

Launches a "Lead Engineer" agent whose sole purpose is to orchestrate multiple
worker agents concurrently using git worktrees.

Arguments:
  agent    (Optional) The agent to launch (e.g. claude, gemini, codex). Defaults to claude.
  title    A short title for the delegation session (e.g. "Fix auth and limits")
  files    Paths to specs, audits, or bugs that need to be delegated.

Example:
  pnpm delegator:new gemini "Fix auth and limits" .agents/specs/auth.md .agents/bugs/rate-limit.md
        `);
        process.exit(0);
    }

    const KNOWN_AGENTS = ['claude', 'gemini', 'codex', 'kimi', 'opencode'];
    let agent = 'claude';
    
    if (KNOWN_AGENTS.includes(args[0])) {
        agent = args[0];
        args = args.slice(1);
    }

    if (args.length === 0) {
        die("Missing title. Run with --help for usage.");
    }

    const title = args[0];
    const taskFiles = args.slice(1).map(f => resolve(process.cwd(), f));
    
    // Verify all input files exist
    for (const file of taskFiles) {
        if (!existsSync(file)) {
            die(`Input file not found: ${file}`);
        }
    }

    // Infer task type based on file path
    function inferType(filePath) {
        if (filePath.includes('.agents/research/')) return 'spec';
        if (filePath.includes('.agents/audits/')) return 'refactor';
        if (filePath.includes('.agents/specs/')) return 'feature';
        if (filePath.includes('.agents/bugs/')) return 'fix';
        return 'feature'; // Default fallback
    }

    const tasks = taskFiles.map((file, i) => {
        const type = inferType(file);
        const name = file.split('/').pop().replace('.md', '');
        return { file, type, name, id: `Task ${i + 1}` };
    });

    const slug = `delegator-${generateSlug(title)}`;
    
    console.log(`\x1b[34m[Delegator]\x1b[0m Preparing Lead Engineer session: ${slug} (${agent})`);

    // Create the delegation task file template
    const templateContent = `# ${title}

## Metadata

- Slug: ${slug}
- Role: Lead Engineer / Orchestrator
- Status: active

---

## Objective

You are the Lead Engineer. You have been handed multiple tasks to complete.
Your job is NOT to write the code yourself. Your job is to intelligently delegate these tasks to a team of worker agents running in parallel, and then rigorously review their work before merging.

## Assigned Tasks

${tasks.map(t => `### ${t.id}: ${t.name}
- **Type:** ${t.type}
- **Input:** \`${t.file}\`
- **Launch Command:**
  \`\`\`bash
  pnpm agents:new --type ${t.type} --spec "${t.file}" --terminal current --agent-args='-p "Read the objective, execute the plan, write the tests, run typecheck, commit the result, and exit 0."' -- "${t.name}" &
  \`\`\`
`).join('\n')}

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

2. **Adversarial Review (The Skeptic Persona):** Once a worker finishes, you MUST change directories to their isolated worktree or checkout their branch to review their commit. Read the diff, run \`pnpm typecheck\` and \`pnpm deps:validate\` yourself, and verify they wrote tests. Do not trust them blindly.

4. **Iterate or Merge:** If the worker's branch is flawless, you may merge it. If it fails your review, you must append your feedback to their task file and relaunch them to fix it.

5. **Resuming Incomplete Workers:** If a worker stops before finishing its task (e.g., due to a token limit or crash), do not start over. Write feedback directly into its task file and resume the worker in its existing sandbox using the \`open\` command:
   \`\`\`bash
   echo "## Lead Engineer Feedback: You stopped early. Please finish the API integration." >> ../sourdaw--<slug>/.agents/tasks/<slug>.md
   pnpm agents:open <slug> --terminal current --agent-args='-p "Read the feedback at the bottom of your task file and continue your work. Commit and exit 0 when done."' &
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
${tasks.map(t => `- [ ] Review ${t.id}`).join('\n')}

---

## Findings

(Record any architectural issues or worker failures here)

---

## Final Review

Stop. Before you consider this delegation complete, did you verify the workers mathematically and behaviorally? Did you run the compiler on their branches?
`;

    // Write the template somewhere the main launcher can grab it
    const tempTemplatePath = join(REPO_ROOT, '.agents', 'tmp-delegator.md');
    mkdirSync(join(REPO_ROOT, '.agents'), { recursive: true });
    writeFileSync(tempTemplatePath, templateContent);

    // Call the main agents script to spin up the environment for the delegator
    console.log(`\x1b[34m[Delegator]\x1b[0m Launching central agent...`);
    
    // We pass the temp template directly as a positional arg, the launcher handles it
    const spawnArgs = [AGENTS_BIN, 'new', agent, '--base', 'main', '--spec', tempTemplatePath, title];
    
    const child = spawn(process.execPath, spawnArgs, {
        cwd: REPO_ROOT,
        stdio: 'inherit'
    });

    child.on('close', (code) => {
        if (existsSync(tempTemplatePath)) {
            try { readFileSync(tempTemplatePath); unlinkSync(tempTemplatePath); } catch (e) {}
        }
        process.exit(code);
    });
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
