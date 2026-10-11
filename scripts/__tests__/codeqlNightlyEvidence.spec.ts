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
        expect(workflow.permissions).toEqual({});
        expect(workflow.jobs.validate.permissions).toEqual({
            actions: 'read',
            contents: 'read',
            'security-events': 'read',
        });
        expect(workflow.jobs.publish.permissions).toEqual({ contents: 'read', issues: 'write' });
        expect(workflow.jobs.publish.if).toContain("needs.validate.outputs.supported == 'true'");
        for (const job of Object.values(workflow.jobs) as Array<{
            steps: Array<{ uses?: string; with?: { ref?: string } }>;
        }>) {
            const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
            expect(checkout?.with?.ref).toBe('${{ github.sha }}');
        }
    });

    it('enumerates every artifact page before deciding whether identity is ambiguous', async () => {
        const responses = [
            { total_count: 101, artifacts: Array.from({ length: 100 }, (_, id) => ({ id, name: 'other' })) },
            { total_count: 101, artifacts: [{ id: 101, name: 'nightly-evidence-v1' }] },
        ];
        const fetcher = vi.fn(async () => new Response(JSON.stringify(responses.shift()), { status: 200 }));
        vi.stubGlobal('fetch', fetcher);
        try {
            const artifacts = await githubEvidencePort('fixture-token').listArtifacts(42);
            expect(artifacts).toHaveLength(101);
            expect(fetcher.mock.calls).toHaveLength(2);
        } finally {
            vi.unstubAllGlobals();
        }
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
        brokenCrc[position + 16] ^= 1;
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
        f.analyses[0].analysis_key = '.github/workflows/nightly.yml:codeql';
        f.analyses[0].created_at = '2026-10-11T01:50:00Z';
        await expect(validateNightlyEvidence(f.event, f.port)).rejects.toThrow('CodeQL analysis');
    });
});
