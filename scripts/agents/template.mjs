import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const METADATA_START = '## Metadata';

/**
 * Build the team scope block for injection into {{teamScope}}.
 * @param {string} team
 * @param {string} teamLabel
 * @param {string[]} teamPaths
 * @returns {string}
 */
function buildTeamScope(team, teamLabel, teamPaths) {
  if (!team || !teamPaths || teamPaths.length === 0) {
    return 'This is a **cross-cutting task** with no team boundary. Use good judgement about blast radius and note any unexpected file changes in Findings.';
  }
  const pathList = teamPaths.map(p => `- \`${p}/\``).join('\n');
  return (
    `You are operating as **${teamLabel || team}**. Confine all changes to these paths:\n\n` +
    `${pathList}\n\n` +
    `Changes outside these paths require a **handoff note** in this task file — do not edit files you do not own.`
  );
}

/**
 * Render a task template with given data.
 * @param {string} templateContent
 * @param {object} data
 * @returns {string}
 */
export function renderTemplate(templateContent, data) {
  const teamScope = buildTeamScope(data.team, data.teamLabel, data.teamPaths);
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
    .replace(/\{\{team\}\}/g, data.team || 'cross-cutting')
    .replace(/\{\{teamScope\}\}/g, teamScope);
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
    `- Agent: ${data.agent}`,
    `- Branch: ${data.branch}`,
    `- Base: ${data.baseBranch}`,
    `- Worktree: ${data.worktreePath}`,
    `- Created: ${data.createdAt}`,
    `- Status: ${data.status || 'active'}`,
    ...(data.type ? [`- Type: ${data.type}`] : []),
    ...(data.team ? [`- Team: ${data.team}`] : []),
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

## Handoff
-
`;
}
