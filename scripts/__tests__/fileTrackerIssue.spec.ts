import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    composeIssueTitle,
    parseIssueForm,
    ghIssueCreateArgs,
    readFields,
    renderIssueSubmission,
    resolveTemplatePath,
} from '../fileTrackerIssue';

const templates = join(process.cwd(), '.github/ISSUE_TEMPLATE');

function load(name: string): string {
    return readFileSync(join(templates, name), 'utf8');
}

describe('parseIssueForm', () => {
    it('keeps markdown blocks out of fillable fields', () => {
        const form = parseIssueForm(load('spec.yml'));
        expect(form.titlePrefix).toBe('spec(scope): ');
        expect(form.labels).toEqual(['status:tracking']);
        expect(form.fields.map((field) => field.id)).toEqual([
            'scope',
            'priority',
            'intent',
            'requirements',
            'boundary',
            'sources',
        ]);
        expect(form.fields.every((field) => field.type !== 'markdown')).toBe(true);
    });

    it('captures Campaign operating-loop default', () => {
        const loop = parseIssueForm(load('campaign.yml')).fields.find((field) => field.id === 'operating_loop');
        expect(loop?.required).toBe(true);
        expect(loop?.defaultValue).toMatch(/^1\. Read this campaign and every authority\./);
        expect(loop?.defaultValue).toContain('and ownership');
    });
});

describe('renderIssueSubmission', () => {
    it('emits GitHub form headings and skips instruction markdown', () => {
        const submission = renderIssueSubmission(parseIssueForm(load('spec.yml')), {
            title: 'mixer: mute groups',
            fields: {
                scope: 'arrangement',
                priority: 'P1',
                intent: 'Mute groups exist for the mixer operator.',
                requirements:
                    '### AC-001\n- When: always\n- Then: mute MUST apply to the group\n- Verify with: pnpm test:run x',
            },
        });

        expect(submission.title).toBe('spec(scope): mixer: mute groups');
        expect(submission.labels).toEqual(['status:tracking', 'priority:P1']);
        expect(submission.body).toContain('### Intent\n\nMute groups exist for the mixer operator.');
        expect(submission.body).toContain('### Boundary\n\n_No response_');
        expect(submission.body).not.toContain('Secrets stay in');
        expect(submission.body).not.toContain('File when every blocking choice');
    });

    it('uses the Campaign operating-loop default when omitted', () => {
        const submission = renderIssueSubmission(parseIssueForm(load('campaign.yml')), {
            title: 'feat(campaign): native plugins',
            fields: {
                priority: 'P2',
                objective: 'Ship native plugin hosting.',
                completion: 'A hosted plugin processes audio.',
                authorities: 'ADR 0021.',
                stops: 'None.',
            },
        });
        expect(submission.body).toContain('### Operating loop\n\n1. Read this campaign and every authority.');
        expect(submission.labels).toEqual(['epic', 'status:tracking', 'priority:P2']);
    });

    it('accepts the Bug scope token without the parenthetical', () => {
        const submission = renderIssueSubmission(parseIssueForm(load('bug_report.yml')), {
            title: 'csp ipv6',
            fields: {
                scope: 'security',
                priority: 'P0',
                description: 'connect-src drops IPv6 literals.',
                reproduction: '1. Load\n2. Observe',
            },
        });
        expect(submission.body).toContain('### Subsystem\n\nsecurity (CSP, sandbox, memory safety)');
        expect(submission.labels).toEqual(['bug', 'status:ready', 'priority:P0']);
    });

    it('accepts the Bug ai token against ai / airuntime', () => {
        const submission = renderIssueSubmission(parseIssueForm(load('bug_report.yml')), {
            title: 'ai: stream abort',
            fields: {
                scope: 'ai',
                priority: 'P2',
                description: 'stream abort drops the last token.',
                reproduction: '1. Prompt\n2. Abort',
            },
        });
        expect(submission.body).toContain('### Subsystem\n\nai / airuntime (AI agentic tools, proposals, streaming)');
    });

    it('rejects a missing required field', () => {
        expect(() =>
            renderIssueSubmission(parseIssueForm(load('feature_request.yml')), {
                title: 'meter color',
                fields: { scope: 'workspace-shell / ui', priority: 'P3' },
            })
        ).toThrow(/intent/);
    });
});

describe('composeIssueTitle', () => {
    it('does not double the form prefix', () => {
        expect(composeIssueTitle('spec(scope): ', 'spec(scope): mixer: mute')).toBe('spec(scope): mixer: mute');
    });

    it('keeps an already conventional title', () => {
        expect(composeIssueTitle('spec(scope): ', 'spec(arrangement): mixer')).toBe('spec(arrangement): mixer');
    });
});

describe('resolveTemplatePath', () => {
    it('maps aliases onto form files', () => {
        expect(resolveTemplatePath(templates, 'bug')).toBe(join(templates, 'bug_report.yml'));
        expect(resolveTemplatePath(templates, 'feature')).toBe(join(templates, 'feature_request.yml'));
        expect(resolveTemplatePath(templates, 'change-plan')).toBe(join(templates, 'change_plan.yml'));
    });
});

describe('readFields', () => {
    it('parses inline JSON and coerces numbers', () => {
        expect(readFields('{"parent_spec":2037,"priority":"P1"}')).toEqual({
            parent_spec: '2037',
            priority: 'P1',
        });
    });

    it('reads a JSON file path', () => {
        const dir = mkdtempSync(join(tmpdir(), 'issue-file-'));
        const path = join(dir, 'fields.json');
        writeFileSync(path, '{"scope":"security"}');
        expect(readFields(path)).toEqual({ scope: 'security' });
    });
});

describe('renderIssueSubmission title', () => {
    it('rejects a blank title', () => {
        expect(() =>
            renderIssueSubmission(parseIssueForm(load('spec.yml')), {
                title: '   ',
                fields: { scope: 'arrangement', priority: 'P2', intent: 'i', requirements: 'r' },
            })
        ).toThrow(/title is empty/);
    });

    it('rejects an invalid dropdown value', () => {
        expect(() =>
            renderIssueSubmission(parseIssueForm(load('spec.yml')), {
                title: 'mixer',
                fields: { scope: 'arrangement', priority: 'P9', intent: 'i', requirements: 'r' },
            })
        ).toThrow(/invalid priority/);
    });
});

describe('research options field', () => {
    it('does not treat Options comparison as a dropdown', () => {
        const field = parseIssueForm(load('research.yml')).fields.find((entry) => entry.id === 'options');
        expect(field?.type).toBe('textarea');
        expect(field?.options).toBeUndefined();
    });
});

describe('ghIssueCreateArgs', () => {
    it('passes title, body, and each label', () => {
        const submission = {
            title: 'spec(scope): mixer',
            body: '### Intent\n\nDone.\n',
            labels: ['status:tracking', 'priority:P1'],
        };
        expect(ghIssueCreateArgs(submission)).toEqual([
            'issue',
            'create',
            '--title',
            'spec(scope): mixer',
            '--body',
            submission.body,
            '--label',
            'status:tracking',
            '--label',
            'priority:P1',
        ]);
    });
});
