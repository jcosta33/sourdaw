import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    composeIssueTitle,
    parseCliArgs,
    parseIssueForm,
    ghIssueCreateArgs,
    readFields,
    renderIssueSubmission,
    resolveTemplatePath,
    runCli,
    type IssueSubmission,
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

        expect(submission.title).toBe('spec(arrangement): mixer: mute groups');
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
        expect(submission.title).toBe('fix(security): csp ipv6');
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

    it('accepts slash aliases after the first scope token', () => {
        const form = parseIssueForm(load('bug_report.yml'));
        for (const [token, expected] of [
            ['ui', 'workspace-shell / ui (Presentation components, mixer, piano roll)'],
            ['airuntime', 'ai / airuntime (AI agentic tools, proposals, streaming)'],
            ['ci', 'build / ci (TypeScript, Rust, WASM, bundling)'],
            ['knead', 'yeast / bacteria / knead / levain / crumbs (Instruments & processors)'],
        ] as const) {
            const submission = renderIssueSubmission(form, {
                title: `fix(${token}): probe`,
                fields: {
                    scope: token,
                    priority: 'P2',
                    description: 'd',
                    reproduction: '1',
                },
            });
            expect(submission.body).toContain(`### Subsystem\n\n${expected}`);
        }
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
        expect(composeIssueTitle('spec(scope): ', 'spec(scope): mixer: mute', 'arrangement')).toBe(
            'spec(arrangement): mixer: mute'
        );
    });

    it('keeps an already conventional title', () => {
        expect(composeIssueTitle('spec(scope): ', 'spec(arrangement): mixer')).toBe('spec(arrangement): mixer');
    });

    it('interpolates the selected scope into the prefix', () => {
        expect(composeIssueTitle('spec(scope): ', 'mute groups', 'arrangement')).toBe('spec(arrangement): mute groups');
        expect(composeIssueTitle('spec(scope): ', 'arrangement: mute groups', 'arrangement')).toBe(
            'spec(arrangement): mute groups'
        );
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

    it('rejects a type(scope) prefix with no subject', () => {
        expect(() =>
            renderIssueSubmission(parseIssueForm(load('spec.yml')), {
                title: 'spec(scope): ',
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
    const submission: IssueSubmission = {
        title: 'spec(scope): mixer',
        body: '### Intent\n\nDone.\n',
        labels: ['status:tracking', 'priority:P1'],
    };

    const labelledArgs = [
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
    ];

    it('passes title, body, and each label', () => {
        expect(ghIssueCreateArgs(submission)).toEqual(labelledArgs);
    });

    it('adds nothing when neither milestone nor project is given', () => {
        expect(ghIssueCreateArgs(submission, {})).toEqual(labelledArgs);
    });

    it('adds nothing for empty metadata values', () => {
        expect(ghIssueCreateArgs(submission, { milestone: '', project: '' })).toEqual(labelledArgs);
    });

    it('appends the milestone alone', () => {
        expect(ghIssueCreateArgs(submission, { milestone: 'v1.2' })).toEqual([...labelledArgs, '--milestone', 'v1.2']);
    });

    it('appends the project alone', () => {
        expect(ghIssueCreateArgs(submission, { project: 'Sourdaw Roadmap' })).toEqual([
            ...labelledArgs,
            '--project',
            'Sourdaw Roadmap',
        ]);
    });

    it('orders labels, then milestone, then project', () => {
        expect(ghIssueCreateArgs(submission, { milestone: 'Editor Groundwork', project: 'Sourdaw Roadmap' })).toEqual([
            ...labelledArgs,
            '--milestone',
            'Editor Groundwork',
            '--project',
            'Sourdaw Roadmap',
        ]);
    });
});

describe('parseCliArgs', () => {
    const base = ['spec', '--title', 'mixer: mute groups', '--fields', '{"scope":"arrangement"}'];

    it('leaves milestone and project unset when the flags are absent', () => {
        const parsed = parseCliArgs([...base, '--create']);
        expect(parsed.create).toBe(true);
        expect(parsed.milestone).toBeUndefined();
        expect(parsed.project).toBeUndefined();
    });

    /**
     * Without `--create` the run is a preview. Filing is irreversible on a public tracker, so the
     * default has to be pinned: a `create` that defaults to true turns every preview into a write.
     */
    it('stays a dry run without --create', () => {
        expect(parseCliArgs(base).create).toBe(false);
        expect(parseCliArgs([...base, '--project', 'Sourdaw Roadmap']).create).toBe(false);
    });

    it('reads a milestone title', () => {
        expect(parseCliArgs([...base, '--milestone', 'Editor Groundwork']).milestone).toBe('Editor Groundwork');
        expect(parseCliArgs([...base, '--milestone', 'v1.2']).milestone).toBe('v1.2');
    });

    it('reads a project title and trims it', () => {
        expect(parseCliArgs([...base, '--project', '  Sourdaw Roadmap  ']).project).toBe('Sourdaw Roadmap');
    });

    it('reads both flags alongside --create', () => {
        const parsed = parseCliArgs([
            ...base,
            '--milestone',
            'Editor Groundwork',
            '--project',
            'Sourdaw Roadmap',
            '--create',
        ]);
        expect(parsed.milestone).toBe('Editor Groundwork');
        expect(parsed.project).toBe('Sourdaw Roadmap');
        expect(parsed.create).toBe(true);
    });

    it('rejects a milestone with no value', () => {
        expect(() => parseCliArgs([...base, '--milestone'])).toThrow(/missing value for --milestone/);
        expect(() => parseCliArgs([...base, '--milestone', '   '])).toThrow(/--milestone is empty/);
    });

    it('rejects a project with no value', () => {
        expect(() => parseCliArgs([...base, '--project'])).toThrow(/missing value for --project/);
        expect(() => parseCliArgs([...base, '--project', '   '])).toThrow(/--project is empty/);
    });

    /**
     * Swallowing the next flag as a value is worse than a plain parse error: `--milestone --create`
     * used to parse as milestone `--create` with `create` still false, so the operator asked to
     * file an issue, got a preview, and saw exit code 0.
     */
    it('rejects an option where a value belongs', () => {
        expect(() => parseCliArgs([...base, '--milestone', '--create'])).toThrow(
            /missing value for --milestone: --create is an option, not a value/
        );
        expect(() => parseCliArgs([...base, '--project', '--create'])).toThrow(
            /missing value for --project: --create is an option, not a value/
        );
        expect(() => parseCliArgs(['spec', '--fields', '{"scope":"arrangement"}', '--title', '--create'])).toThrow(
            /missing value for --title: --create is an option, not a value/
        );
        expect(() => parseCliArgs(['spec', '--title', 'mixer', '--fields', '--create'])).toThrow(
            /missing value for --fields: --create is an option, not a value/
        );
    });

    it('rejects a repeated milestone', () => {
        expect(() => parseCliArgs([...base, '--milestone', 'One', '--milestone', 'Two'])).toThrow(
            /duplicate option: --milestone/
        );
    });

    it('rejects a repeated project', () => {
        expect(() => parseCliArgs([...base, '--project', 'One', '--project', 'Two'])).toThrow(
            /duplicate option: --project/
        );
    });
});

describe('runCli', () => {
    const fields = '{"scope":"arrangement","priority":"P1","intent":"i","requirements":"r"}';
    const filing = ['spec', '--title', 'mixer: mute groups', '--fields', fields];

    /**
     * The runner is injected rather than mocked at `node:child_process`, because filing is an
     * irreversible public write: a module mock that silently stops intercepting files a real issue
     * and no assertion here would notice.
     */
    function fakeGh(result: { status: number; stdout: string; stderr: string }) {
        const calls: string[][] = [];
        return {
            calls,
            run: (args: string[]) => {
                calls.push(args);
                return result;
            },
        };
    }

    const created = { status: 0, stdout: 'https://github.com/jcosta33/sourdaw/issues/2270\n', stderr: '' };

    afterEach(() => {
        vi.restoreAllMocks();
    });

    /**
     * `parseCliArgs` and `ghIssueCreateArgs` each have their own tests, and both stay green when
     * the seam between them is cut — the flags parse, validate, and are then dropped before `gh`
     * is reached. Only an assertion on the argv that actually leaves the process sees that.
     */
    it('hands the parsed milestone and project to gh', () => {
        const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
        const gh = fakeGh(created);

        const code = runCli(
            [...filing, '--milestone', 'Editor Groundwork', '--project', 'Sourdaw Roadmap', '--create'],
            gh.run
        );

        expect(code).toBe(0);
        expect(gh.calls).toHaveLength(1);
        expect(gh.calls[0]?.slice(-4)).toEqual(['--milestone', 'Editor Groundwork', '--project', 'Sourdaw Roadmap']);
        expect(String(stdout.mock.calls[0]?.[0])).toContain('"number": 2270');
    });

    it('reaches gh only with --create', () => {
        const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
        const gh = fakeGh(created);

        expect(runCli([...filing, '--milestone', 'Editor Groundwork'], gh.run)).toBe(0);

        expect(gh.calls).toEqual([]);
        expect(String(stdout.mock.calls[0]?.[0])).toContain('"title": "spec(arrangement): mixer: mute groups"');
    });

    /**
     * gh attaches a v2 project in a second mutation after `createIssue` has already returned an
     * issue, and `create.go` returns on that error before printing the URL. A nonzero exit with
     * `--project` set therefore does not mean nothing was filed, and a blind retry duplicates it.
     */
    it('says the issue may exist when a project attach fails', () => {
        const consoleError = vi.spyOn(console, 'error').mockReturnValue(undefined);
        const gh = fakeGh({ status: 1, stdout: '', stderr: 'failed to add project: HTTP 403\n' });

        expect(runCli([...filing, '--project', 'Sourdaw Roadmap', '--create'], gh.run)).toBe(1);

        const reported = String(consoleError.mock.calls[0]?.[0]);
        expect(reported).toContain('failed to add project: HTTP 403');
        expect(reported).toContain('the issue may already have been created');
    });

    it('does not hedge on a failure with no project to attach', () => {
        const consoleError = vi.spyOn(console, 'error').mockReturnValue(undefined);
        const gh = fakeGh({ status: 1, stdout: '', stderr: 'GraphQL: Could not resolve to a Repository\n' });

        expect(runCli([...filing, '--milestone', 'Editor Groundwork', '--create'], gh.run)).toBe(1);

        expect(String(consoleError.mock.calls[0]?.[0])).toBe('GraphQL: Could not resolve to a Repository');
    });
});
