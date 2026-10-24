import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

import { type EvidencePort, githubEvidencePort, validateNightlyEvidence } from '../codeqlNightlyEvidence.ts';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const ID = 1183242917;
const zip = (body: unknown) =>
    Buffer.from(zipSync({ 'evidence.json': new TextEncoder().encode(JSON.stringify(body)) }));
const evidence = () => ({
    version: 1,
    repositoryId: ID,
    workflowPath: '.github/workflows/nightly.yml',
    runId: 42,
    attempt: 1,
    event: 'schedule',
    headSha: HEAD,
    headRepositoryId: ID,
    baseSha: null,
    pullRequest: null,
});

function fixture() {
    const bytes = zip(evidence());
    const event = {
        action: 'completed',
        repository: { id: ID, full_name: 'jcosta33/sourdaw' },
        workflow_run: { id: 42, run_attempt: 1, head_sha: HEAD },
    };
    const run = {
        id: 42,
        run_attempt: 1,
        repository: { id: ID, full_name: 'jcosta33/sourdaw' },
        head_repository: { id: ID },
        path: '.github/workflows/nightly.yml',
        event: 'schedule',
        head_branch: 'main',
        head_sha: HEAD,
        status: 'completed',
        conclusion: 'failure',
        run_started_at: '2026-10-11T01:00:00Z',
        updated_at: '2026-10-11T02:00:00Z',
    };
    const artifact = {
        id: 99,
        name: 'nightly-evidence-v1',
        size_in_bytes: bytes.length,
        digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        expired: false,
        workflow_run: {
            id: 42,
            repository_id: ID,
            head_repository_id: ID,
            head_branch: 'main',
            head_sha: HEAD,
        },
    };
    const jobs = [
        {
            name: 'CodeQL',
            conclusion: 'success',
            started_at: '2026-10-11T01:20:00Z',
            completed_at: '2026-10-11T01:40:00Z',
        },
        { name: 'End-to-end report', conclusion: 'failure' },
    ];
    const analyses = [
        {
            id: 123,
            analysis_key: '.github/workflows/nightly.yml:codeql',
            commit_sha: HEAD,
            ref: 'refs/heads/main',
            tool: { name: 'CodeQL' },
            created_at: '2026-10-11T01:30:00Z',
        },
    ];
    const calls = { downloads: 0, jobs: 0, analyses: 0, ancestry: 0 };
    const port: EvidencePort = {
        getRun: async () => run,
        compareMain: async () => {
            calls.ancestry++;
            return { status: 'ahead', merge_base_commit: { sha: HEAD } };
        },
        listArtifacts: async () => [artifact],
        downloadArtifact: async () => {
            calls.downloads++;
            return bytes;
        },
        listJobs: async () => {
            calls.jobs++;
            return jobs;
        },
        listAnalyses: async () => {
            calls.analyses++;
            return analyses;
        },
    };
    return { event, run, artifact, jobs, analyses, calls, port, bytes };
}

describe('trusted nightly evidence consumer', () => {
    it('keeps issue permission in the publisher and checks out only default-branch code', () => {
        const workflow = parse(
            readFileSync(join(process.cwd(), '.github/workflows/nightly-evidence-report.yml'), 'utf8')
        );
        expect(workflow.on).toEqual({ workflow_run: { workflows: ['Nightly'], types: ['completed'] } });
        expect(workflow.permissions).toEqual({});
        expect(workflow.jobs.validate.permissions).toEqual({
            actions: 'read',
            contents: 'read',
            'security-events': 'read',
        });
        expect(workflow.jobs.publish.permissions).toEqual({ contents: 'read', issues: 'write' });
        expect(workflow.jobs.publish.needs).toBe('validate');
        expect(workflow.jobs.publish.if).toBe(
            "${{ needs.validate.outputs.supported == 'true' && needs.validate.outputs.failed_legs != '' }}"
        );
        expect(workflow.jobs.validate.steps.at(-1).env).toEqual({ GH_TOKEN: '${{ github.token }}' });
        for (const job of Object.values(workflow.jobs) as Array<{
            steps: Array<{ uses?: string; with?: { ref?: string; 'persist-credentials'?: boolean } }>;
        }>) {
            const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
            expect(checkout?.with?.ref).toBe('${{ github.sha }}');
            expect(checkout?.with?.['persist-credentials']).toBe(false);
        }
    });

    it('enumerates every artifact page before deciding whether identity is ambiguous', async () => {
        const responses = [
            { total_count: 101, artifacts: Array.from({ length: 100 }, (_, id) => ({ id, name: 'other' })) },
            { total_count: 101, artifacts: [{ id: 101, name: 'nightly-evidence-v1' }] },
        ];
        const runGh = vi.fn(
            (_args: readonly string[], _options: { env: NodeJS.ProcessEnv; maxBuffer: number; timeout: number }) =>
                Buffer.from(JSON.stringify(responses))
        );
        const artifacts = await githubEvidencePort('fixture-token', runGh).listArtifacts(42);
        expect(artifacts).toHaveLength(101);
        expect(runGh).toHaveBeenCalledOnce();
        const call = runGh.mock.calls.at(0);
        if (call === undefined) {
            throw new Error('Fake GitHub CLI was not called');
        }
        const [args, options] = call;
        expect(args).toEqual([
            'api',
            '--hostname',
            'github.com',
            '--method',
            'GET',
            '--paginate',
            '--slurp',
            'repos/jcosta33/sourdaw/actions/runs/42/artifacts?per_page=100',
        ]);
        expect(options.env.GH_TOKEN).toBe('fixture-token');
        expect(options.env.GITHUB_TOKEN).toBeUndefined();
        expect(args).not.toContain('fixture-token');
        expect(options.timeout).toBe(120_000);
        expect(options.maxBuffer).toBe(10 * 1024 * 1024);
        const incompleteGh = vi.fn(() =>
            Buffer.from(JSON.stringify([{ total_count: 2, artifacts: [{ id: 1, name: 'other' }] }]))
        );
        await expect(githubEvidencePort('fixture-token', incompleteGh).listArtifacts(42)).rejects.toThrow('Incomplete');
    });

    it('uses fixed read-only routes for every API read and a bounded immutable artifact download', async () => {
        const f = fixture();
        const outputByRoute = new Map<string, Buffer>([
            ['repos/jcosta33/sourdaw/actions/runs/42', Buffer.from(JSON.stringify(f.run))],
            [
                `repos/jcosta33/sourdaw/compare/${HEAD}...main`,
                Buffer.from(JSON.stringify({ status: 'ahead', merge_base_commit: { sha: HEAD } })),
            ],
            ['repos/jcosta33/sourdaw/actions/artifacts/99/zip', f.bytes],
            [
                'repos/jcosta33/sourdaw/actions/runs/42/attempts/1/jobs?per_page=100',
                Buffer.from(JSON.stringify([{ total_count: 2, jobs: f.jobs }])),
            ],
            [
                'repos/jcosta33/sourdaw/code-scanning/analyses?ref=refs%2Fheads%2Fmain&per_page=100',
                Buffer.from(JSON.stringify([f.analyses])),
            ],
        ]);
        const runGh = vi.fn(
            (args: readonly string[], _options: { env: NodeJS.ProcessEnv; maxBuffer: number; timeout: number }) => {
                const route = args.at(-1);
                const output = route === undefined ? undefined : outputByRoute.get(route);
                if (output === undefined) {
                    throw new Error('Unexpected fake route');
                }
                return output;
            }
        );
        const port = githubEvidencePort('fixture-token', runGh);
        await expect(port.getRun(42)).resolves.toEqual(f.run);
        await expect(port.compareMain(HEAD)).resolves.toMatchObject({ status: 'ahead' });
        await expect(port.listJobs(42, 1)).resolves.toEqual(f.jobs);
        await expect(port.listAnalyses('refs/heads/main')).resolves.toEqual(f.analyses);
        await expect(port.downloadArtifact(99)).resolves.toEqual(f.bytes);
        expect(
            runGh.mock.calls.every(([args]) => args.slice(0, 5).join(' ') === 'api --hostname github.com --method GET')
        ).toBe(true);
        expect(runGh.mock.calls.every(([args]) => !args.includes('fixture-token'))).toBe(true);
        const artifactCall = runGh.mock.calls.find(
            ([args]) => args.at(-1) === 'repos/jcosta33/sourdaw/actions/artifacts/99/zip'
        );
        expect(artifactCall?.[1].maxBuffer).toBe(10 * 1024 * 1024 + 1);
        await expect(port.listAnalyses('refs/heads/foreign')).rejects.toThrow('Unsupported analysis ref');
        await expect(port.downloadArtifact(0)).rejects.toThrow('Invalid artifact ID');
        expect(runGh).toHaveBeenCalledTimes(5);
        const oversizedGh = vi.fn(() => Buffer.alloc(10 * 1024 * 1024 + 1));
        await expect(githubEvidencePort('fixture-token', oversizedGh).downloadArtifact(99)).rejects.toThrow(
            'Artifact download exceeds bound'
        );
    });

    it('retains a sole end-to-end report failure and independently binds CodeQL', async () => {
        const f = fixture();
        await expect(validateNightlyEvidence(f.event, f.port)).resolves.toEqual({
            kind: 'validated',
            runId: 42,
            attempt: 1,
            failedLegs: ['End-to-end report'],
            analysisId: 123,
        });
        expect(f.calls).toEqual({ downloads: 1, jobs: 1, analyses: 1, ancestry: 1 });
    });

    it.each(['failure', 'timed_out', 'cancelled'])('reports an unsuccessful %s terminal leg', async (conclusion) => {
        const f = fixture();
        f.run.conclusion = conclusion;
        f.jobs.splice(1, 1, { name: 'End-to-end report', conclusion });

        await expect(validateNightlyEvidence(f.event, f.port)).resolves.toEqual({
            kind: 'validated',
            runId: 42,
            attempt: 1,
            failedLegs: ['End-to-end report'],
            analysisId: 123,
        });
        expect(f.calls).toEqual({ downloads: 1, jobs: 1, analyses: 1, ancestry: 1 });
    });

    it.each(['failure', 'timed_out', 'cancelled'])(
        'refuses an unsuccessful %s run without an unsuccessful terminal leg',
        async (conclusion) => {
            const f = fixture();
            f.run.conclusion = conclusion;
            f.jobs.splice(1, 1, { name: 'End-to-end report', conclusion: 'skipped' });

            await expect(validateNightlyEvidence(f.event, f.port)).rejects.toThrow(
                'Unsuccessful run has no unsuccessful job evidence'
            );
        }
    );

    it('preserves a successful run with no unsuccessful terminal legs', async () => {
        const f = fixture();
        f.run.conclusion = 'success';
        f.jobs.splice(1, 1, { name: 'End-to-end report', conclusion: 'success' });

        await expect(validateNightlyEvidence(f.event, f.port)).resolves.toEqual({
            kind: 'validated',
            runId: 42,
            attempt: 1,
            failedLegs: [],
            analysisId: 123,
        });
        expect(f.calls).toEqual({ downloads: 1, jobs: 1, analyses: 1, ancestry: 1 });
    });

    it('leaves legacy scheduled producers inert without downloading or reading jobs', async () => {
        const f = fixture();
        f.port.listArtifacts = async () => [];
        await expect(validateNightlyEvidence(f.event, f.port)).resolves.toEqual({
            kind: 'unsupported',
            reason: 'legacy-producer',
        });
        expect(f.calls).toEqual({ downloads: 0, jobs: 0, analyses: 0, ancestry: 1 });
    });

    it('rejects duplicate, expired, wrong-run, and wrong-repository artifacts', async () => {
        const f = fixture();
        f.port.listArtifacts = async () => [f.artifact, { ...f.artifact, id: 100 }];
        await expect(validateNightlyEvidence(f.event, f.port)).rejects.toThrow('Duplicate');
        f.port.listArtifacts = async () => [f.artifact];
        f.artifact.expired = true;
        await expect(validateNightlyEvidence(f.event, f.port)).rejects.toThrow('Expired');
        f.artifact.expired = false;
        f.artifact.workflow_run.id = 43;
        await expect(validateNightlyEvidence(f.event, f.port)).rejects.toThrow('mismatched');
        f.artifact.workflow_run.id = 42;
        f.artifact.workflow_run.head_repository_id = 123;
        await expect(validateNightlyEvidence(f.event, f.port)).rejects.toThrow('mismatched');
        expect(f.calls.jobs).toBe(0);
    });

    it('rejects changed digest, size, member, CRC, and typed identity', async () => {
        const f = fixture();
        f.artifact.digest = `sha256:${'0'.repeat(64)}`;
        await expect(validateNightlyEvidence(f.event, f.port)).rejects.toThrow('digest');
        f.artifact.digest = `sha256:${createHash('sha256').update(f.bytes).digest('hex')}`;
        f.artifact.size_in_bytes++;
        await expect(validateNightlyEvidence(f.event, f.port)).rejects.toThrow('size');
        f.artifact.size_in_bytes--;
        const wrongMember = Buffer.from(zipSync({ 'nested/evidence.json': new TextEncoder().encode('{}') }));
        f.port.downloadArtifact = async () => wrongMember;
        f.artifact.size_in_bytes = wrongMember.length;
        f.artifact.digest = `sha256:${createHash('sha256').update(wrongMember).digest('hex')}`;
        await expect(validateNightlyEvidence(f.event, f.port)).rejects.toThrow('Unexpected');
        const brokenCrc = Buffer.from(f.bytes);
        const position = brokenCrc.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
        if (position < 0) {
            throw new Error('Fixture is missing its ZIP central directory');
        }
        brokenCrc.writeUInt8(brokenCrc.readUInt8(position + 16) ^ 1, position + 16);
        f.port.downloadArtifact = async () => brokenCrc;
        f.artifact.size_in_bytes = brokenCrc.length;
        f.artifact.digest = `sha256:${createHash('sha256').update(brokenCrc).digest('hex')}`;
        await expect(validateNightlyEvidence(f.event, f.port)).rejects.toThrow(/CRC|size/);
        const wrongIdentity = zip({ ...evidence(), headSha: BASE });
        f.port.downloadArtifact = async () => wrongIdentity;
        f.artifact.size_in_bytes = wrongIdentity.length;
        f.artifact.digest = `sha256:${createHash('sha256').update(wrongIdentity).digest('hex')}`;
        await expect(validateNightlyEvidence(f.event, f.port)).rejects.toThrow('identity');
        expect(f.calls.jobs).toBe(0);
    });

    it('refuses changed event identity, reruns, forks, and PR runs without issue evidence', async () => {
        const f = fixture();
        f.event.workflow_run.head_sha = BASE;
        await expect(validateNightlyEvidence(f.event, f.port)).rejects.toThrow('identity');
        f.event.workflow_run.head_sha = HEAD;
        f.event.workflow_run.run_attempt = 2;
        f.run.run_attempt = 2;
        await expect(validateNightlyEvidence(f.event, f.port)).resolves.toEqual({
            kind: 'unsupported',
            reason: 'rerun',
        });
        f.event.workflow_run.run_attempt = 1;
        f.run.run_attempt = 1;
        f.run.head_repository.id = 123;
        await expect(validateNightlyEvidence(f.event, f.port)).rejects.toThrow('own-repository');
        f.run.head_repository.id = ID;
        f.run.event = 'pull_request';
        await expect(validateNightlyEvidence(f.event, f.port)).resolves.toEqual({
            kind: 'unsupported',
            reason: 'pull-request',
        });
        expect(f.calls.downloads).toBe(0);
    });

    it('rejects a scheduled SHA outside current main ancestry', async () => {
        const f = fixture();
        f.port.compareMain = async () => ({ status: 'diverged', merge_base_commit: { sha: BASE } });
        await expect(validateNightlyEvidence(f.event, f.port)).rejects.toThrow('main ancestry');
        expect(f.calls.downloads).toBe(0);
    });

    it('refuses missing CodeQL job or GHAS analysis and wrong analysis key', async () => {
        const f = fixture();
        f.jobs.shift();
        await expect(validateNightlyEvidence(f.event, f.port)).rejects.toThrow('CodeQL job');
        f.jobs.unshift({
            name: 'CodeQL',
            conclusion: 'success',
            started_at: '2026-10-11T01:20:00Z',
            completed_at: '2026-10-11T01:40:00Z',
        });
        f.analyses.length = 0;
        await expect(validateNightlyEvidence(f.event, f.port)).rejects.toThrow('CodeQL analysis');
        f.analyses.push({
            id: 123,
            analysis_key: '.github/workflows/health-gates.yml:codeql',
            commit_sha: HEAD,
            ref: 'refs/heads/main',
            tool: { name: 'CodeQL' },
            created_at: '2026-10-11T01:30:00Z',
        });
        await expect(validateNightlyEvidence(f.event, f.port)).rejects.toThrow('CodeQL analysis');
        const analysis = f.analyses.at(0);
        if (analysis === undefined) {
            throw new Error('Fixture is missing its CodeQL analysis');
        }
        analysis.analysis_key = '.github/workflows/nightly.yml:codeql';
        analysis.created_at = '2026-10-11T01:50:00Z';
        await expect(validateNightlyEvidence(f.event, f.port)).rejects.toThrow('CodeQL analysis');
    });
});
