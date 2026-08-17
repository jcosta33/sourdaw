import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type IssueFormField = {
    type: string;
    id: string;
    label: string;
    required: boolean;
    defaultValue?: string;
    options?: string[];
};

export type IssueForm = {
    name: string;
    titlePrefix: string;
    labels: string[];
    fields: IssueFormField[];
};

export type IssueSubmission = {
    title: string;
    labels: string[];
    body: string;
};

const TEMPLATE_ALIASES: Record<string, string> = {
    bug: 'bug_report',
    feature: 'feature_request',
    'change-plan': 'change_plan',
};

export function resolveTemplatePath(templatesDir: string, name: string): string {
    const stem = TEMPLATE_ALIASES[name] ?? name;
    const path = join(templatesDir, `${stem}.yml`);
    if (!existsSync(path)) {
        fail(`unknown issue template: ${name}`);
    }
    return path;
}

export function parseIssueForm(yaml: string): IssueForm {
    const titlePrefix = quotedScalar(yaml, 'title');
    const labels = jsonScalar<string[]>(yaml, 'labels');
    const name = plainScalar(yaml, 'name');
    const bodyIndex = yaml.search(/^body:\s*$/m);
    if (bodyIndex < 0) {
        fail('issue form has no body');
    }
    const items = yaml
        .slice(bodyIndex)
        .split(/\n {2}- type: /)
        .slice(1);
    const fields: IssueFormField[] = [];
    for (const item of items) {
        const type = item.split('\n', 1)[0]?.trim();
        if (type === undefined || type === 'markdown') {
            continue;
        }
        const id = plainInBlock(item, 'id');
        const labelRaw = plainInBlock(item, 'label');
        if (id === undefined || labelRaw === undefined) {
            fail(`issue form field is missing id or label: ${type}`);
        }
        const label = unquote(labelRaw);
        const required = /required:\s*true/.test(item);
        const defaultValue = blockScalar(item, 'value');
        const options = listScalar(item, 'options');
        fields.push({
            type,
            id,
            label,
            required,
            ...(defaultValue !== undefined ? { defaultValue } : {}),
            ...(options !== undefined ? { options } : {}),
        });
    }
    return { name, titlePrefix, labels, fields };
}

export function composeIssueTitle(prefix: string, title: string): string {
    return title.startsWith(prefix) ? title : `${prefix}${title}`;
}

export function renderIssueSubmission(
    form: IssueForm,
    input: { title: string; fields: Record<string, string> }
): IssueSubmission {
    if (input.title.trim() === '') {
        fail('title is empty');
    }
    const sections: string[] = [];
    const labels = [...form.labels];
    for (const field of form.fields) {
        const provided = input.fields[field.id];
        const raw = nonempty(provided) ?? nonempty(field.defaultValue);
        if (raw === undefined) {
            if (field.required) {
                fail(`missing required field: ${field.id}`);
            }
            sections.push(`### ${field.label}\n\n_No response_`);
            continue;
        }
        const value = field.options !== undefined ? resolveOption(raw, field.options, field.id) : raw.trimEnd();
        if (field.id === 'priority' && /^P[0-3]$/.test(value)) {
            labels.push(`priority:${value}`);
        }
        sections.push(`### ${field.label}\n\n${value}`);
    }
    return {
        title: composeIssueTitle(form.titlePrefix, input.title.trim()),
        labels,
        body: `${sections.join('\n\n')}\n`,
    };
}

export function parseCliArgs(args: string[]): {
    help: boolean;
    create: boolean;
    template?: string;
    title?: string;
    fieldsPath?: string;
} {
    if (args[0] === '--help') {
        return { help: true, create: false };
    }
    const template = args[0];
    if (template === undefined || template.startsWith('--')) {
        fail('usage: pnpm issue:file <template> --title <title> --fields <json> [--create]');
    }
    let title: string | undefined;
    let fieldsPath: string | undefined;
    let create = false;
    for (let index = 1; index < args.length; index += 1) {
        const flag = args[index];
        if (flag === '--create') {
            create = true;
            continue;
        }
        const value = args[index + 1];
        if (flag === '--title' && value !== undefined) {
            title = value;
            index += 1;
            continue;
        }
        if (flag === '--fields' && value !== undefined) {
            fieldsPath = value;
            index += 1;
            continue;
        }
        fail(`unknown option: ${flag}`);
    }
    return { help: false, create, template, title, fieldsPath };
}

function resolveOption(value: string, options: string[], id: string): string {
    const trimmed = value.trim();
    const match = options.find((option) => option === trimmed || option.startsWith(`${trimmed} (`));
    if (match === undefined) {
        fail(`invalid ${id}: ${trimmed}`);
    }
    return match;
}

function nonempty(value: string | undefined): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    return value.trim() === '' ? undefined : value;
}

function quotedScalar(yaml: string, key: string): string {
    const match = new RegExp(`^${key}:\\s*(".*")\\s*$`, 'm').exec(yaml);
    if (match?.[1] === undefined) {
        fail(`issue form missing ${key}`);
    }
    return JSON.parse(match[1]) as string;
}

function jsonScalar<Parsed>(yaml: string, key: string): Parsed {
    const match = new RegExp(`^${key}:\\s*(\\[[\\s\\S]*?\\])\\s*$`, 'm').exec(yaml);
    if (match?.[1] === undefined) {
        fail(`issue form missing ${key}`);
    }
    return JSON.parse(match[1]) as Parsed;
}

function plainScalar(yaml: string, key: string): string {
    const match = new RegExp(`^${key}:\\s*(.+)\\s*$`, 'm').exec(yaml);
    if (match?.[1] === undefined) {
        fail(`issue form missing ${key}`);
    }
    return unquote(match[1]);
}

function plainInBlock(block: string, key: string): string | undefined {
    const match = new RegExp(`^\\s+${key}:\\s*(.+)\\s*$`, 'm').exec(block);
    return match?.[1] === undefined ? undefined : match[1].trim();
}

function unquote(value: string): string {
    if (value.startsWith('"') && value.endsWith('"')) {
        return JSON.parse(value) as string;
    }
    return value;
}

function blockScalar(block: string, key: string): string | undefined {
    const match = new RegExp(`^(\\s+)${key}:\\s*\\|\\s*$`, 'm').exec(block);
    if (match === null || match.index === undefined || match[1] === undefined) {
        return undefined;
    }
    const keyIndent = match[1].length;
    const start = match.index + match[0].length;
    const rest = block.slice(start).replace(/^\n/, '');
    const lines: string[] = [];
    for (const line of rest.split('\n')) {
        const indent = line.match(/^ */)?.[0].length ?? 0;
        if (line.trim() !== '' && indent <= keyIndent) {
            break;
        }
        lines.push(line);
    }
    while (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    if (lines.length === 0) {
        return undefined;
    }
    const contentIndent = Math.min(
        ...lines.filter((line) => line.trim() !== '').map((line) => line.match(/^ */)?.[0].length ?? 0)
    );
    return lines.map((line) => line.slice(contentIndent)).join('\n');
}

function listScalar(block: string, key: string): string[] | undefined {
    const match = new RegExp(`^(\\s+)${key}:\\s*$`, 'm').exec(block);
    if (match === null || match.index === undefined || match[1] === undefined) {
        return undefined;
    }
    const keyIndent = match[1].length;
    const start = match.index + match[0].length;
    const rest = block.slice(start).replace(/^\n/, '');
    const items: string[] = [];
    for (const line of rest.split('\n')) {
        const indent = line.match(/^ */)?.[0].length ?? 0;
        if (line.trim() !== '' && indent <= keyIndent) {
            break;
        }
        const item = /^\s+- (.*)$/.exec(line);
        if (item?.[1] !== undefined) {
            items.push(unquote(item[1].trim()));
        }
    }
    return items.length > 0 ? items : undefined;
}

function fail(message: string): never {
    throw new Error(message);
}

export function readFields(source: string): Record<string, string> {
    const parsed: unknown = source.trimStart().startsWith('{')
        ? JSON.parse(source)
        : JSON.parse(readFileSync(source, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        fail('--fields must be a JSON object');
    }
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
        fields[key] = fieldString(key, value);
    }
    return fields;
}

function fieldString(key: string, value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    return fail(`field ${key} must be a string`);
}

export function ghIssueCreateArgs(submission: IssueSubmission): string[] {
    const args = ['issue', 'create', '--title', submission.title, '--body', submission.body];
    for (const label of submission.labels) {
        args.push('--label', label);
    }
    return args;
}

function createIssue(submission: IssueSubmission): { url: string; number: number } {
    const result = spawnSync('gh', ghIssueCreateArgs(submission), { encoding: 'utf8' });
    if (result.status !== 0) {
        fail(result.stderr.trim() || 'gh issue create failed');
    }
    const url = result.stdout.trim();
    const number = Number(url.split('/').at(-1));
    if (!Number.isSafeInteger(number) || number <= 0) {
        fail(`gh issue create returned an unreadable url: ${url}`);
    }
    return { url, number };
}

function main(): number {
    try {
        const parsed = parseCliArgs(process.argv.slice(2));
        if (parsed.help) {
            console.log('Usage: pnpm issue:file <template> --title <title> --fields <json> [--create]');
            console.log('');
            console.log('Renders a tracker issue from .github/ISSUE_TEMPLATE using field ids as JSON.');
            console.log('--create files it with gh.');
            return 0;
        }
        if (parsed.template === undefined || parsed.title === undefined || parsed.fieldsPath === undefined) {
            fail('usage: pnpm issue:file <template> --title <title> --fields <json> [--create]');
        }
        const templatesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '.github/ISSUE_TEMPLATE');
        const form = parseIssueForm(readFileSync(resolveTemplatePath(templatesDir, parsed.template), 'utf8'));
        const submission = renderIssueSubmission(form, {
            title: parsed.title,
            fields: readFields(parsed.fieldsPath),
        });
        if (!parsed.create) {
            process.stdout.write(`${JSON.stringify(submission, null, 2)}\n`);
            return 0;
        }
        const created = createIssue(submission);
        process.stdout.write(
            `${JSON.stringify({ ...created, title: submission.title, labels: submission.labels }, null, 2)}\n`
        );
        return 0;
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        return 1;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.exit(main());
}
