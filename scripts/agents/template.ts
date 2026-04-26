import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const METADATA_START = '## Metadata';

/**
 * Render a task template with given data.
 * @param {string} templateContent
 * @param {object} data
 * @returns {string}
 */
export function renderTemplate(templateContent, data) {
    const cmds = data.commands || {};
    return templateContent
        .replace(/\{\{title\}\}/g, data.title || '')
        .replace(/\{\{slug\}\}/g, data.slug || '')
        .replace(/\{\{agent\}\}/g, data.agent || '')
        .replace(/\{\{branch\}\}/g, data.branch || '')
        .replace(/\{\{baseBranch\}\}/g, data.baseBranch || '')
        .replace(/\{\{worktreePath\}\}/g, data.worktreePath || '')
        .replace(/\{\{createdAt\}\}/g, data.createdAt || '')
        .replace(/\{\{status\}\}/g, data.status || 'active')
        .replace(/\{\{taskFile\}\}/g, data.taskFile || '')
        .replace(/\{\{specFile\}\}/g, data.specFile || '')
        .replace(/\{\{type\}\}/g, data.type || '')
        .replace(/\{\{cmdInstall\}\}/g, cmds.install || 'npm i')
        .replace(/\{\{cmdTypecheck\}\}/g, cmds.typecheck || 'npm run typecheck')
        .replace(/\{\{cmdValidateDeps\}\}/g, cmds.validateDeps || 'npm run deps:validate')
        .replace(/\{\{cmdTest\}\}/g, cmds.test || 'npm test');
}

/**
 * Build the metadata block content.
 * @param {object} data
 * @returns {string}
 */
function buildMetadataBlock(data) {
    return [
        `## Metadata`,
        `- Slug: ${data.slug}`,
        ...(data.parent ? [`- Parent: ${data.parent}`] : []),
        `- Agent: ${data.agent}`,
        `- Branch: ${data.branch}`,
        `- Base: ${data.baseBranch}`,
        `- Worktree: ${data.worktreePath}`,
        `- Created: ${data.createdAt}`,
        `- Status: ${data.status || 'active'}`,
        ...(data.type ? [`- Type: ${data.type}`] : []),
        ...(data.specFile ? [`- Spec: ${data.specFile}`] : []),
    ].join('\n');
}

/**
 * Resolve which template file to use.
 * Prefers task-{type}.md when type is given, falls back to task.md.
 * @param {string} templateDir
 * @param {string} type
 * @returns {string|null}
 */
function resolveTemplatePath(templateDir, type) {
    if (type) {
        const typed = join(templateDir, `task-${type}.md`);
        if (existsSync(typed)) return typed;
    }
    const base = join(templateDir, 'task.md');
    if (existsSync(base)) return base;
    return null;
}

/**
 * Create a task file. If it already exists, preserve manual content but
 * update the metadata block.
 * @param {string} taskFilePath - absolute path
 * @param {string} templateDir  - absolute path to agents/templates/
 * @param {object} data
 */
export function createOrUpdateTaskFile(taskFilePath, templateDir, data) {
    if (existsSync(taskFilePath)) {
        // File exists — update metadata block only
        const existing = readFileSync(taskFilePath, 'utf8');
        const updated = updateMetadataInFile(existing, data);
        writeFileSync(taskFilePath, updated, 'utf8');
        return;
    }

    // Create from template
    const templatePath = resolveTemplatePath(templateDir, data.type);
    let content;
    if (templatePath) {
        content = renderTemplate(readFileSync(templatePath, 'utf8'), data);
    } else {
        content = defaultTemplate(data);
    }
    writeFileSync(taskFilePath, content, 'utf8');
}

/**
 * Update the metadata block inside an existing file, preserving everything else.
 * @param {string} content
 * @param {object} data
 * @returns {string}
 */
function updateMetadataInFile(content, data) {
    const newBlock = buildMetadataBlock(data);
    const startIdx = content.indexOf(METADATA_START);
    if (startIdx === -1) {
        // No metadata block found — append one
        return content.trimEnd() + '\n\n' + newBlock + '\n';
    }
    // Find the end of the metadata block (next ## heading or EOF)
    const afterStart = content.indexOf('\n## ', startIdx + 1);
    if (afterStart === -1) {
        return content.slice(0, startIdx) + newBlock + '\n';
    }
    return content.slice(0, startIdx) + newBlock + '\n' + content.slice(afterStart);
}

/**
 * Fallback template when no template file exists on disk.
 * @param {object} data
 * @returns {string}
 */
function defaultTemplate(data) {
    return `# ${data.title}

${buildMetadataBlock(data)}

## Objective
Describe the task here.

## Constraints
- Stay inside this worktree only.
- Do not switch branches.
- Do not merge.
- Do not push unless explicitly asked.

## Notes
-

## Self-review

Complete the Self-review section (copied from the appropriate \`task-*.md\` template) before declaring this task done — tasks are self-contained and do not use a separate handoff section.
`;
}
