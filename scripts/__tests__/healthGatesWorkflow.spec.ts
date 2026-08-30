import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDocument } from 'yaml';

import {
    getBrowserAiWebGpuHardwareRequirement,
    probeBrowserWebGpuHardwareInPage,
    requireBrowserWebGpuHardware,
} from '../../tests/e2e/browserAiHardware';
import browserAiWebGpuAdmissionConfig from '../../tests/e2e/browserAiWebGpuAdmission.playwright.config';

type UnknownRecord = Record<string, unknown>;
type JobResult = 'cancelled' | 'failure' | 'skipped' | 'success';

const REVIEW_CONDITION = "github.event_name != 'pull_request_review' || github.event.review.state == 'approved'";
const HEAVY_OUTPUT_REFERENCE = '${{ steps.scope.outputs.heavy }}';
const HEAVY_CONDITION = "needs.validation.outputs.heavy == 'true'";
const FORCED_SCOPE_OUTPUTS = {
    heavy: 'true',
    rust: 'true',
    server: 'true',
    e2e: 'true',
    web: 'true',
    code: 'true',
};
const SCOPE_OUTPUT_REFERENCES = {
    heavy: '${{ steps.scope.outputs.heavy }}',
    rust: '${{ steps.scope.outputs.rust }}',
    server: '${{ steps.scope.outputs.server }}',
    e2e: '${{ steps.scope.outputs.e2e }}',
    web: '${{ steps.scope.outputs.web }}',
    code: '${{ steps.scope.outputs.code }}',
};
const CODE_CONDITION = "needs.decide.outputs.code == 'true'";
// An approving review validates the same pull-request head under a different
// event, but it must wait behind any in-flight push run instead of cancelling
// it. Every Gate member reading a pull request keys off the payload instead.
const PULL_REQUEST_PAYLOAD_CONDITION = 'github.event.pull_request != null';
const SMOKE_CONDITION = `${PULL_REQUEST_PAYLOAD_CONDITION} && needs.decide.outputs.e2e == 'true'`;
const EVENT_GATED_SMOKE_CONDITION = "github.event_name == 'pull_request' && needs.decide.outputs.e2e == 'true'";
const SMOKE_COMMAND = 'pnpm test:e2e tests/e2e/smoke.spec.ts --retries=0';
const PULL_REQUEST_CONCURRENCY_GROUP = 'health-gates-${{ github.event.pull_request.number }}';
const PULL_REQUEST_CONCURRENCY_CANCELLATION = true;
// `Gate` is a required status check, GitHub counts a `skipped` conclusion as
// satisfying one, and it prefers the newest run of that name. So this condition
// must be the one predicate that cannot be false on this workflow's only event:
// anything richer lets `gate` skip and mint a passing required check over a red
// head, which is what a `pull_request_review` trigger did in production.
const GATE_CONDITION = '${{ !cancelled() }}';
const HEAVY_GATE_CONDITION =
    "${{ !cancelled() && (github.event_name != 'pull_request_review' || github.event.review.state == 'approved') }}";
const HEALTH_GATES_TRIGGERS = ['pull_request'] as const;
const HEAVY_GATES_TRIGGERS = ['pull_request_review', 'schedule', 'workflow_dispatch'] as const;
const VALIDATION_TRIGGERS = ['workflow_call'] as const;
const VALIDATION_CALL = './.github/workflows/validation.yml';
const REQUIRED_CHECK_NAME = 'Gate';
const HEAVY_SUMMARY_NAME = 'HeavyGate';
const NIGHTLY_CRON = '0 3 * * *';
const DEPENDENCY_REVIEW_ACTION = 'actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294';
const TRUSTED_SCANNER_REF = '${{ github.event.pull_request.base.sha || github.sha }}';
const SCAN_TARGET_REF = '${{ github.event.pull_request.head.sha || github.sha }}';
const TOKEN_REFERENCE = /GITHUB_TOKEN|GH_TOKEN|github\.token|\$\{\{\s*secrets\./i;
const BROWSER_AI_WEBGPU_JOB = 'browser-ai-webgpu';
const BROWSER_AI_WEBGPU_JOB_NAME = 'Browser AI WebGPU admission';
const BROWSER_AI_WEBGPU_CONDITION =
    "needs.validation.outputs.heavy == 'true' && needs.validation.outputs.e2e == 'true'";
const BROWSER_AI_WEBGPU_RUNNER = 'macos-14';
const BROWSER_AI_WEBGPU_SCRIPT_NAME = 'test:e2e:browser-ai-webgpu-admission';
const BROWSER_AI_WEBGPU_COMMAND = 'pnpm test:e2e:browser-ai-webgpu-admission';
const BROWSER_AI_WEBGPU_PACKAGE_SCRIPT =
    'playwright test --config tests/e2e/browserAiWebGpuAdmission.playwright.config.ts';
// Exact, ordered, and length-checked. This leg is the only runner that reaches
// the admitted side of AI availability — the general matrix has no adapter — so
// a spec missing from this list has no runner that executes its admitted
// assertions, and a dropped entry retires that proof without failing anything.
const BROWSER_AI_WEBGPU_TEST_MATCH = ['browserAiWebGpuAdmission.spec.ts', 'browserAiAdmittedPresentation.spec.ts'];
const BROWSER_AI_WEBGPU_ORIGIN = 'http://localhost:5188';
const BROWSER_AI_WEBGPU_SERVER_COMMAND = 'pnpm dev --host 127.0.0.1 --port 5188 --strictPort';
// The required Gate depends on the shared validation call and nothing else. A
// `uses:` job reports failure when any job inside it failed, so this is not a
// weaker summary than the old flat list — and `VALIDATION_JOBS` below is what
// keeps a leg from silently leaving the lane.
const GATE_MEMBERS = ['validation'] as const;
// Exact and ordered. `Gate` is a required status check, so a leg dropped from
// this lane stops deciding merges while every check still reads green.
const VALIDATION_JOBS = [
    'decide',
    'static',
    'lint',
    'boundaries',
    'unit',
    'smoke',
    'build',
    'rust',
    'native-macos',
    'native-windows',
    'dependency-review',
    'pr-secrets',
] as const;
const HEAVY_GATE_MEMBERS = ['validation', 'e2e', 'browser-ai-webgpu', 'codeql', 'secrets'] as const;
// Nothing here ever runs on a pull-request push, so naming any of it in `Gate`
// would list jobs that are always `skipped` — a claim of coverage the required
// check does not have. `e2e-report` is doubly excluded: it merges blob
// artifacts and observes nothing about the product at all.
const HEAVY_ONLY_JOBS = ['e2e', 'e2e-report', 'browser-ai-webgpu', 'codeql', 'secrets', 'deploy-web'] as const;
const DEPLOY_WEB_JOB = 'deploy-web';
const DEPLOY_WEB_JOB_NAME = 'Daily web deploy';
// A dispatch runs on whichever ref the person firing it chose, so the branch
// constraint has to live here for every honest path. A dispatched *copy* of
// this workflow carries its own condition; the environment's branch policy is
// what binds that one, and no test in this repository can observe it.
const DEPLOY_WEB_CONDITION =
    "github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main')";
const DEPLOY_WEB_CONCURRENCY_GROUP = 'deploy-web-production';
const DEPLOY_WEB_GUARD_STEP = 'Require a validated revision of main';
const DEPLOY_WEB_FRESHNESS_STEP = 'Refuse a stale candidate revision';
const DEPLOY_WEB_CREDENTIAL_REPORT_STEP = 'Report the missing deployment credential';
// Arming the leg takes all four, and the fourth is the one a reader forgets.
const DEPLOY_ARMING_PRECONDITIONS = [
    'VERCEL_TOKEN',
    'VERCEL_ORG_ID',
    'VERCEL_PROJECT_ID',
    'deployment branch policy limited to `main`',
] as const;
const DEPLOYMENT_URL_REFERENCE = '${{ steps.deployment.outputs.url }}';
const VERCEL_TOKEN_REFERENCE = '${{ secrets.VERCEL_TOKEN }}';
const VERCEL_CLI_STEPS = [
    'Pull the production environment',
    'Build the validated revision',
    'Deploy the prebuilt revision',
] as const;
// Every leg a scheduled run performs. The train promotes a revision only once
// each of them has reported success on that same revision.
// The fast legs arrive through the validation call rather than one by one; a
// `uses:` job reports failure when any job inside it failed, so the train still
// promotes only a revision every leg reported success on.
const DEPLOY_WEB_NEEDS = ['validation', 'e2e', 'browser-ai-webgpu', 'codeql', 'secrets'] as const;
const NIGHTLY_REPORT_NEEDS = ['validation', 'e2e', 'browser-ai-webgpu', 'codeql', 'secrets', 'deploy-web'] as const;
const DEPLOY_CREDENTIAL_REFERENCE = "${{ secrets.VERCEL_TOKEN != '' }}";
const DEPLOY_CREDENTIAL_CONDITION = "env.DEPLOY_CREDENTIAL_PRESENT == 'true'";
const DEPLOY_FRESH_REVISION_CONDITION = `${DEPLOY_CREDENTIAL_CONDITION} && steps.freshness.outputs.fresh == 'true'`;
const DEPLOY_CHANGED_REVISION_CONDITION = `${DEPLOY_FRESH_REVISION_CONDITION} && steps.production.outputs.deploy == 'true'`;
// Only the freshness check itself runs on credential presence alone; it decides
// for everything after it, and its output is empty when it never ran.
const DEPLOY_CREDENTIAL_GATED_STEPS = [DEPLOY_WEB_FRESHNESS_STEP] as const;
const DEPLOY_FRESH_GATED_STEPS = [
    'Checkout the validated revision',
    'Enable Corepack',
    'Set up Node',
    'Resolve the current production revision',
] as const;
const DEPLOY_REVISION_GATED_STEPS = [
    'Install dependencies',
    'Pull the production environment',
    'Build the validated revision',
    'Deploy the prebuilt revision',
    'Assert cross-origin isolation on the deployment',
] as const;
const DEPLOY_ENVIRONMENT = 'Production';
const VERCEL_CLI_PIN = /^vercel@\d+\.\d+\.\d+$/u;
// A daily web deployment carries no release identity: nothing here may write a
// version, a tag, a GitHub Release or a changelog entry.
const RELEASE_SIDE_EFFECTS = [
    /git tag/u,
    /gh release/u,
    /CHANGELOG/u,
    /npm version/u,
    /pnpm version/u,
    /release:propose/u,
    /release:cut/u,
] as const;
// The two suites are Gate members, so their scope conditions decide when the
// required check may legitimately conclude on a skip. `unit` runs on every push
// touching the web scope; `e2e` is heavy-lane only, so a push run skips it and
// an approving review, the nightly, or a dispatch is where it decides the Gate.
// Widening either condition would silently retire a proof from the merge path.
const SUITE_JOB_WIRING = {
    unit: { workflow: 'validation', needs: 'decide', if: "needs.decide.outputs.web == 'true'" },
    e2e: {
        workflow: 'heavy',
        needs: 'validation',
        if: "needs.validation.outputs.heavy == 'true' && needs.validation.outputs.e2e == 'true'",
    },
} satisfies Record<string, Readonly<{ workflow: 'validation' | 'heavy'; needs: string; if: string }>>;
// A softened shard step reports a failing suite as a passing required check.
const SUITE_SHARD_STEP = 'Run shard';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const parsedPackageManifest: unknown = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));
const packageManifest = asRecord(parsedPackageManifest, 'package manifest');
const browserAiWebGpuConfig = asRecord(browserAiWebGpuAdmissionConfig, 'Browser AI WebGPU config');
function loadWorkflow(fileName: string): { document: ReturnType<typeof parseDocument>; parsed: UnknownRecord } {
    const document = parseDocument(readFileSync(join(repositoryRoot, '.github/workflows', fileName), 'utf8'));
    if (document.errors.length > 0) {
        throw new Error(`${fileName} is invalid YAML: ${document.errors.map((error) => error.message).join('; ')}`);
    }
    return { document, parsed: asRecord(document.toJS(), fileName) };
}

const { document: workflowDocument, parsed: workflow } = loadWorkflow('health-gates.yml');
const { parsed: validationWorkflow } = loadWorkflow('validation.yml');
const { parsed: heavyWorkflow } = loadWorkflow('heavy-gates.yml');
const parsedVercelConfig: unknown = JSON.parse(readFileSync(join(repositoryRoot, 'vercel.json'), 'utf8'));
const vercelConfig = asRecord(parsedVercelConfig, 'Vercel configuration');

function asRecord(value: unknown, label: string): UnknownRecord {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label} must be a mapping`);
    }
    return value as UnknownRecord;
}

function recordAt(record: UnknownRecord, key: string): UnknownRecord {
    return asRecord(record[key], key);
}

function arrayAt(record: UnknownRecord, key: string): unknown[] {
    const value = record[key];
    if (!Array.isArray(value)) {
        throw new TypeError(`${key} must be an array`);
    }
    return value;
}

function stringAt(record: UnknownRecord, key: string): string {
    const value = record[key];
    if (typeof value !== 'string') {
        throw new TypeError(`${key} must be a string`);
    }
    return value;
}

function jobAt(candidate: UnknownRecord, name: string): UnknownRecord {
    return recordAt(recordAt(candidate, 'jobs'), name);
}

function stepNamed(owner: UnknownRecord, name: string): UnknownRecord {
    const step = arrayAt(owner, 'steps').find((candidate: unknown) => asRecord(candidate, 'step').name === name);
    if (step === undefined) {
        throw new Error(`missing workflow step: ${name}`);
    }
    return asRecord(step, name);
}

function assertConcurrencyContract(candidate: UnknownRecord): void {
    const concurrency = recordAt(candidate, 'concurrency');
    if (concurrency.group !== PULL_REQUEST_CONCURRENCY_GROUP) {
        throw new Error('workflow must group runs by pull request or ref');
    }
    if (concurrency['cancel-in-progress'] !== PULL_REQUEST_CONCURRENCY_CANCELLATION) {
        throw new Error('only a newer pull-request run may cancel in-progress work');
    }
}

function assertWorkflowPermissions(candidate: UnknownRecord): void {
    const permissions = recordAt(candidate, 'permissions');
    if (permissions.contents !== 'read' || permissions['pull-requests'] !== 'read') {
        throw new Error('workflow must grant only read access to contents and pull requests');
    }
    if (Object.keys(permissions).length !== 2) {
        throw new Error('workflow permissions must not exceed path-filter requirements');
    }
}

function runScopeScript(
    script: string,
    eventName: string,
    filters: Readonly<Record<string, string>> = {}
): UnknownRecord {
    const directory = mkdtempSync(join(tmpdir(), 'sourdaw-health-scope-'));
    const outputPath = join(directory, 'github-output');
    try {
        const result = spawnSync('bash', ['-c', script], {
            encoding: 'utf8',
            env: {
                ...process.env,
                EVENT: eventName,
                RUST: 'false',
                SERVER: 'false',
                E2E: 'false',
                WEB: 'false',
                UNCLASSIFIED: 'false',
                ...filters,
                GITHUB_OUTPUT: outputPath,
            },
            shell: false,
        });
        if (result.status !== 0) {
            throw new Error(`Resolve scope failed for ${eventName}: ${result.stderr}`);
        }
        return Object.fromEntries(
            readFileSync(outputPath, 'utf8')
                .trim()
                .split('\n')
                .map((line) => {
                    const separator = line.indexOf('=');
                    return [line.slice(0, separator), line.slice(separator + 1)];
                })
        );
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

function assertScopeContract(candidate: UnknownRecord): string {
    const decide = jobAt(candidate, 'decide');
    if (decide.if !== REVIEW_CONDITION) {
        throw new Error('decide must only admit submitted approved reviews');
    }
    const outputs = recordAt(decide, 'outputs');
    for (const [name, reference] of Object.entries(SCOPE_OUTPUT_REFERENCES)) {
        if (outputs[name] !== reference) {
            throw new Error(`decide ${name} output must expose steps.scope.outputs.${name}`);
        }
    }
    const scope = stepNamed(decide, 'Resolve scope');
    if (scope.id !== 'scope') {
        throw new Error('Resolve scope must retain the scope step id');
    }
    return stringAt(scope, 'run');
}

function unclassifiedPatterns(candidate: UnknownRecord): string[] {
    const filterStep = stepNamed(jobAt(candidate, 'decide'), 'Filter changed paths');
    const options = recordAt(filterStep, 'with');
    if (options['predicate-quantifier'] !== 'some-with-excludes') {
        throw new Error('path filters must subtract negated patterns instead of matching on any one of them');
    }
    const filters = asRecord(parseDocument(stringAt(options, 'filters')).toJS(), 'path filters');
    return arrayAt(filters, 'unclassified').map(String);
}

function assertUnclassifiedFallback(candidate: UnknownRecord): void {
    const patterns = unclassifiedPatterns(candidate);
    if (!patterns.includes('**')) {
        throw new Error('the unclassified filter must start from every changed path');
    }
    const exempt = patterns.filter((pattern) => pattern.startsWith('!'));
    const prose = exempt.filter((pattern) => pattern === '!docs/**' || pattern === '!*.md');
    if (prose.length !== 2) {
        throw new Error('documentation must be exempt from the unclassified fallback');
    }
    const metadata = exempt.find((pattern) => pattern.includes('.github'));
    if (metadata !== undefined) {
        throw new Error(`repository metadata is machine-read and must not be exempt: ${metadata}`);
    }
}

function assertProseSkippingJobs(candidate: UnknownRecord): void {
    for (const jobName of ['lint', 'boundaries']) {
        if (jobAt(candidate, jobName).if !== CODE_CONDITION) {
            throw new Error(`${jobName} must skip a head that carries only prose`);
        }
    }
    if (jobAt(candidate, 'static').if !== undefined) {
        throw new Error('release inventory answers to prose changes, so static must stay unconditional');
    }
}

function assertOfflineSmokeJob(candidate: UnknownRecord): void {
    const smoke = jobAt(candidate, 'smoke');
    if (smoke.needs !== 'decide' || smoke.if !== SMOKE_CONDITION) {
        throw new Error('the offline smoke job must run on every pull-request run that touches the browser surface');
    }
    if (stringAt(stepNamed(smoke, 'Run offline smoke set'), 'run') !== SMOKE_COMMAND) {
        throw new Error('the offline smoke job must run the smoke spec without retries');
    }
}

function assertPullRequestSecretScan(candidate: UnknownRecord): void {
    const prSecrets = jobAt(candidate, 'pr-secrets');
    if (prSecrets.needs !== 'decide' || prSecrets.if !== PULL_REQUEST_PAYLOAD_CONDITION) {
        throw new Error('the pull-request secret scan must run on every run carrying a pull request');
    }
    if (TOKEN_REFERENCE.test(JSON.stringify(prSecrets))) {
        throw new Error('pull-request secret scan must not reference GitHub tokens or repository secrets');
    }
    const trustedScanner = recordAt(stepNamed(prSecrets, 'Checkout trusted scanner'), 'with');
    if (
        trustedScanner.ref !== '${{ github.event.pull_request.base.sha }}' ||
        trustedScanner.path !== 'trusted-scanner' ||
        trustedScanner['persist-credentials'] !== false
    ) {
        throw new Error('pull-request scanner config must come from the trusted base and retain no credentials');
    }
    // This job always carries a pull request, so its scan target pins the head
    // SHA outright rather than the history job's event-SHA fallback.
    const scanTarget = recordAt(stepNamed(prSecrets, 'Checkout scan target'), 'with');
    if (
        scanTarget.ref !== '${{ github.event.pull_request.head.sha }}' ||
        scanTarget.path !== 'scan-target' ||
        scanTarget['fetch-depth'] !== 0 ||
        scanTarget['persist-credentials'] !== false
    ) {
        throw new Error('pull-request scan target must retain the complete untrusted history without credentials');
    }
    const scan = stringAt(stepNamed(prSecrets, 'Scan pull request diff for secrets'), 'run');
    if (!scan.includes('--log-opts="$BASE_SHA..$HEAD_SHA -m"')) {
        throw new Error('pull-request secret scan must scan the commits this head adds to its base');
    }
    if (!scan.includes('--ignore-gitleaks-allow')) {
        throw new Error('pull-request secret scan must reject head-authored gitleaks:allow annotations');
    }
    // The control proves detection survives head-authored suppression, so it
    // has to refuse those annotations on its own invocation too.
    if (
        !stringAt(stepNamed(prSecrets, 'Validate PR merge diff secret scanner'), 'run').includes(
            '--ignore-gitleaks-allow'
        )
    ) {
        throw new Error('merge-diff positive control must reject head-authored gitleaks:allow annotations');
    }
}

type WorkflowSet = { health: UnknownRecord; validation: UnknownRecord; heavy: UnknownRecord };

function workflowSet(): WorkflowSet {
    return { health: workflow, validation: validationWorkflow, heavy: heavyWorkflow };
}

function cloneWorkflows(label: string): WorkflowSet {
    const clone = structuredClone(workflowSet());
    return {
        health: asRecord(clone.health, `${label} health`),
        validation: asRecord(clone.validation, `${label} validation`),
        heavy: asRecord(clone.heavy, `${label} heavy`),
    };
}

// Both suites owe two things: the scope condition that says when a skip is
// legitimate, and a shard step that fails its job. `unit` decides the required
// Gate through the validation lane it lives in; `e2e` decides HeavyGate. A
// softened shard step in either reports a failing suite as a passing summary.
function assertBlockingSuites(set: WorkflowSet): void {
    for (const [job, expectedWiring] of Object.entries(SUITE_JOB_WIRING)) {
        const suite = jobAt(set[expectedWiring.workflow], job);
        if (suite.needs !== expectedWiring.needs || suite.if !== expectedWiring.if) {
            throw new Error(`${job} must retain its current dependency and scope condition`);
        }
        if (stepNamed(suite, SUITE_SHARD_STEP)['continue-on-error'] !== undefined) {
            throw new Error(`${job} shards must fail their job rather than report a warning`);
        }
        if (suite['continue-on-error'] !== undefined) {
            throw new Error(`${job} must not use job-level continue-on-error`);
        }
    }
}

// The single invariant the whole split exists to hold: `Gate` is the required
// context, GitHub counts a `skipped` conclusion as satisfying a required check,
// and it prefers the newest run of that name. So only a `pull_request` run of
// `health-gates.yml` may mint that name, and `gate` must be unable to skip.
function assertRequiredCheckIsolation(set: WorkflowSet): void {
    if (JSON.stringify(Object.keys(recordAt(set.health, 'on'))) !== JSON.stringify([...HEALTH_GATES_TRIGGERS])) {
        throw new Error(
            'health-gates.yml must answer to pull_request alone, or a skipped Gate can satisfy the required check'
        );
    }
    if (jobAt(set.health, 'gate').if !== GATE_CONDITION) {
        throw new Error('Gate must carry no predicate that could skip it');
    }
    for (const [file, candidate] of [
        ['validation.yml', set.validation],
        ['heavy-gates.yml', set.heavy],
    ] as const) {
        for (const [id, job] of Object.entries(recordAt(candidate, 'jobs'))) {
            if (asRecord(job, `${file} ${id}`).name === REQUIRED_CHECK_NAME) {
                throw new Error(`${file} must not name a job ${REQUIRED_CHECK_NAME}`);
            }
        }
    }
    if (JSON.stringify(Object.keys(recordAt(set.heavy, 'on')).sort()) !== JSON.stringify([...HEAVY_GATES_TRIGGERS])) {
        throw new Error('the heavy workflow must own exactly the review, schedule, and dispatch events');
    }
    if (JSON.stringify(Object.keys(recordAt(set.validation, 'on'))) !== JSON.stringify([...VALIDATION_TRIGGERS])) {
        throw new Error('validation.yml must be reusable-only');
    }
    const schedule = arrayAt(recordAt(set.heavy, 'on'), 'schedule');
    if (asRecord(schedule[0], 'heavy cron').cron !== NIGHTLY_CRON) {
        throw new Error('the nightly cron must survive the move to the heavy workflow');
    }
}

function assertJobGraph(set: WorkflowSet): void {
    const dependencyReview = jobAt(set.validation, 'dependency-review');
    if (dependencyReview.needs !== 'decide' || dependencyReview.if !== PULL_REQUEST_PAYLOAD_CONDITION) {
        throw new Error('dependency review must gate on the pull request payload rather than the triggering event');
    }
    if (stepNamed(dependencyReview, 'Review dependency changes').uses !== DEPENDENCY_REVIEW_ACTION) {
        throw new Error('dependency review action must remain pinned');
    }
    if (jobAt(set.heavy, 'codeql').if !== HEAVY_CONDITION || jobAt(set.heavy, 'secrets').if !== HEAVY_CONDITION) {
        throw new Error('security scans must consume the heavy scope output');
    }
    if (jobAt(set.heavy, 'codeql').needs !== 'validation' || jobAt(set.heavy, 'secrets').needs !== 'validation') {
        throw new Error('security scans must depend on the validation call that publishes the scope');
    }
    for (const [file, candidate] of [
        ['health-gates.yml', set.health],
        ['heavy-gates.yml', set.heavy],
    ] as const) {
        if (jobAt(candidate, 'validation').uses !== VALIDATION_CALL) {
            throw new Error(`${file} must call the shared validation lane rather than redefine it`);
        }
    }
    if (JSON.stringify(Object.keys(recordAt(set.validation, 'jobs'))) !== JSON.stringify([...VALIDATION_JOBS])) {
        throw new Error('validation.yml must hold exactly the pinned job list, in order');
    }
    assertBlockingSuites(set);
    assertNightlyReportCoverage(set);
    assertSummaryMembership(set);
}

// The nightly reporter is the only thing that observes what path filters and
// the approval gate skip, so a leg missing from its needs is a class of failure
// that reports nowhere a person looks.
function assertNightlyReportCoverage(set: WorkflowSet): void {
    const nightly = jobAt(set.heavy, 'nightly-report');
    if (JSON.stringify(arrayAt(nightly, 'needs')) !== JSON.stringify([...NIGHTLY_REPORT_NEEDS])) {
        throw new Error('the nightly reporter must depend on every leg a scheduled run performs');
    }
    if (nightly.if !== "${{ failure() && github.event_name == 'schedule' }}") {
        throw new Error('the nightly reporter must file only for a failed scheduled run');
    }
}

function assertSummaryMembership(set: WorkflowSet): void {
    const gateNeeds = arrayAt(jobAt(set.health, 'gate'), 'needs');
    for (const job of GATE_MEMBERS) {
        if (!gateNeeds.includes(job)) {
            throw new Error(`gate must depend on ${job}`);
        }
    }
    for (const job of HEAVY_ONLY_JOBS) {
        if (gateNeeds.includes(job)) {
            throw new Error(`${job} never runs on a pull-request push and must stay outside the required Gate`);
        }
    }
    if (gateNeeds.length !== GATE_MEMBERS.length) {
        throw new Error('gate must depend on exactly the pinned member list');
    }
    const heavyGate = jobAt(set.heavy, 'heavy-gate');
    if (heavyGate.name !== HEAVY_SUMMARY_NAME || heavyGate.if !== HEAVY_GATE_CONDITION) {
        throw new Error('the heavy summary must keep its own name and its non-approved-review predicate');
    }
    if (JSON.stringify(arrayAt(heavyGate, 'needs')) !== JSON.stringify([...HEAVY_GATE_MEMBERS])) {
        throw new Error('HeavyGate must depend on exactly the pinned member list');
    }
}

function assertUnitProvenanceHistory(candidate: UnknownRecord): void {
    const unitCheckout = stepNamed(jobAt(candidate, 'unit'), 'Checkout');
    if (recordAt(unitCheckout, 'with')['fetch-depth'] !== 0) {
        throw new Error('unit must retain complete history for immutable measurement provenance');
    }
    for (const jobName of ['lint', 'boundaries']) {
        const checkout = stepNamed(jobAt(candidate, jobName), 'Checkout');
        const checkoutOptions = checkout.with;
        if (
            checkoutOptions !== undefined &&
            asRecord(checkoutOptions, `${jobName} checkout options`)['fetch-depth'] === 0
        ) {
            throw new Error(`${jobName} must not fetch complete history`);
        }
    }
}

function assertBrowserAiWebGpuJob(candidate: UnknownRecord): void {
    const job = jobAt(candidate, BROWSER_AI_WEBGPU_JOB);
    if (job.name !== BROWSER_AI_WEBGPU_JOB_NAME) {
        throw new Error('Browser AI WebGPU job must retain its stable name');
    }
    if (job.needs !== 'validation' || job.if !== BROWSER_AI_WEBGPU_CONDITION) {
        throw new Error('Browser AI WebGPU job must retain its heavy E2E scope condition');
    }
    if (job['runs-on'] !== BROWSER_AI_WEBGPU_RUNNER) {
        throw new Error('Browser AI WebGPU job must use the standard macos-14 runner');
    }
    if (stringAt(stepNamed(job, 'Install Chromium'), 'run') !== 'pnpm exec playwright install chromium') {
        throw new Error('Browser AI WebGPU job must install Chromium directly');
    }
    if (stringAt(stepNamed(job, 'Run Browser AI WebGPU admission'), 'run') !== BROWSER_AI_WEBGPU_COMMAND) {
        throw new Error('Browser AI WebGPU job must run the dedicated hardware command');
    }
    // It decides `HeavyGate` rather than the required `Gate`: no pull-request
    // run executes it, so naming it in `Gate` would list an always-skipped job.
    if (!arrayAt(jobAt(candidate, 'heavy-gate'), 'needs').includes(BROWSER_AI_WEBGPU_JOB)) {
        throw new Error('the heavy summary must depend on the Browser AI WebGPU job');
    }
}

function assertBrowserAiWebGpuProofChain(manifest: UnknownRecord, config: UnknownRecord): void {
    const scripts = recordAt(manifest, 'scripts');
    if (scripts[BROWSER_AI_WEBGPU_SCRIPT_NAME] !== BROWSER_AI_WEBGPU_PACKAGE_SCRIPT) {
        throw new Error('Browser AI WebGPU package script must run the dedicated Playwright config');
    }
    // A bare string is the single-spec form this pin replaced; normalising it
    // here keeps that regression reported by name rather than as a type error.
    const testMatch = Array.isArray(config.testMatch) ? config.testMatch : [config.testMatch];
    if (
        testMatch.length !== BROWSER_AI_WEBGPU_TEST_MATCH.length ||
        BROWSER_AI_WEBGPU_TEST_MATCH.some((spec, index) => testMatch[index] !== spec)
    ) {
        throw new Error(
            `Browser AI WebGPU config must match exactly these hardware-required specs, in order: ${BROWSER_AI_WEBGPU_TEST_MATCH.join(', ')}`
        );
    }
    const projects = arrayAt(config, 'projects');
    if (projects.length !== 1) {
        throw new Error('Browser AI WebGPU config must contain one dedicated project');
    }
    const project = asRecord(projects[0], 'Browser AI WebGPU project');
    if (getBrowserAiWebGpuHardwareRequirement(recordAt(project, 'metadata')) !== 'required') {
        throw new Error('Browser AI WebGPU project must require hardware');
    }
    const server = recordAt(config, 'webServer');
    if (
        server.command !== BROWSER_AI_WEBGPU_SERVER_COMMAND ||
        server.url !== BROWSER_AI_WEBGPU_ORIGIN ||
        server.reuseExistingServer !== false ||
        recordAt(config, 'use').baseURL !== BROWSER_AI_WEBGPU_ORIGIN
    ) {
        throw new Error('Browser AI WebGPU config must own a non-reused isolated server');
    }
}

function needsResults(
    candidate: UnknownRecord,
    jobName: string,
    result: JobResult,
    overrides: Readonly<Record<string, JobResult>> = {}
): string {
    return JSON.stringify(
        Object.fromEntries(
            arrayAt(jobAt(candidate, jobName), 'needs').map((name) => {
                const dependency = String(name);
                return [dependency, { result: overrides[dependency] ?? result }];
            })
        )
    );
}

function assertGitDeploymentsDisabled(config: UnknownRecord): void {
    const deploymentEnabled = recordAt(recordAt(config, 'git'), 'deploymentEnabled');
    if (deploymentEnabled.main !== false) {
        throw new Error('the Git integration must not deploy main');
    }
    if (deploymentEnabled['**'] !== false) {
        throw new Error('the Git integration must not deploy any other branch');
    }
}

function assertCrossOriginIsolationHeaders(config: UnknownRecord): void {
    const headers = arrayAt(config, 'headers').flatMap((rule) =>
        arrayAt(asRecord(rule, 'header rule'), 'headers').map((header) => asRecord(header, 'header'))
    );
    const served = (key: string, value: string): boolean =>
        headers.some((header) => header.key === key && header.value === value);
    if (
        !served('Cross-Origin-Opener-Policy', 'same-origin') ||
        !served('Cross-Origin-Embedder-Policy', 'require-corp')
    ) {
        throw new Error('the deployed application must stay cross-origin isolated');
    }
}

type DeployTrainScripts = { readonly validation: string; readonly freshness: string };

function assertDailyDeployTrain(candidate: UnknownRecord): DeployTrainScripts {
    const job = jobAt(candidate, DEPLOY_WEB_JOB);
    if (job.name !== DEPLOY_WEB_JOB_NAME) {
        throw new Error('the daily deploy train must retain its stable name');
    }
    if (job.if !== DEPLOY_WEB_CONDITION) {
        throw new Error('the daily deploy train must run only on the schedule and a dispatch of main');
    }
    const concurrency = job.concurrency === undefined ? {} : recordAt(job, 'concurrency');
    if (concurrency.group !== DEPLOY_WEB_CONCURRENCY_GROUP) {
        throw new Error('the daily deploy train must serialise itself against every other production deploy');
    }
    if (concurrency['cancel-in-progress'] !== false) {
        throw new Error('the daily deploy train must queue behind a running deploy rather than cancel it');
    }
    const needs = arrayAt(job, 'needs').map(String);
    for (const leg of DEPLOY_WEB_NEEDS) {
        if (!needs.includes(leg)) {
            throw new Error(`the daily deploy train must depend on ${leg}`);
        }
    }
    if (needs.length !== DEPLOY_WEB_NEEDS.length) {
        throw new Error('the daily deploy train must depend on exactly the scheduled validation legs');
    }
    if (job.environment !== DEPLOY_ENVIRONMENT) {
        throw new Error('the daily deploy train must draw its credential from the Production environment');
    }
    const jobEnvironment = recordAt(job, 'env');
    if (jobEnvironment.DEPLOY_CREDENTIAL_PRESENT !== DEPLOY_CREDENTIAL_REFERENCE) {
        throw new Error('the daily deploy train must resolve credential presence without exposing the token');
    }
    if (!VERCEL_CLI_PIN.test(String(jobEnvironment.VERCEL_CLI))) {
        throw new Error('the daily deploy train must pin an exact Vercel CLI version');
    }
    for (const name of DEPLOY_CREDENTIAL_GATED_STEPS) {
        if (stepNamed(job, name).if !== DEPLOY_CREDENTIAL_CONDITION) {
            throw new Error(`${name} must not run without the deployment credential`);
        }
    }
    for (const name of DEPLOY_FRESH_GATED_STEPS) {
        if (stepNamed(job, name).if !== DEPLOY_FRESH_REVISION_CONDITION) {
            throw new Error(`${name} must not run for a revision that is no longer the tip of main`);
        }
    }
    for (const name of DEPLOY_REVISION_GATED_STEPS) {
        if (stepNamed(job, name).if !== DEPLOY_CHANGED_REVISION_CONDITION) {
            throw new Error(`${name} must not run for a revision production already serves`);
        }
    }
    if (recordAt(stepNamed(job, 'Checkout the validated revision'), 'with').ref !== '${{ github.sha }}') {
        throw new Error('the daily deploy train must build the revision its validation legs reported on');
    }
    const deployment = stringAt(stepNamed(job, 'Deploy the prebuilt revision'), 'run');
    if (!deployment.includes('deploy --prebuilt --prod')) {
        throw new Error('the daily deploy train must deploy the artifact it built from the validated revision');
    }
    if (!deployment.includes('--meta githubCommitSha="$GITHUB_SHA"')) {
        throw new Error('the daily deploy train must record the deployed revision on the deployment');
    }
    for (const name of VERCEL_CLI_STEPS) {
        if (recordAt(stepNamed(job, name), 'env').VERCEL_TOKEN !== VERCEL_TOKEN_REFERENCE) {
            throw new Error(`${name} must authenticate from the environment rather than an echoed argument`);
        }
    }
    const isolationStep = stepNamed(job, 'Assert cross-origin isolation on the deployment');
    if (recordAt(isolationStep, 'env').DEPLOYMENT_URL !== DEPLOYMENT_URL_REFERENCE) {
        throw new Error('the daily deploy train must read its headers back off the deployment it just created');
    }
    const isolation = stringAt(isolationStep, 'run');
    if (
        !isolation.includes('cross-origin-opener-policy: same-origin') ||
        !isolation.includes('cross-origin-embedder-policy: require-corp')
    ) {
        throw new Error('the daily deploy train must read the isolation headers back off the deployment');
    }
    const serialised = JSON.stringify(job);
    for (const sideEffect of RELEASE_SIDE_EFFECTS) {
        if (sideEffect.test(serialised)) {
            throw new Error(`a daily web deployment must not carry a release side effect: ${sideEffect.source}`);
        }
    }
    // Promotion is not validation. It must not be able to fail either summary,
    // and the required `Gate` lives in another workflow entirely now.
    if (arrayAt(jobAt(candidate, 'heavy-gate'), 'needs').includes(DEPLOY_WEB_JOB)) {
        throw new Error('the daily deploy train must stay outside the heavy summary');
    }
    const armingReport = stringAt(stepNamed(job, DEPLOY_WEB_CREDENTIAL_REPORT_STEP), 'run');
    for (const precondition of DEPLOY_ARMING_PRECONDITIONS) {
        if (!armingReport.includes(precondition)) {
            throw new Error(`the gated-off report must name every arming precondition, including ${precondition}`);
        }
    }
    const guardStep = stepNamed(job, DEPLOY_WEB_GUARD_STEP);
    if (recordAt(guardStep, 'env').TRAIN_REF !== '${{ github.ref }}') {
        throw new Error('the daily deploy train must read the ref it is about to deploy');
    }
    const freshnessStep = stepNamed(job, DEPLOY_WEB_FRESHNESS_STEP);
    if (freshnessStep.id !== 'freshness') {
        throw new Error('the daily deploy train must publish its freshness decision under a stable step id');
    }
    if (recordAt(freshnessStep, 'env').CANDIDATE_REVISION !== '${{ github.sha }}') {
        throw new Error('the freshness check must read the revision this run is about to deploy');
    }
    const freshness = stringAt(freshnessStep, 'run');
    if (!freshness.includes('git ls-remote "https://github.com/$GITHUB_REPOSITORY.git" refs/heads/main')) {
        throw new Error('the freshness check must read the current tip of main from the remote');
    }
    if (!freshness.includes('"$tip" != "$CANDIDATE_REVISION"')) {
        throw new Error('the freshness check must compare the candidate against that tip');
    }
    return { validation: stringAt(guardStep, 'run'), freshness };
}

function assertGateContract(candidate: UnknownRecord): string {
    const gate = jobAt(candidate, 'gate');
    if (gate.name !== 'Gate' || gate.if !== GATE_CONDITION) {
        throw new Error('the Gate job must always report under its stable name');
    }
    const step = stepNamed(gate, 'Require every job to have succeeded or been skipped');
    if (recordAt(step, 'env').RESULTS !== '${{ toJSON(needs) }}') {
        throw new Error('gate must receive all dependency results through its environment');
    }
    const script = stringAt(step, 'run');
    if (!script.includes('.value.result != "success" and .value.result != "skipped"')) {
        throw new Error('gate must reject every result other than success or skipped');
    }
    return script;
}

function runResultsGuard(
    script: string,
    results: string,
    extraEnvironment: Readonly<Record<string, string>> = {}
): number | null {
    return spawnSync('bash', ['-c', script], {
        encoding: 'utf8',
        env: { ...process.env, RESULTS: results, ...extraEnvironment },
        shell: false,
    }).status;
}

type FreshnessRun = {
    readonly status: number | null;
    readonly stdout: string;
    readonly outputs: string;
    readonly summary: string;
};

/**
 * Runs the freshness step's own script against a stubbed `git ls-remote`. The
 * stub answering with no ref at all is the case that decides whether an
 * unreadable tip fails the job or deploys blind.
 */
function runFreshnessGuard(script: string, candidateRevision: string, remoteTip: string): FreshnessRun {
    const directory = mkdtempSync(join(tmpdir(), 'sourdaw-health-freshness-'));
    const binaries = join(directory, 'bin');
    const outputPath = join(directory, 'github-output');
    const summaryPath = join(directory, 'step-summary');
    try {
        mkdirSync(binaries);
        writeFileSync(
            join(binaries, 'git'),
            `#!/bin/sh\nif [ -n "${remoteTip}" ]; then printf '%s\\trefs/heads/main\\n' "${remoteTip}"; fi\n`
        );
        chmodSync(join(binaries, 'git'), 0o755);
        writeFileSync(outputPath, '');
        writeFileSync(summaryPath, '');
        const result = spawnSync('bash', ['-c', script], {
            encoding: 'utf8',
            env: {
                ...process.env,
                PATH: `${binaries}:${process.env.PATH ?? ''}`,
                GITHUB_REPOSITORY: 'jcosta33/sourdaw',
                CANDIDATE_REVISION: candidateRevision,
                GITHUB_OUTPUT: outputPath,
                GITHUB_STEP_SUMMARY: summaryPath,
            },
            shell: false,
        });
        return {
            status: result.status,
            stdout: result.stdout,
            outputs: readFileSync(outputPath, 'utf8'),
            summary: readFileSync(summaryPath, 'utf8'),
        };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

function assertCredentiallessScanner(candidate: UnknownRecord): void {
    const secrets = jobAt(candidate, 'secrets');
    if (TOKEN_REFERENCE.test(JSON.stringify(secrets))) {
        throw new Error('secret scan job must not reference GitHub tokens or repository secrets');
    }
    const trustedScanner = recordAt(stepNamed(secrets, 'Checkout trusted scanner'), 'with');
    if (
        trustedScanner.ref !== TRUSTED_SCANNER_REF ||
        trustedScanner.path !== 'trusted-scanner' ||
        trustedScanner['persist-credentials'] !== false
    ) {
        throw new Error('secret scanner must come from the trusted base and retain no credentials');
    }
    const scanTarget = recordAt(stepNamed(secrets, 'Checkout scan target'), 'with');
    if (
        scanTarget.ref !== SCAN_TARGET_REF ||
        scanTarget.path !== 'scan-target' ||
        scanTarget['fetch-depth'] !== 0 ||
        scanTarget['persist-credentials'] !== false
    ) {
        throw new Error('secret scan target must retain the complete untrusted history without credentials');
    }
    const positiveControl = stepNamed(secrets, 'Validate secret scanner positive control');
    if (recordAt(positiveControl, 'env').GITLEAKS_EXPECTED_LEAK_EXIT_CODE !== 79) {
        throw new Error('secret scanner positive control must require Gitleaks leak exit code 79');
    }
    const trustedScript = 'sh "$GITHUB_WORKSPACE/trusted-scanner/scripts/run-gitleaks-history-scan.sh"';
    if (!stringAt(positiveControl, 'run').includes(trustedScript)) {
        throw new Error('positive control must execute the trusted scanner script');
    }
    const scan = stepNamed(secrets, 'Scan history for secrets');
    if (stringAt(scan, 'run') !== `${trustedScript} "$GITHUB_WORKSPACE/scan-target/.git"`) {
        throw new Error('secret scan must execute the trusted scanner against the scan target history');
    }
}

describe('health gates workflow contract', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    // The regression this whole split exists to prevent. On PR #3116 a
    // comment-only review ran this workflow, every job legitimately skipped,
    // `gate` was minted as `skipped`, and GitHub read that as satisfying the
    // required `Gate` on a head whose earlier `Gate` had failed. A required
    // check cannot be defended by a job condition — only by keeping the events
    // that can skip it out of the file that mints it.
    it('lets only a pull-request run mint the required Gate', () => {
        expect(workflowDocument.errors).toEqual([]);
        expect(Object.keys(recordAt(workflow, 'on'))).toEqual([...HEALTH_GATES_TRIGGERS]);
        expect(Object.keys(recordAt(heavyWorkflow, 'on')).sort()).toEqual([...HEAVY_GATES_TRIGGERS]);
        expect(Object.keys(recordAt(validationWorkflow, 'on'))).toEqual([...VALIDATION_TRIGGERS]);
        expect(recordAt(recordAt(heavyWorkflow, 'on'), 'pull_request_review').types).toEqual(['submitted']);
        expect(() => assertRequiredCheckIsolation(workflowSet())).not.toThrow();

        const reviewTriggered = cloneWorkflows('review-triggered');
        recordAt(reviewTriggered.health, 'on').pull_request_review = { types: ['submitted'] };
        expect(() => assertRequiredCheckIsolation(reviewTriggered)).toThrow(
            'health-gates.yml must answer to pull_request alone'
        );

        const skippableGate = cloneWorkflows('skippable gate');
        jobAt(skippableGate.health, 'gate').if = HEAVY_GATE_CONDITION;
        expect(() => assertRequiredCheckIsolation(skippableGate)).toThrow(
            'Gate must carry no predicate that could skip it'
        );

        const shadowedGate = cloneWorkflows('shadowed gate');
        jobAt(shadowedGate.heavy, 'heavy-gate').name = REQUIRED_CHECK_NAME;
        expect(() => assertRequiredCheckIsolation(shadowedGate)).toThrow('heavy-gates.yml must not name a job Gate');

        const strandedCron = cloneWorkflows('stranded cron');
        arrayAt(recordAt(strandedCron.heavy, 'on'), 'schedule')[0] = { cron: '0 4 * * *' };
        expect(() => assertRequiredCheckIsolation(strandedCron)).toThrow(
            'the nightly cron must survive the move to the heavy workflow'
        );

        expect(() => assertWorkflowPermissions(workflow)).not.toThrow();
        expect(() => assertWorkflowPermissions(validationWorkflow)).not.toThrow();
        expect(() => assertWorkflowPermissions(heavyWorkflow)).not.toThrow();
        expect(() => assertConcurrencyContract(workflow)).not.toThrow();

        const missingPullRequestAccess = asRecord(structuredClone(workflow), 'missing pull-request permission');
        delete recordAt(missingPullRequestAccess, 'permissions')['pull-requests'];
        expect(() => assertWorkflowPermissions(missingPullRequestAccess)).toThrow(
            'workflow must grant only read access to contents and pull requests'
        );

        const widenedPullRequestAccess = asRecord(structuredClone(workflow), 'widened pull-request permission');
        recordAt(widenedPullRequestAccess, 'permissions')['pull-requests'] = 'write';
        expect(() => assertWorkflowPermissions(widenedPullRequestAccess)).toThrow(
            'workflow must grant only read access to contents and pull requests'
        );
    });

    it('rejects review-triggered cancellation and changing the pull-request grouping key', () => {
        const cancellingReview = asRecord(structuredClone(workflow), 'cancelling review workflow');
        recordAt(cancellingReview, 'concurrency')['cancel-in-progress'] =
            "${{ github.event_name == 'pull_request' || (github.event_name == 'pull_request_review' && github.event.review.state == 'approved') }}";
        expect(() => assertConcurrencyContract(cancellingReview)).toThrow(
            'only a newer pull-request run may cancel in-progress work'
        );
        const splitPullRequest = asRecord(structuredClone(workflow), 'split pull-request workflow');
        recordAt(splitPullRequest, 'concurrency').group = 'health-gates-${{ github.run_id }}';
        expect(() => assertConcurrencyContract(splitPullRequest)).toThrow(
            'workflow must group runs by pull request or ref'
        );
    });

    it('runs the heavy security lane only for approved reviews, schedules, and dispatches', () => {
        const scopeScript = assertScopeContract(validationWorkflow);
        expect(runScopeScript(scopeScript, 'pull_request')).toEqual({
            heavy: 'false',
            rust: 'false',
            server: 'false',
            e2e: 'false',
            web: 'false',
            code: 'false',
        });
        expect(runScopeScript(scopeScript, 'pull_request_review')).toMatchObject({ heavy: 'true' });
        for (const eventName of ['schedule', 'workflow_dispatch']) {
            expect(runScopeScript(scopeScript, eventName)).toEqual(FORCED_SCOPE_OUTPUTS);
        }
        const nonApproval = asRecord(structuredClone(validationWorkflow), 'non-approval validationWorkflow');
        jobAt(nonApproval, 'decide').if = "github.event_name != 'pull_request_review'";
        expect(() => assertScopeContract(nonApproval)).toThrow('decide must only admit submitted approved reviews');
        const undisclosedWebScope = asRecord(
            structuredClone(validationWorkflow),
            'undisclosed web scope validationWorkflow'
        );
        recordAt(jobAt(undisclosedWebScope, 'decide'), 'outputs').web = HEAVY_OUTPUT_REFERENCE;
        expect(() => assertScopeContract(undisclosedWebScope)).toThrow(
            'decide web output must expose steps.scope.outputs.web'
        );
    });

    it('treats an unclassified path as code-bearing and prose as nothing to check', () => {
        const scopeScript = assertScopeContract(validationWorkflow);
        expect(() => assertUnclassifiedFallback(validationWorkflow)).not.toThrow();
        expect(() => assertProseSkippingJobs(validationWorkflow)).not.toThrow();

        expect(runScopeScript(scopeScript, 'pull_request', { UNCLASSIFIED: 'true' })).toEqual({
            heavy: 'false',
            rust: 'true',
            server: 'true',
            e2e: 'true',
            web: 'true',
            code: 'true',
        });
        expect(runScopeScript(scopeScript, 'pull_request', { WEB: 'true' })).toMatchObject({
            rust: 'false',
            code: 'true',
        });

        const exemptMetadata = asRecord(structuredClone(validationWorkflow), 'metadata-exempt validationWorkflow');
        const filterOptions = recordAt(stepNamed(jobAt(exemptMetadata, 'decide'), 'Filter changed paths'), 'with');
        filterOptions.filters = stringAt(filterOptions, 'filters').replace(
            "- '!docs/**'",
            "- '!docs/**'\n  - '!.github/ISSUE_TEMPLATE/**'"
        );
        expect(() => assertUnclassifiedFallback(exemptMetadata)).toThrow(
            'repository metadata is machine-read and must not be exempt'
        );

        const anyPatternWins = asRecord(structuredClone(validationWorkflow), 'any-pattern validationWorkflow');
        recordAt(stepNamed(jobAt(anyPatternWins, 'decide'), 'Filter changed paths'), 'with')['predicate-quantifier'] =
            'some';
        expect(() => assertUnclassifiedFallback(anyPatternWins)).toThrow(
            'path filters must subtract negated patterns instead of matching on any one of them'
        );

        const conditionalInventory = asRecord(
            structuredClone(validationWorkflow),
            'conditional inventory validationWorkflow'
        );
        jobAt(conditionalInventory, 'static').if = CODE_CONDITION;
        expect(() => assertProseSkippingJobs(conditionalInventory)).toThrow(
            'release inventory answers to prose changes, so static must stay unconditional'
        );

        const alwaysLinting = asRecord(structuredClone(validationWorkflow), 'unconditional lint validationWorkflow');
        delete jobAt(alwaysLinting, 'lint').if;
        expect(() => assertProseSkippingJobs(alwaysLinting)).toThrow('lint must skip a head that carries only prose');
    });

    it('gives every pull request an offline smoke set and a diff secret scan', () => {
        expect(() => assertOfflineSmokeJob(validationWorkflow)).not.toThrow();
        expect(() => assertPullRequestSecretScan(validationWorkflow)).not.toThrow();

        const retryingSmoke = asRecord(structuredClone(validationWorkflow), 'retrying smoke validationWorkflow');
        stepNamed(jobAt(retryingSmoke, 'smoke'), 'Run offline smoke set').run = 'pnpm test:e2e tests/e2e/smoke.spec.ts';
        expect(() => assertOfflineSmokeJob(retryingSmoke)).toThrow(
            'the offline smoke job must run the smoke spec without retries'
        );

        const eventGatedSmoke = asRecord(structuredClone(validationWorkflow), 'event-gated smoke validationWorkflow');
        jobAt(eventGatedSmoke, 'smoke').if = EVENT_GATED_SMOKE_CONDITION;
        expect(() => assertOfflineSmokeJob(eventGatedSmoke)).toThrow(
            'the offline smoke job must run on every pull-request run that touches the browser surface'
        );

        const eventGatedDiffScan = asRecord(
            structuredClone(validationWorkflow),
            'event-gated diff scan validationWorkflow'
        );
        jobAt(eventGatedDiffScan, 'pr-secrets').if = "github.event_name == 'pull_request'";
        expect(() => assertPullRequestSecretScan(eventGatedDiffScan)).toThrow(
            'the pull-request secret scan must run on every run carrying a pull request'
        );

        const historyScanningDiff = asRecord(
            structuredClone(validationWorkflow),
            'history-scanning diff validationWorkflow'
        );
        const diffScan = stepNamed(jobAt(historyScanningDiff, 'pr-secrets'), 'Scan pull request diff for secrets');
        diffScan.run = stringAt(diffScan, 'run').replace('--log-opts="$BASE_SHA..$HEAD_SHA -m"', '--log-opts=--all');
        expect(() => assertPullRequestSecretScan(historyScanningDiff)).toThrow(
            'pull-request secret scan must scan the commits this head adds to its base'
        );

        const headControlledScanner = asRecord(
            structuredClone(validationWorkflow),
            'head-controlled scanner validationWorkflow'
        );
        recordAt(stepNamed(jobAt(headControlledScanner, 'pr-secrets'), 'Checkout trusted scanner'), 'with').ref =
            '${{ github.event.pull_request.head.sha }}';
        expect(() => assertPullRequestSecretScan(headControlledScanner)).toThrow(
            'pull-request scanner config must come from the trusted base and retain no credentials'
        );
    });

    it('keeps the required Gate on the validation lane and the heavy jobs on their own summary', () => {
        expect(() => assertJobGraph(workflowSet())).not.toThrow();

        const eventGatedDependencyReview = cloneWorkflows('event-gated dependency review');
        jobAt(eventGatedDependencyReview.validation, 'dependency-review').if = "github.event_name == 'pull_request'";
        expect(() => assertJobGraph(eventGatedDependencyReview)).toThrow(
            'dependency review must gate on the pull request payload rather than the triggering event'
        );

        // The finding that took `e2e` back out of `Gate`: it is a heavy-lane job
        // that no pull-request run executes, so listing it claimed a coverage
        // the required check never had.
        for (const heavyOnly of HEAVY_ONLY_JOBS) {
            const overGated = cloneWorkflows(`over-gated ${heavyOnly}`);
            arrayAt(jobAt(overGated.health, 'gate'), 'needs').push(heavyOnly);
            expect(() => assertJobGraph(overGated)).toThrow(
                `${heavyOnly} never runs on a pull-request push and must stay outside the required Gate`
            );
        }

        const blindNightly = cloneWorkflows('blind nightly');
        const nightlyNeeds = arrayAt(jobAt(blindNightly.heavy, 'nightly-report'), 'needs');
        nightlyNeeds.splice(nightlyNeeds.indexOf('validation'), 1);
        expect(() => assertJobGraph(blindNightly)).toThrow(
            'the nightly reporter must depend on every leg a scheduled run performs'
        );

        const widenedSummary = cloneWorkflows('widened summary');
        arrayAt(jobAt(widenedSummary.health, 'gate'), 'needs').push('nightly-report');
        expect(() => assertJobGraph(widenedSummary)).toThrow('gate must depend on exactly the pinned member list');

        const ungatedValidation = cloneWorkflows('ungated validation');
        const ungatedNeeds = arrayAt(jobAt(ungatedValidation.health, 'gate'), 'needs');
        ungatedNeeds.splice(ungatedNeeds.indexOf('validation'), 1);
        expect(() => assertJobGraph(ungatedValidation)).toThrow('gate must depend on validation');

        // A leg dropped out of the shared lane leaves the required Gate without
        // failing anything: the summary still passes, on less evidence.
        const strippedLane = cloneWorkflows('stripped validation lane');
        delete recordAt(strippedLane.validation, 'jobs').unit;
        expect(() => assertJobGraph(strippedLane)).toThrow('validation.yml must hold exactly the pinned job list');

        const inlinedLane = cloneWorkflows('inlined lane');
        delete jobAt(inlinedLane.health, 'validation').uses;
        expect(() => assertJobGraph(inlinedLane)).toThrow(
            'health-gates.yml must call the shared validation lane rather than redefine it'
        );

        const disconnected = cloneWorkflows('disconnected security');
        jobAt(disconnected.heavy, 'secrets').needs = 'e2e';
        expect(() => assertJobGraph(disconnected)).toThrow(
            'security scans must depend on the validation call that publishes the scope'
        );

        const renamedHeavySummary = cloneWorkflows('renamed heavy summary');
        jobAt(renamedHeavySummary.heavy, 'heavy-gate').name = 'Heavy summary';
        expect(() => assertJobGraph(renamedHeavySummary)).toThrow(
            'the heavy summary must keep its own name and its non-approved-review predicate'
        );

        const narrowedHeavySummary = cloneWorkflows('narrowed heavy summary');
        const heavyNeeds = arrayAt(jobAt(narrowedHeavySummary.heavy, 'heavy-gate'), 'needs');
        heavyNeeds.splice(heavyNeeds.indexOf('e2e'), 1);
        expect(() => assertJobGraph(narrowedHeavySummary)).toThrow(
            'HeavyGate must depend on exactly the pinned member list'
        );

        const disconnectedUnit = cloneWorkflows('disconnected unit');
        jobAt(disconnectedUnit.validation, 'unit').needs = 'static';
        expect(() => assertJobGraph(disconnectedUnit)).toThrow(
            'unit must retain its current dependency and scope condition'
        );

        const ungatedE2eScope = cloneWorkflows('ungated e2e scope');
        jobAt(ungatedE2eScope.heavy, 'e2e').if = "needs.validation.outputs.e2e == 'true'";
        expect(() => assertJobGraph(ungatedE2eScope)).toThrow(
            'e2e must retain its current dependency and scope condition'
        );

        // Softening a shard step reports a failing suite as a passing summary —
        // the hole this change closed, in the other direction.
        for (const [suite, wiring] of Object.entries(SUITE_JOB_WIRING)) {
            const softenedStep = cloneWorkflows(`softened ${suite} step`);
            stepNamed(jobAt(softenedStep[wiring.workflow], suite), SUITE_SHARD_STEP)['continue-on-error'] =
                "${{ github.event_name == 'pull_request' }}";
            expect(() => assertJobGraph(softenedStep)).toThrow(
                `${suite} shards must fail their job rather than report a warning`
            );

            const softenedJob = cloneWorkflows(`softened ${suite} job`);
            jobAt(softenedJob[wiring.workflow], suite)['continue-on-error'] = true;
            expect(() => assertJobGraph(softenedJob)).toThrow(`${suite} must not use job-level continue-on-error`);
        }
    });

    it('fetches immutable measurement provenance history only in the unit matrix', () => {
        expect(() => assertUnitProvenanceHistory(validationWorkflow)).not.toThrow();

        const shallowUnit = asRecord(structuredClone(validationWorkflow), 'shallow unit validationWorkflow');
        delete recordAt(stepNamed(jobAt(shallowUnit, 'unit'), 'Checkout'), 'with')['fetch-depth'];
        expect(() => assertUnitProvenanceHistory(shallowUnit)).toThrow(
            'unit must retain complete history for immutable measurement provenance'
        );

        for (const jobName of ['lint', 'boundaries']) {
            const broadened = asRecord(
                structuredClone(validationWorkflow),
                `${jobName} full-history validationWorkflow`
            );
            stepNamed(jobAt(broadened, jobName), 'Checkout').with = { 'fetch-depth': 0 };
            expect(() => assertUnitProvenanceHistory(broadened)).toThrow(`${jobName} must not fetch complete history`);
        }
    });

    it('gates the dedicated Browser AI WebGPU and admitted-presentation proofs on a standard macOS runner', async () => {
        expect(() => assertBrowserAiWebGpuJob(heavyWorkflow)).not.toThrow();
        expect(() => assertBrowserAiWebGpuProofChain(packageManifest, browserAiWebGpuConfig)).not.toThrow();

        for (const runner of ['self-hosted', 'macos-14-large', 'macos-14-xlarge']) {
            const premiumRunner = asRecord(structuredClone(heavyWorkflow), `${runner} Browser AI heavyWorkflow`);
            jobAt(premiumRunner, BROWSER_AI_WEBGPU_JOB)['runs-on'] = runner;
            expect(() => assertBrowserAiWebGpuJob(premiumRunner)).toThrow(
                'Browser AI WebGPU job must use the standard macos-14 runner'
            );
        }

        const fastLane = asRecord(structuredClone(heavyWorkflow), 'fast-lane Browser AI heavyWorkflow');
        jobAt(fastLane, BROWSER_AI_WEBGPU_JOB).if = "needs.decide.outputs.e2e == 'true'";
        expect(() => assertBrowserAiWebGpuJob(fastLane)).toThrow(
            'Browser AI WebGPU job must retain its heavy E2E scope condition'
        );

        const defaultMatrix = asRecord(structuredClone(heavyWorkflow), 'default-matrix Browser AI heavyWorkflow');
        stepNamed(jobAt(defaultMatrix, BROWSER_AI_WEBGPU_JOB), 'Run Browser AI WebGPU admission').run =
            'pnpm test:e2e tests/e2e/browserAiWebGpuAdmission.spec.ts';
        expect(() => assertBrowserAiWebGpuJob(defaultMatrix)).toThrow(
            'Browser AI WebGPU job must run the dedicated hardware command'
        );

        const disconnectedGate = asRecord(structuredClone(heavyWorkflow), 'disconnected Browser AI heavy workflow');
        const heavyGateNeeds = arrayAt(jobAt(disconnectedGate, 'heavy-gate'), 'needs');
        heavyGateNeeds.splice(heavyGateNeeds.indexOf(BROWSER_AI_WEBGPU_JOB), 1);
        expect(() => assertBrowserAiWebGpuJob(disconnectedGate)).toThrow(
            'the heavy summary must depend on the Browser AI WebGPU job'
        );

        const indirectPackageScript = asRecord(structuredClone(packageManifest), 'indirect package manifest');
        recordAt(indirectPackageScript, 'scripts')[BROWSER_AI_WEBGPU_SCRIPT_NAME] =
            'playwright test tests/e2e/browserAiWebGpuAdmission.spec.ts';
        expect(() => assertBrowserAiWebGpuProofChain(indirectPackageScript, browserAiWebGpuConfig)).toThrow(
            'Browser AI WebGPU package script must run the dedicated Playwright config'
        );

        const expectedTestMatch = `Browser AI WebGPU config must match exactly these hardware-required specs, in order: ${BROWSER_AI_WEBGPU_TEST_MATCH.join(', ')}`;

        const broadConfig = asRecord(structuredClone(browserAiWebGpuConfig), 'broad Browser AI config');
        broadConfig.testMatch = '*.spec.ts';
        expect(() => assertBrowserAiWebGpuProofChain(packageManifest, broadConfig)).toThrow(expectedTestMatch);

        // A hardware-only spec that nobody registers here never runs: the
        // general matrix has no adapter to reach its admitted assertions.
        const unregisteredSpec = asRecord(structuredClone(browserAiWebGpuConfig), 'unregistered Browser AI config');
        unregisteredSpec.testMatch = [...BROWSER_AI_WEBGPU_TEST_MATCH, 'browserAiSomethingElse.spec.ts'];
        expect(() => assertBrowserAiWebGpuProofChain(packageManifest, unregisteredSpec)).toThrow(expectedTestMatch);

        const droppedSpec = asRecord(structuredClone(browserAiWebGpuConfig), 'dropped-spec Browser AI config');
        droppedSpec.testMatch = BROWSER_AI_WEBGPU_TEST_MATCH.slice(0, 1);
        expect(() => assertBrowserAiWebGpuProofChain(packageManifest, droppedSpec)).toThrow(expectedTestMatch);

        const reorderedSpecs = asRecord(structuredClone(browserAiWebGpuConfig), 'reordered Browser AI config');
        reorderedSpecs.testMatch = [...BROWSER_AI_WEBGPU_TEST_MATCH].reverse();
        expect(() => assertBrowserAiWebGpuProofChain(packageManifest, reorderedSpecs)).toThrow(expectedTestMatch);

        const optionalHardware = asRecord(
            structuredClone(browserAiWebGpuConfig),
            'optional-hardware Browser AI config'
        );
        delete recordAt(asRecord(arrayAt(optionalHardware, 'projects')[0], 'Browser AI project'), 'metadata')
            .browserAiWebGpuHardware;
        expect(() => assertBrowserAiWebGpuProofChain(packageManifest, optionalHardware)).toThrow(
            'Browser AI WebGPU project must require hardware'
        );

        const sharedServer = asRecord(structuredClone(browserAiWebGpuConfig), 'shared-server Browser AI config');
        recordAt(sharedServer, 'webServer').reuseExistingServer = true;
        expect(() => assertBrowserAiWebGpuProofChain(packageManifest, sharedServer)).toThrow(
            'Browser AI WebGPU config must own a non-reused isolated server'
        );

        const sharedOrigin = asRecord(structuredClone(browserAiWebGpuConfig), 'shared-origin Browser AI config');
        recordAt(sharedOrigin, 'use').baseURL = 'http://localhost:5173';
        expect(() => assertBrowserAiWebGpuProofChain(packageManifest, sharedOrigin)).toThrow(
            'Browser AI WebGPU config must own a non-reused isolated server'
        );

        const fallbackRequestAdapter = vi.fn().mockResolvedValue({
            info: { isFallbackAdapter: true },
            requestDevice: vi.fn(),
        });
        vi.stubGlobal('navigator', { gpu: { requestAdapter: fallbackRequestAdapter } });
        await expect(probeBrowserWebGpuHardwareInPage()).resolves.toEqual({
            status: 'unavailable',
            reason: 'fallback-adapter',
        });
        expect(fallbackRequestAdapter).toHaveBeenCalledWith({
            featureLevel: 'core',
            forceFallbackAdapter: false,
        });
        expect(() => requireBrowserWebGpuHardware({ status: 'unavailable', reason: 'fallback-adapter' })).toThrow(
            'This Browser AI proof requires hardware WebGPU (fallback-adapter)'
        );
    });

    it('requires every gate dependency to have succeeded or been skipped', () => {
        const gateScript = assertGateContract(workflow);
        expect(runResultsGuard(gateScript, needsResults(workflow, 'gate', 'success'))).toBe(0);
        expect(runResultsGuard(gateScript, needsResults(workflow, 'gate', 'skipped'))).toBe(0);
        expect(runResultsGuard(gateScript, needsResults(workflow, 'gate', 'failure'))).not.toBe(0);
        expect(runResultsGuard(gateScript, needsResults(workflow, 'gate', 'cancelled'))).not.toBe(0);
        const renamedGate = asRecord(structuredClone(workflow), 'renamed gate workflow');
        jobAt(renamedGate, 'gate').name = 'Health summary';
        expect(() => assertGateContract(renamedGate)).toThrow('the Gate job must always report under its stable name');
    });

    it('runs a trusted, credentialless scanner over the untrusted target history', () => {
        expect(() => assertCredentiallessScanner(heavyWorkflow)).not.toThrow();
        const targetControlledScanner = asRecord(
            structuredClone(heavyWorkflow),
            'target-controlled scanner heavyWorkflow'
        );
        recordAt(stepNamed(jobAt(targetControlledScanner, 'secrets'), 'Checkout trusted scanner'), 'with').ref =
            SCAN_TARGET_REF;
        expect(() => assertCredentiallessScanner(targetControlledScanner)).toThrow(
            'secret scanner must come from the trusted base and retain no credentials'
        );
        const tokenBearingScanner = asRecord(structuredClone(heavyWorkflow), 'token-bearing scanner heavyWorkflow');
        jobAt(tokenBearingScanner, 'secrets').env = { GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}' };
        expect(() => assertCredentiallessScanner(tokenBearingScanner)).toThrow(
            'secret scan job must not reference GitHub tokens or repository secrets'
        );
    });

    it('promotes the validated revision daily, only with a credential and only when it changed', () => {
        expect(() => assertGitDeploymentsDisabled(vercelConfig)).not.toThrow();
        expect(() => assertCrossOriginIsolationHeaders(vercelConfig)).not.toThrow();
        const { validation: validationGuard, freshness: freshnessGuard } = assertDailyDeployTrain(heavyWorkflow);

        const candidate = '1'.repeat(40);
        const newerTip = '2'.repeat(40);
        const fresh = runFreshnessGuard(freshnessGuard, candidate, candidate);
        expect(fresh.status).toBe(0);
        expect(fresh.outputs).toContain('fresh=true');
        expect(fresh.stdout).toContain('the candidate is the current tip of main');

        // A queue reordered by needs-completion, or a re-run replaying an older
        // run's SHA, both arrive here as a candidate that main has moved past.
        // Benign refusal, not an incident: green job, loud notice, no deploy.
        const stale = runFreshnessGuard(freshnessGuard, candidate, newerTip);
        expect(stale.status).toBe(0);
        expect(stale.outputs).toContain('fresh=false');
        expect(stale.outputs).not.toContain('fresh=true');
        expect(stale.stdout).toContain(`stale candidate ${candidate}, main is now ${newerTip}, deploying nothing`);
        expect(stale.summary).toContain(`stale candidate \`${candidate}\`, main is now \`${newerTip}\``);

        // An unreadable tip is the one case that must not resolve to a deploy.
        expect(runFreshnessGuard(freshnessGuard, candidate, '').status).not.toBe(0);

        const onMain = { TRAIN_REF: 'refs/heads/main' };
        expect(runResultsGuard(validationGuard, needsResults(heavyWorkflow, DEPLOY_WEB_JOB, 'success'), onMain)).toBe(
            0
        );
        const degraded: JobResult[] = ['failure', 'cancelled', 'skipped'];
        for (const result of degraded) {
            expect(
                runResultsGuard(
                    validationGuard,
                    needsResults(heavyWorkflow, DEPLOY_WEB_JOB, 'success', { e2e: result }),
                    onMain
                )
            ).not.toBe(0);
        }
        // The job condition already refuses a dispatch off main; this is the
        // half that still holds when somebody edits that condition.
        for (const ref of ['refs/heads/agent/2940/daily-train', 'refs/tags/v1.0.0', 'main']) {
            expect(
                runResultsGuard(validationGuard, needsResults(heavyWorkflow, DEPLOY_WEB_JOB, 'success'), {
                    TRAIN_REF: ref,
                })
            ).not.toBe(0);
        }

        const gitDeployingMain = asRecord(structuredClone(vercelConfig), 'git-deploying Vercel configuration');
        recordAt(recordAt(gitDeployingMain, 'git'), 'deploymentEnabled').main = true;
        expect(() => assertGitDeploymentsDisabled(gitDeployingMain)).toThrow(
            'the Git integration must not deploy main'
        );

        const gitDeployingBranches = asRecord(structuredClone(vercelConfig), 'branch-deploying Vercel configuration');
        recordAt(recordAt(gitDeployingBranches, 'git'), 'deploymentEnabled')['**'] = true;
        expect(() => assertGitDeploymentsDisabled(gitDeployingBranches)).toThrow(
            'the Git integration must not deploy any other branch'
        );

        const unisolated = asRecord(structuredClone(vercelConfig), 'unisolated Vercel configuration');
        asRecord(arrayAt(unisolated, 'headers')[0], 'header rule').headers = [];
        expect(() => assertCrossOriginIsolationHeaders(unisolated)).toThrow(
            'the deployed application must stay cross-origin isolated'
        );

        const pullRequestTrain = asRecord(structuredClone(heavyWorkflow), 'pull-request deploy train');
        jobAt(pullRequestTrain, DEPLOY_WEB_JOB).if = PULL_REQUEST_PAYLOAD_CONDITION;
        expect(() => assertDailyDeployTrain(pullRequestTrain)).toThrow(
            'the daily deploy train must run only on the schedule and a dispatch of main'
        );

        // A dispatch carries whichever ref was chosen, and every validation leg
        // would report honestly on it, so dropping this clause is what would
        // let an unmerged branch reach production.
        const anyBranchDispatch = asRecord(structuredClone(heavyWorkflow), 'any-branch dispatch deploy train');
        jobAt(anyBranchDispatch, DEPLOY_WEB_JOB).if =
            "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'";
        expect(() => assertDailyDeployTrain(anyBranchDispatch)).toThrow(
            'the daily deploy train must run only on the schedule and a dispatch of main'
        );

        const unguardedRef = asRecord(structuredClone(heavyWorkflow), 'unguarded-ref deploy train');
        delete recordAt(stepNamed(jobAt(unguardedRef, DEPLOY_WEB_JOB), DEPLOY_WEB_GUARD_STEP), 'env').TRAIN_REF;
        expect(() => assertDailyDeployTrain(unguardedRef)).toThrow(
            'the daily deploy train must read the ref it is about to deploy'
        );

        const racingTrain = asRecord(structuredClone(heavyWorkflow), 'racing deploy train');
        delete jobAt(racingTrain, DEPLOY_WEB_JOB).concurrency;
        expect(() => assertDailyDeployTrain(racingTrain)).toThrow(
            'the daily deploy train must serialise itself against every other production deploy'
        );

        const cancellingTrain = asRecord(structuredClone(heavyWorkflow), 'cancelling deploy train');
        recordAt(jobAt(cancellingTrain, DEPLOY_WEB_JOB), 'concurrency')['cancel-in-progress'] = true;
        expect(() => assertDailyDeployTrain(cancellingTrain)).toThrow(
            'the daily deploy train must queue behind a running deploy rather than cancel it'
        );

        const unauthenticatedBuild = asRecord(structuredClone(heavyWorkflow), 'unauthenticated deploy train');
        delete recordAt(stepNamed(jobAt(unauthenticatedBuild, DEPLOY_WEB_JOB), 'Build the validated revision'), 'env')
            .VERCEL_TOKEN;
        expect(() => assertDailyDeployTrain(unauthenticatedBuild)).toThrow(
            'Build the validated revision must authenticate from the environment rather than an echoed argument'
        );

        const reboundIsolation = asRecord(structuredClone(heavyWorkflow), 'rebound-isolation deploy train');
        recordAt(
            stepNamed(jobAt(reboundIsolation, DEPLOY_WEB_JOB), 'Assert cross-origin isolation on the deployment'),
            'env'
        ).DEPLOYMENT_URL = 'https://sourdaw.vercel.app';
        expect(() => assertDailyDeployTrain(reboundIsolation)).toThrow(
            'the daily deploy train must read its headers back off the deployment it just created'
        );

        const unvalidatedTrain = asRecord(structuredClone(heavyWorkflow), 'unvalidated deploy train');
        const trainNeeds = arrayAt(jobAt(unvalidatedTrain, DEPLOY_WEB_JOB), 'needs');
        trainNeeds.splice(trainNeeds.indexOf('codeql'), 1);
        expect(() => assertDailyDeployTrain(unvalidatedTrain)).toThrow('the daily deploy train must depend on codeql');

        const widenedTrain = asRecord(structuredClone(heavyWorkflow), 'widened deploy train');
        arrayAt(jobAt(widenedTrain, DEPLOY_WEB_JOB), 'needs').push('smoke');
        expect(() => assertDailyDeployTrain(widenedTrain)).toThrow(
            'the daily deploy train must depend on exactly the scheduled validation legs'
        );

        const unscopedTrain = asRecord(structuredClone(heavyWorkflow), 'unscoped deploy train');
        delete jobAt(unscopedTrain, DEPLOY_WEB_JOB).environment;
        expect(() => assertDailyDeployTrain(unscopedTrain)).toThrow(
            'the daily deploy train must draw its credential from the Production environment'
        );

        const ungatedTrain = asRecord(structuredClone(heavyWorkflow), 'ungated deploy train');
        delete recordAt(jobAt(ungatedTrain, DEPLOY_WEB_JOB), 'env').DEPLOY_CREDENTIAL_PRESENT;
        expect(() => assertDailyDeployTrain(ungatedTrain)).toThrow(
            'the daily deploy train must resolve credential presence without exposing the token'
        );

        const credentiallessDeploy = asRecord(structuredClone(heavyWorkflow), 'credentialless deploy train');
        stepNamed(jobAt(credentiallessDeploy, DEPLOY_WEB_JOB), DEPLOY_WEB_FRESHNESS_STEP).if =
            "github.event_name == 'schedule'";
        expect(() => assertDailyDeployTrain(credentiallessDeploy)).toThrow(
            `${DEPLOY_WEB_FRESHNESS_STEP} must not run without the deployment credential`
        );

        const unfreshResolver = asRecord(structuredClone(heavyWorkflow), 'stale-tolerant deploy train');
        stepNamed(jobAt(unfreshResolver, DEPLOY_WEB_JOB), 'Resolve the current production revision').if =
            DEPLOY_CREDENTIAL_CONDITION;
        expect(() => assertDailyDeployTrain(unfreshResolver)).toThrow(
            'Resolve the current production revision must not run for a revision that is no longer the tip of main'
        );

        const untippedTrain = asRecord(structuredClone(heavyWorkflow), 'untipped deploy train');
        const untippedStep = stepNamed(jobAt(untippedTrain, DEPLOY_WEB_JOB), DEPLOY_WEB_FRESHNESS_STEP);
        untippedStep.run = stringAt(untippedStep, 'run').replace(
            'git ls-remote "https://github.com/$GITHUB_REPOSITORY.git" refs/heads/main',
            'git rev-parse HEAD'
        );
        expect(() => assertDailyDeployTrain(untippedTrain)).toThrow(
            'the freshness check must read the current tip of main from the remote'
        );

        const uncomparedTip = asRecord(structuredClone(heavyWorkflow), 'uncompared-tip deploy train');
        const uncomparedStep = stepNamed(jobAt(uncomparedTip, DEPLOY_WEB_JOB), DEPLOY_WEB_FRESHNESS_STEP);
        uncomparedStep.run = stringAt(uncomparedStep, 'run').replace('"$tip" != "$CANDIDATE_REVISION"', '1 -eq 2');
        expect(() => assertDailyDeployTrain(uncomparedTip)).toThrow(
            'the freshness check must compare the candidate against that tip'
        );

        // The structural pins above cannot see a stale path that still writes
        // `fresh=true`; running the script is what does.
        const alwaysFresh = stringAt(uncomparedStep, 'run');
        expect(runFreshnessGuard(alwaysFresh, candidate, newerTip).outputs).toContain('fresh=true');

        const halfArmedReport = asRecord(structuredClone(heavyWorkflow), 'half-armed deploy train');
        const reportStep = stepNamed(jobAt(halfArmedReport, DEPLOY_WEB_JOB), DEPLOY_WEB_CREDENTIAL_REPORT_STEP);
        reportStep.run = stringAt(reportStep, 'run').replace('deployment branch policy limited to `main`', 'nothing');
        expect(() => assertDailyDeployTrain(halfArmedReport)).toThrow(
            'the gated-off report must name every arming precondition, including deployment branch policy limited to `main`'
        );

        const floatingCli = asRecord(structuredClone(heavyWorkflow), 'floating-CLI deploy train');
        recordAt(jobAt(floatingCli, DEPLOY_WEB_JOB), 'env').VERCEL_CLI = 'vercel@latest';
        expect(() => assertDailyDeployTrain(floatingCli)).toThrow(
            'the daily deploy train must pin an exact Vercel CLI version'
        );

        const movingTarget = asRecord(structuredClone(heavyWorkflow), 'moving-target deploy train');
        recordAt(stepNamed(jobAt(movingTarget, DEPLOY_WEB_JOB), 'Checkout the validated revision'), 'with').ref =
            '${{ github.ref }}';
        expect(() => assertDailyDeployTrain(movingTarget)).toThrow(
            'the daily deploy train must build the revision its validation legs reported on'
        );

        const duplicatingTrain = asRecord(structuredClone(heavyWorkflow), 'duplicating deploy train');
        stepNamed(jobAt(duplicatingTrain, DEPLOY_WEB_JOB), 'Deploy the prebuilt revision').if =
            DEPLOY_CREDENTIAL_CONDITION;
        expect(() => assertDailyDeployTrain(duplicatingTrain)).toThrow(
            'Deploy the prebuilt revision must not run for a revision production already serves'
        );

        const anonymousDeploy = asRecord(structuredClone(heavyWorkflow), 'anonymous deploy train');
        const deployStep = stepNamed(jobAt(anonymousDeploy, DEPLOY_WEB_JOB), 'Deploy the prebuilt revision');
        deployStep.run = stringAt(deployStep, 'run').replace('--meta githubCommitSha="$GITHUB_SHA"', '');
        expect(() => assertDailyDeployTrain(anonymousDeploy)).toThrow(
            'the daily deploy train must record the deployed revision on the deployment'
        );

        const unassertedIsolation = asRecord(structuredClone(heavyWorkflow), 'unasserted-isolation deploy train');
        stepNamed(jobAt(unassertedIsolation, DEPLOY_WEB_JOB), 'Assert cross-origin isolation on the deployment').run =
            'curl --fail --silent --head "$DEPLOYMENT_URL"';
        expect(() => assertDailyDeployTrain(unassertedIsolation)).toThrow(
            'the daily deploy train must read the isolation headers back off the deployment'
        );

        const taggingTrain = asRecord(structuredClone(heavyWorkflow), 'tagging deploy train');
        arrayAt(jobAt(taggingTrain, DEPLOY_WEB_JOB), 'steps').push({
            name: 'Tag the deployed revision',
            run: 'git tag "web-$GITHUB_SHA"',
        });
        expect(() => assertDailyDeployTrain(taggingTrain)).toThrow(
            'a daily web deployment must not carry a release side effect: git tag'
        );

        const gatingTrain = asRecord(structuredClone(heavyWorkflow), 'gating deploy train');
        arrayAt(jobAt(gatingTrain, 'heavy-gate'), 'needs').push(DEPLOY_WEB_JOB);
        expect(() => assertDailyDeployTrain(gatingTrain)).toThrow(
            'the daily deploy train must stay outside the heavy summary'
        );
    });
});
