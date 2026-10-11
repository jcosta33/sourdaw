/**
 * Trusted consumer for `nightly-evidence-v1`. The future Nightly producer must
 * upload one ZIP named `nightly-evidence-v1` containing exactly `evidence.json`.
 * The JSON binds the run identity; jobs and CodeQL analysis are read again from
 * GitHub. This consumer is deliberately inert until that producer exists.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';

import { readHostedArtifactZip, hostedWasmOutputLimit } from './hostedWasmZip.ts';

const REPOSITORY = 'jcosta33/sourdaw';
const REPOSITORY_ID = 1183242917;
const WORKFLOW = '.github/workflows/nightly.yml';
const ARTIFACT = 'nightly-evidence-v1';
const ANALYSIS_KEY = `${WORKFLOW}:codeql`;
const SHA = /^[0-9a-f]{40}$/;
const SAFE_LEG = /^[A-Za-z0-9 ()/.-]{1,90}$/;

type RecordValue = Record<string, unknown>;

function record(value: unknown, name: string): RecordValue {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`Invalid ${name}`);
    }
    return value as RecordValue;
}

function integer(value: unknown, name: string): number {
    if (!Number.isSafeInteger(value) || Number(value) <= 0) {
        throw new Error(`Invalid ${name}`);
    }
    return Number(value);
}

function sha(value: unknown, name: string): string {
    if (typeof value !== 'string' || !SHA.test(value)) {
        throw new Error(`Invalid ${name}`);
    }
    return value;
}

export type EvidencePort = {
    getRun(id: number): Promise<unknown>;
    compareMain(headSha: string): Promise<unknown>;
    listArtifacts(id: number): Promise<unknown[]>;
    downloadArtifact(id: number): Promise<Buffer>;
    listJobs(id: number, attempt: number): Promise<unknown[]>;
    listAnalyses(ref: string): Promise<unknown[]>;
};

export type ReportDecision =
    | { kind: 'unsupported'; reason: 'legacy-producer' | 'pull-request' | 'rerun' }
    | { kind: 'validated'; runId: number; attempt: 1; failedLegs: string[]; analysisId: number };

type ScheduledRun = { run: RecordValue; runId: number; headSha: string };

/** The event is a hint only. Each decisive run field is fetched independently. */
async function loadScheduledRun(eventValue: unknown, port: EvidencePort): Promise<ScheduledRun | ReportDecision> {
    const event = record(eventValue, 'workflow_run event');
    const eventRun = record(event.workflow_run, 'event workflow run');
    const eventRepository = record(event.repository, 'event repository');
    const runId = integer(eventRun.id, 'event run ID');
    if (
        event.action !== 'completed' ||
        eventRepository.full_name !== REPOSITORY ||
        eventRepository.id !== REPOSITORY_ID
    ) {
        throw new Error('Wrong event or repository');
    }
    const run = record(await port.getRun(runId), 'fetched run');
    const repository = record(run.repository, 'run repository');
    const headRepository = record(run.head_repository, 'run head repository');
    const headSha = sha(run.head_sha, 'run head SHA');
    if (
        run.id !== runId ||
        eventRun.run_attempt !== run.run_attempt ||
        eventRun.head_sha !== headSha ||
        repository.id !== REPOSITORY_ID ||
        repository.full_name !== REPOSITORY ||
        run.path !== WORKFLOW ||
        run.status !== 'completed' ||
        !['success', 'failure', 'cancelled', 'timed_out'].includes(String(run.conclusion))
    ) {
        throw new Error('Event and fetched run identity disagree');
    }
    if (run.event === 'pull_request') {
        return { kind: 'unsupported', reason: 'pull-request' };
    }
    if (run.event !== 'schedule' || run.head_branch !== 'main' || headRepository.id !== REPOSITORY_ID) {
        throw new Error('Only an own-repository scheduled main run is eligible');
    }
    if (run.run_attempt !== 1) {
        return { kind: 'unsupported', reason: 'rerun' };
    }
    const ancestry = record(await port.compareMain(headSha), 'main ancestry');
    if (
        !['ahead', 'identical'].includes(String(ancestry.status)) ||
        record(ancestry.merge_base_commit, 'main merge base').sha !== headSha
    ) {
        throw new Error('Scheduled revision is not in main ancestry');
    }
    return { run, runId, headSha };
}

function assertEvidenceIdentity(evidence: RecordValue, runId: number, headSha: string): void {
    if (
        Object.keys(evidence).sort().join(',') !==
            'attempt,baseSha,event,headRepositoryId,headSha,pullRequest,repositoryId,runId,version,workflowPath' ||
        evidence.version !== 1 ||
        evidence.repositoryId !== REPOSITORY_ID ||
        evidence.workflowPath !== WORKFLOW ||
        evidence.runId !== runId ||
        evidence.attempt !== 1 ||
        evidence.event !== 'schedule' ||
        evidence.headSha !== headSha ||
        evidence.headRepositoryId !== REPOSITORY_ID ||
        evidence.baseSha !== null ||
        evidence.pullRequest !== null
    ) {
        throw new Error('Evidence identity disagrees with fetched run');
    }
}

async function hasValidEvidence(port: EvidencePort, runId: number, headSha: string): Promise<boolean> {
    // The unfiltered, fully paginated list is required: a second same-name
    // artifact hidden on another page is an ambiguity, not a replacement.
    const artifacts = (await port.listArtifacts(runId)).filter((entry) => record(entry, 'artifact').name === ARTIFACT);
    if (artifacts.length === 0) {
        return false;
    }
    if (artifacts.length !== 1) {
        throw new Error('Duplicate nightly evidence artifacts');
    }
    const artifact = record(artifacts[0], 'nightly evidence artifact');
    const artifactRun = record(artifact.workflow_run, 'artifact workflow run');
    const artifactId = integer(artifact.id, 'artifact ID');
    const size = integer(artifact.size_in_bytes, 'artifact size');
    if (
        artifact.expired !== false ||
        size > hostedWasmOutputLimit ||
        artifactRun.id !== runId ||
        artifactRun.repository_id !== REPOSITORY_ID ||
        artifactRun.head_repository_id !== REPOSITORY_ID ||
        artifactRun.head_sha !== headSha ||
        artifactRun.head_branch !== 'main'
    ) {
        throw new Error('Expired, oversized, or mismatched artifact');
    }
    const digest = artifact.digest;
    if (typeof digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(digest)) {
        throw new Error('Missing artifact digest');
    }
    const zip = await port.downloadArtifact(artifactId);
    if (zip.length !== size || `sha256:${createHash('sha256').update(zip).digest('hex')}` !== digest) {
        throw new Error('Artifact size or digest disagrees');
    }
    const files = readHostedArtifactZip(zip, 1);
    if (files.size !== 1 || !files.has('evidence.json')) {
        throw new Error('Unexpected evidence ZIP members');
    }
    const bytes = files.get('evidence.json')!;
    if (bytes.length > 4096) {
        throw new Error('Evidence JSON exceeds bound');
    }
    const evidence = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), 'evidence');
    assertEvidenceIdentity(evidence, runId, headSha);
    return true;
}

async function observedResult(
    port: EvidencePort,
    run: RecordValue,
    runId: number,
    headSha: string
): Promise<{ failedLegs: string[]; analysisId: number }> {
    const jobs = await port.listJobs(runId, 1);
    const codeql = jobs.map((job) => record(job, 'job')).filter((job) => job.name === 'CodeQL');
    const codeqlJob = codeql.at(0);
    if (codeql.length !== 1 || codeqlJob === undefined || codeqlJob.conclusion !== 'success') {
        throw new Error('Missing successful CodeQL job for this run and attempt');
    }
    const checkedJobs = jobs.map((job) => record(job, 'job'));
    const failedJobs = checkedJobs.filter((job) => job.conclusion === 'failure');
    const failedLegs = failedJobs.map((job) => job.name);
    if (failedLegs.some((name) => typeof name !== 'string' || !SAFE_LEG.test(name))) {
        throw new Error('Unsafe failed job name');
    }
    const analyses = (await port.listAnalyses('refs/heads/main'))
        .map((analysis) => record(analysis, 'CodeQL analysis'))
        .filter(
            (analysis) =>
                analysis.analysis_key === ANALYSIS_KEY &&
                analysis.commit_sha === headSha &&
                analysis.ref === 'refs/heads/main' &&
                record(analysis.tool, 'analysis tool').name === 'CodeQL' &&
                typeof analysis.created_at === 'string' &&
                typeof run.run_started_at === 'string' &&
                typeof run.updated_at === 'string' &&
                typeof codeqlJob.started_at === 'string' &&
                typeof codeqlJob.completed_at === 'string' &&
                analysis.created_at >= run.run_started_at &&
                analysis.created_at <= run.updated_at &&
                analysis.created_at >= codeqlJob.started_at &&
                analysis.created_at <= codeqlJob.completed_at
        );
    const analysis = analyses.at(0);
    if (analyses.length !== 1 || analysis === undefined) {
        throw new Error('Missing or ambiguous run-bound CodeQL analysis');
    }
    const analysisId = integer(analysis.id, 'CodeQL analysis ID');
    return { failedLegs: failedLegs as string[], analysisId };
}

export async function validateNightlyEvidence(eventValue: unknown, port: EvidencePort): Promise<ReportDecision> {
    const selected = await loadScheduledRun(eventValue, port);
    if ('kind' in selected) {
        return selected;
    }
    const { run, runId, headSha } = selected;
    if (!(await hasValidEvidence(port, runId, headSha))) {
        return { kind: 'unsupported', reason: 'legacy-producer' };
    }
    const result = await observedResult(port, run, runId, headSha);
    return { kind: 'validated', runId, attempt: 1, ...result };
}

type GhRead = (
    args: readonly string[],
    options: { env: NodeJS.ProcessEnv; maxBuffer: number; timeout: number }
) => Buffer;

const execGh: GhRead = (args, options) => execFileSync('gh', [...args], options);

function ghOutput(token: string, route: string, runGh: GhRead, paged: boolean, maxBuffer: number): Buffer {
    const env = { ...process.env, GH_TOKEN: token, GH_HOST: 'github.com' };
    delete env.GITHUB_TOKEN;
    delete env.GITHUB_ENTERPRISE_TOKEN;
    delete env.GH_ENTERPRISE_TOKEN;
    delete env.GH_DEBUG;
    delete env.GH_CONFIG_DIR;
    const args = ['api', '--hostname', 'github.com', '--method', 'GET'];
    if (paged) {
        args.push('--paginate', '--slurp');
    }
    args.push(route);
    try {
        return runGh(args, { env, maxBuffer, timeout: 120_000 });
    } catch {
        // Child stderr can contain request details. Refuse without relaying it.
        throw new Error('GitHub CLI read failed');
    }
}

function ghJson(token: string, route: string, runGh: GhRead): unknown {
    const output = ghOutput(token, route, runGh, false, 5 * 1024 * 1024);
    return JSON.parse(output.toString('utf8'));
}

function ghPages(token: string, route: string, runGh: GhRead, key?: string): unknown[] {
    const output = ghOutput(token, route, runGh, true, 10 * 1024 * 1024);
    const pages: unknown = JSON.parse(output.toString('utf8'));
    if (!Array.isArray(pages) || pages.length === 0) {
        throw new TypeError('Invalid paginated GitHub response');
    }
    const values: unknown[] = [];
    let totalCount: number | undefined;
    for (const page of pages as unknown[]) {
        const response = key ? record(page, 'paged response') : undefined;
        const list: unknown = key ? response?.[key] : page;
        if (!Array.isArray(list)) {
            throw new TypeError('Invalid paginated GitHub response');
        }
        if (response) {
            const count = response.total_count;
            if (
                !Number.isSafeInteger(count) ||
                Number(count) < 0 ||
                (totalCount !== undefined && count !== totalCount)
            ) {
                throw new Error('Inconsistent GitHub pagination count');
            }
            totalCount = Number(count);
        }
        values.push(...(list as unknown[]));
    }
    if (totalCount !== undefined && values.length !== totalCount) {
        throw new Error('Incomplete GitHub pagination');
    }
    return values;
}

function ghArtifact(token: string, id: number, runGh: GhRead): Buffer {
    const route = `repos/${REPOSITORY}/actions/artifacts/${integer(id, 'artifact ID')}/zip`;
    const output = ghOutput(token, route, runGh, false, hostedWasmOutputLimit + 1);
    if (output.length > hostedWasmOutputLimit) {
        throw new Error('Artifact download exceeds bound');
    }
    return output;
}

export function githubEvidencePort(token: string, runGh: GhRead = execGh): EvidencePort {
    const prefix = `repos/${REPOSITORY}`;
    return {
        getRun: async (id) => ghJson(token, `${prefix}/actions/runs/${integer(id, 'run ID')}`, runGh),
        compareMain: async (headSha) => ghJson(token, `${prefix}/compare/${sha(headSha, 'head SHA')}...main`, runGh),
        listArtifacts: async (id) =>
            ghPages(
                token,
                `${prefix}/actions/runs/${integer(id, 'run ID')}/artifacts?per_page=100`,
                runGh,
                'artifacts'
            ),
        downloadArtifact: async (id) => ghArtifact(token, id, runGh),
        listJobs: async (id, attempt) =>
            ghPages(
                token,
                `${prefix}/actions/runs/${integer(id, 'run ID')}/attempts/${integer(attempt, 'attempt')}/jobs?per_page=100`,
                runGh,
                'jobs'
            ),
        listAnalyses: async (ref) => {
            if (ref !== 'refs/heads/main') {
                throw new Error('Unsupported analysis ref');
            }
            return ghPages(token, `${prefix}/code-scanning/analyses?ref=refs%2Fheads%2Fmain&per_page=100`, runGh);
        },
    };
}

if (process.argv[1]?.endsWith('/codeqlNightlyEvidence.ts')) {
    const token = process.env.GH_TOKEN;
    const eventPath = process.env.GITHUB_EVENT_PATH;
    const outputPath = process.env.GITHUB_OUTPUT;
    if (!token || !eventPath || !outputPath) {
        throw new Error('Missing reporter environment');
    }
    const event: unknown = JSON.parse(readFileSync(eventPath, 'utf8'));
    const decision = await validateNightlyEvidence(event, githubEvidencePort(token));
    if (decision.kind === 'validated') {
        appendFileSync(
            outputPath,
            `supported=true\nrun_id=${decision.runId}\nfailed_legs=${decision.failedLegs.join(', ')}\n`
        );
        console.log(`Validated scheduled run ${decision.runId}, attempt 1, CodeQL analysis ${decision.analysisId}`);
    } else {
        appendFileSync(outputPath, 'supported=false\n');
        console.log(`Nightly evidence unsupported: ${decision.reason}`);
    }
}
