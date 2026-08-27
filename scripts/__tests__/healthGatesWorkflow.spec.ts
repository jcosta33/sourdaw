import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
const HEAVY_CONDITION = "needs.decide.outputs.heavy == 'true'";
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
// An approving review cancels the in-flight push run, so a job that gates on
// the triggering event alone can never complete on the run that reports. Every
// Gate member reading a pull request keys off the payload instead.
const PULL_REQUEST_PAYLOAD_CONDITION = 'github.event.pull_request != null';
const SMOKE_CONDITION = `${PULL_REQUEST_PAYLOAD_CONDITION} && needs.decide.outputs.e2e == 'true'`;
const EVENT_GATED_SMOKE_CONDITION = "github.event_name == 'pull_request' && needs.decide.outputs.e2e == 'true'";
const SMOKE_COMMAND = 'pnpm test:e2e tests/e2e/smoke.spec.ts --retries=0';
const PULL_REQUEST_CONCURRENCY_GROUP =
    "health-gates-${{ (github.event_name == 'pull_request' || (github.event_name == 'pull_request_review' && github.event.review.state == 'approved')) && github.event.pull_request.number || github.run_id }}";
const PULL_REQUEST_CONCURRENCY_CANCELLATION =
    "${{ github.event_name == 'pull_request' || (github.event_name == 'pull_request_review' && github.event.review.state == 'approved') }}";
const GATE_CONDITION =
    "${{ !cancelled() && (github.event_name != 'pull_request_review' || github.event.review.state == 'approved') }}";
const DEPENDENCY_REVIEW_ACTION = 'actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294';
const TRUSTED_SCANNER_REF = '${{ github.event.pull_request.base.sha || github.sha }}';
const SCAN_TARGET_REF = '${{ github.event.pull_request.head.sha || github.sha }}';
const TOKEN_REFERENCE = /GITHUB_TOKEN|GH_TOKEN|github\.token|\$\{\{\s*secrets\./i;
const BROWSER_AI_WEBGPU_JOB = 'browser-ai-webgpu';
const BROWSER_AI_WEBGPU_JOB_NAME = 'Browser AI WebGPU admission';
const BROWSER_AI_WEBGPU_CONDITION = "needs.decide.outputs.heavy == 'true' && needs.decide.outputs.e2e == 'true'";
const BROWSER_AI_WEBGPU_RUNNER = 'macos-14';
const BROWSER_AI_WEBGPU_SCRIPT_NAME = 'test:e2e:browser-ai-webgpu-admission';
const BROWSER_AI_WEBGPU_COMMAND = 'pnpm test:e2e:browser-ai-webgpu-admission';
const BROWSER_AI_WEBGPU_PACKAGE_SCRIPT =
    'playwright test --config tests/e2e/browserAiWebGpuAdmission.playwright.config.ts';
const BROWSER_AI_WEBGPU_TEST_MATCH = 'browserAiWebGpuAdmission.spec.ts';
const BROWSER_AI_WEBGPU_ORIGIN = 'http://localhost:5188';
const BROWSER_AI_WEBGPU_SERVER_COMMAND = 'pnpm dev --host 127.0.0.1 --port 5188 --strictPort';
// Exact rather than a subset: a job added to the Gate without a first observed
// hosted run is the mistake this pin exists to catch.
const GATE_MEMBERS = [
    'decide',
    'static',
    'lint',
    'boundaries',
    'dependency-review',
    'pr-secrets',
    'smoke',
    'build',
    'rust',
    'native-macos',
    'native-windows',
    'browser-ai-webgpu',
    'codeql',
    'secrets',
] as const;
const CURRENT_NON_GATING_JOBS = ['unit', 'e2e'] as const;
const CURRENT_NON_GATING_JOB_WIRING = {
    unit: { needs: 'decide', if: "needs.decide.outputs.web == 'true'" },
    e2e: { needs: 'decide', if: "needs.decide.outputs.heavy == 'true' && needs.decide.outputs.e2e == 'true'" },
} satisfies Record<(typeof CURRENT_NON_GATING_JOBS)[number], Readonly<{ needs: string; if: string }>>;

const repositoryRoot = resolve(import.meta.dirname, '../..');
const parsedPackageManifest: unknown = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));
const packageManifest = asRecord(parsedPackageManifest, 'package manifest');
const browserAiWebGpuConfig = asRecord(browserAiWebGpuAdmissionConfig, 'Browser AI WebGPU config');
const workflowSource = readFileSync(join(repositoryRoot, '.github/workflows/health-gates.yml'), 'utf8');
const workflowDocument = parseDocument(workflowSource);
if (workflowDocument.errors.length > 0) {
    throw new Error(
        `health-gates.yml is invalid YAML: ${workflowDocument.errors.map((error) => error.message).join('; ')}`
    );
}
const workflow = asRecord(workflowDocument.toJS(), 'workflow');

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

function assertJobGraph(candidate: UnknownRecord): void {
    const dependencyReview = jobAt(candidate, 'dependency-review');
    if (dependencyReview.needs !== 'decide' || dependencyReview.if !== PULL_REQUEST_PAYLOAD_CONDITION) {
        throw new Error('dependency review must gate on the pull request payload rather than the triggering event');
    }
    if (stepNamed(dependencyReview, 'Review dependency changes').uses !== DEPENDENCY_REVIEW_ACTION) {
        throw new Error('dependency review action must remain pinned');
    }
    if (jobAt(candidate, 'codeql').if !== HEAVY_CONDITION || jobAt(candidate, 'secrets').if !== HEAVY_CONDITION) {
        throw new Error('security scans must consume the heavy scope output');
    }
    if (jobAt(candidate, 'codeql').needs !== 'decide' || jobAt(candidate, 'secrets').needs !== 'decide') {
        throw new Error('security scans must depend directly on decide');
    }
    const gateNeeds = arrayAt(jobAt(candidate, 'gate'), 'needs');
    for (const job of GATE_MEMBERS) {
        if (!gateNeeds.includes(job)) {
            throw new Error(`gate must depend on ${job}`);
        }
    }
    for (const job of CURRENT_NON_GATING_JOBS) {
        const nonGatingJob = jobAt(candidate, job);
        const expectedWiring = CURRENT_NON_GATING_JOB_WIRING[job];
        if (nonGatingJob.needs !== expectedWiring.needs || nonGatingJob.if !== expectedWiring.if) {
            throw new Error(`${job} must retain its current decide dependency and scope condition`);
        }
        if (gateNeeds.includes(job)) {
            throw new Error(`${job} is currently non-gating`);
        }
    }
    if (gateNeeds.length !== GATE_MEMBERS.length) {
        throw new Error('gate must depend on exactly the pinned member list');
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
    if (job.needs !== 'decide' || job.if !== BROWSER_AI_WEBGPU_CONDITION) {
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
    if (!arrayAt(jobAt(candidate, 'gate'), 'needs').includes(BROWSER_AI_WEBGPU_JOB)) {
        throw new Error('gate must depend on the Browser AI WebGPU job');
    }
}

function assertBrowserAiWebGpuProofChain(manifest: UnknownRecord, config: UnknownRecord): void {
    const scripts = recordAt(manifest, 'scripts');
    if (scripts[BROWSER_AI_WEBGPU_SCRIPT_NAME] !== BROWSER_AI_WEBGPU_PACKAGE_SCRIPT) {
        throw new Error('Browser AI WebGPU package script must run the dedicated Playwright config');
    }
    if (config.testMatch !== BROWSER_AI_WEBGPU_TEST_MATCH) {
        throw new Error('Browser AI WebGPU config must match only the dedicated admission spec');
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

function gateResults(
    candidate: UnknownRecord,
    result: JobResult,
    overrides: Readonly<Record<string, JobResult>> = {}
): string {
    return JSON.stringify(
        Object.fromEntries(
            arrayAt(jobAt(candidate, 'gate'), 'needs').map((name) => {
                const jobName = String(name);
                return [jobName, { result: overrides[jobName] ?? result }];
            })
        )
    );
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

function runGateScript(script: string, results: string): number | null {
    return spawnSync('bash', ['-c', script], {
        encoding: 'utf8',
        env: { ...process.env, RESULTS: results },
        shell: false,
    }).status;
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

    it('parses and subscribes only to the intended events', () => {
        expect(workflowDocument.errors).toEqual([]);
        const events = recordAt(workflow, 'on');
        expect(recordAt(events, 'pull_request_review').types).toEqual(['submitted']);
        expect(Object.hasOwn(events, 'pull_request')).toBe(true);
        expect(Object.hasOwn(events, 'schedule')).toBe(true);
        expect(Object.hasOwn(events, 'workflow_dispatch')).toBe(true);
        expect(() => assertWorkflowPermissions(workflow)).not.toThrow();
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
        recordAt(cancellingReview, 'concurrency')['cancel-in-progress'] = "${{ github.event_name != 'schedule' }}";
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
        const scopeScript = assertScopeContract(workflow);
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
        const nonApproval = asRecord(structuredClone(workflow), 'non-approval workflow');
        jobAt(nonApproval, 'decide').if = "github.event_name != 'pull_request_review'";
        expect(() => assertScopeContract(nonApproval)).toThrow('decide must only admit submitted approved reviews');
        const undisclosedWebScope = asRecord(structuredClone(workflow), 'undisclosed web scope workflow');
        recordAt(jobAt(undisclosedWebScope, 'decide'), 'outputs').web = HEAVY_OUTPUT_REFERENCE;
        expect(() => assertScopeContract(undisclosedWebScope)).toThrow(
            'decide web output must expose steps.scope.outputs.web'
        );
    });

    it('treats an unclassified path as code-bearing and prose as nothing to check', () => {
        const scopeScript = assertScopeContract(workflow);
        expect(() => assertUnclassifiedFallback(workflow)).not.toThrow();
        expect(() => assertProseSkippingJobs(workflow)).not.toThrow();

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

        const exemptMetadata = asRecord(structuredClone(workflow), 'metadata-exempt workflow');
        const filterOptions = recordAt(stepNamed(jobAt(exemptMetadata, 'decide'), 'Filter changed paths'), 'with');
        filterOptions.filters = stringAt(filterOptions, 'filters').replace(
            "- '!docs/**'",
            "- '!docs/**'\n  - '!.github/ISSUE_TEMPLATE/**'"
        );
        expect(() => assertUnclassifiedFallback(exemptMetadata)).toThrow(
            'repository metadata is machine-read and must not be exempt'
        );

        const anyPatternWins = asRecord(structuredClone(workflow), 'any-pattern workflow');
        recordAt(stepNamed(jobAt(anyPatternWins, 'decide'), 'Filter changed paths'), 'with')['predicate-quantifier'] =
            'some';
        expect(() => assertUnclassifiedFallback(anyPatternWins)).toThrow(
            'path filters must subtract negated patterns instead of matching on any one of them'
        );

        const conditionalInventory = asRecord(structuredClone(workflow), 'conditional inventory workflow');
        jobAt(conditionalInventory, 'static').if = CODE_CONDITION;
        expect(() => assertProseSkippingJobs(conditionalInventory)).toThrow(
            'release inventory answers to prose changes, so static must stay unconditional'
        );

        const alwaysLinting = asRecord(structuredClone(workflow), 'unconditional lint workflow');
        delete jobAt(alwaysLinting, 'lint').if;
        expect(() => assertProseSkippingJobs(alwaysLinting)).toThrow('lint must skip a head that carries only prose');
    });

    it('gives every pull request an offline smoke set and a diff secret scan', () => {
        expect(() => assertOfflineSmokeJob(workflow)).not.toThrow();
        expect(() => assertPullRequestSecretScan(workflow)).not.toThrow();

        const retryingSmoke = asRecord(structuredClone(workflow), 'retrying smoke workflow');
        stepNamed(jobAt(retryingSmoke, 'smoke'), 'Run offline smoke set').run = 'pnpm test:e2e tests/e2e/smoke.spec.ts';
        expect(() => assertOfflineSmokeJob(retryingSmoke)).toThrow(
            'the offline smoke job must run the smoke spec without retries'
        );

        const eventGatedSmoke = asRecord(structuredClone(workflow), 'event-gated smoke workflow');
        jobAt(eventGatedSmoke, 'smoke').if = EVENT_GATED_SMOKE_CONDITION;
        expect(() => assertOfflineSmokeJob(eventGatedSmoke)).toThrow(
            'the offline smoke job must run on every pull-request run that touches the browser surface'
        );

        const eventGatedDiffScan = asRecord(structuredClone(workflow), 'event-gated diff scan workflow');
        jobAt(eventGatedDiffScan, 'pr-secrets').if = "github.event_name == 'pull_request'";
        expect(() => assertPullRequestSecretScan(eventGatedDiffScan)).toThrow(
            'the pull-request secret scan must run on every run carrying a pull request'
        );

        const historyScanningDiff = asRecord(structuredClone(workflow), 'history-scanning diff workflow');
        const diffScan = stepNamed(jobAt(historyScanningDiff, 'pr-secrets'), 'Scan pull request diff for secrets');
        diffScan.run = stringAt(diffScan, 'run').replace('--log-opts="$BASE_SHA..$HEAD_SHA -m"', '--log-opts=--all');
        expect(() => assertPullRequestSecretScan(historyScanningDiff)).toThrow(
            'pull-request secret scan must scan the commits this head adds to its base'
        );

        const headControlledScanner = asRecord(structuredClone(workflow), 'head-controlled scanner workflow');
        recordAt(stepNamed(jobAt(headControlledScanner, 'pr-secrets'), 'Checkout trusted scanner'), 'with').ref =
            '${{ github.event.pull_request.head.sha }}';
        expect(() => assertPullRequestSecretScan(headControlledScanner)).toThrow(
            'pull-request scanner config must come from the trusted base and retain no credentials'
        );
    });

    it('keeps the current fast, heavy, and non-gating job list', () => {
        expect(() => assertJobGraph(workflow)).not.toThrow();
        const eventGatedDependencyReview = asRecord(
            structuredClone(workflow),
            'event-gated dependency review workflow'
        );
        jobAt(eventGatedDependencyReview, 'dependency-review').if = "github.event_name == 'pull_request'";
        expect(() => assertJobGraph(eventGatedDependencyReview)).toThrow(
            'dependency review must gate on the pull request payload rather than the triggering event'
        );
        const overGatedSummary = asRecord(structuredClone(workflow), 'over-gated summary workflow');
        arrayAt(jobAt(overGatedSummary, 'gate'), 'needs').push('unit');
        expect(() => assertJobGraph(overGatedSummary)).toThrow('unit is currently non-gating');
        const widenedSummary = asRecord(structuredClone(workflow), 'widened summary workflow');
        arrayAt(jobAt(widenedSummary, 'gate'), 'needs').push('e2e-report');
        expect(() => assertJobGraph(widenedSummary)).toThrow('gate must depend on exactly the pinned member list');
        const narrowedSummary = asRecord(structuredClone(workflow), 'narrowed summary workflow');
        const narrowedNeeds = arrayAt(jobAt(narrowedSummary, 'gate'), 'needs');
        narrowedNeeds.splice(narrowedNeeds.indexOf('smoke'), 1);
        expect(() => assertJobGraph(narrowedSummary)).toThrow('gate must depend on smoke');
        const disconnected = asRecord(structuredClone(workflow), 'disconnected security workflow');
        jobAt(disconnected, 'secrets').needs = 'build';
        expect(() => assertJobGraph(disconnected)).toThrow('security scans must depend directly on decide');
        const disconnectedUnit = asRecord(structuredClone(workflow), 'disconnected unit workflow');
        jobAt(disconnectedUnit, 'unit').needs = 'static';
        expect(() => assertJobGraph(disconnectedUnit)).toThrow(
            'unit must retain its current decide dependency and scope condition'
        );
        const ungatedE2eScope = asRecord(structuredClone(workflow), 'ungated e2e scope workflow');
        jobAt(ungatedE2eScope, 'e2e').if = "needs.decide.outputs.e2e == 'true'";
        expect(() => assertJobGraph(ungatedE2eScope)).toThrow(
            'e2e must retain its current decide dependency and scope condition'
        );
        const prematureUnitGate = asRecord(structuredClone(workflow), 'premature unit gate workflow');
        arrayAt(jobAt(prematureUnitGate, 'gate'), 'needs').push('unit');
        expect(() => assertJobGraph(prematureUnitGate)).toThrow('unit is currently non-gating');
        const prematureE2eGate = asRecord(structuredClone(workflow), 'premature e2e gate workflow');
        arrayAt(jobAt(prematureE2eGate, 'gate'), 'needs').push('e2e');
        expect(() => assertJobGraph(prematureE2eGate)).toThrow('e2e is currently non-gating');
    });

    it('fetches immutable measurement provenance history only in the unit matrix', () => {
        expect(() => assertUnitProvenanceHistory(workflow)).not.toThrow();

        const shallowUnit = asRecord(structuredClone(workflow), 'shallow unit workflow');
        delete recordAt(stepNamed(jobAt(shallowUnit, 'unit'), 'Checkout'), 'with')['fetch-depth'];
        expect(() => assertUnitProvenanceHistory(shallowUnit)).toThrow(
            'unit must retain complete history for immutable measurement provenance'
        );

        for (const jobName of ['lint', 'boundaries']) {
            const broadened = asRecord(structuredClone(workflow), `${jobName} full-history workflow`);
            stepNamed(jobAt(broadened, jobName), 'Checkout').with = { 'fetch-depth': 0 };
            expect(() => assertUnitProvenanceHistory(broadened)).toThrow(`${jobName} must not fetch complete history`);
        }
    });

    it('gates the dedicated Browser AI WebGPU proof on a standard macOS runner', async () => {
        expect(() => assertBrowserAiWebGpuJob(workflow)).not.toThrow();
        expect(() => assertBrowserAiWebGpuProofChain(packageManifest, browserAiWebGpuConfig)).not.toThrow();

        for (const runner of ['self-hosted', 'macos-14-large', 'macos-14-xlarge']) {
            const premiumRunner = asRecord(structuredClone(workflow), `${runner} Browser AI workflow`);
            jobAt(premiumRunner, BROWSER_AI_WEBGPU_JOB)['runs-on'] = runner;
            expect(() => assertBrowserAiWebGpuJob(premiumRunner)).toThrow(
                'Browser AI WebGPU job must use the standard macos-14 runner'
            );
        }

        const fastLane = asRecord(structuredClone(workflow), 'fast-lane Browser AI workflow');
        jobAt(fastLane, BROWSER_AI_WEBGPU_JOB).if = "needs.decide.outputs.e2e == 'true'";
        expect(() => assertBrowserAiWebGpuJob(fastLane)).toThrow(
            'Browser AI WebGPU job must retain its heavy E2E scope condition'
        );

        const defaultMatrix = asRecord(structuredClone(workflow), 'default-matrix Browser AI workflow');
        stepNamed(jobAt(defaultMatrix, BROWSER_AI_WEBGPU_JOB), 'Run Browser AI WebGPU admission').run =
            'pnpm test:e2e tests/e2e/browserAiWebGpuAdmission.spec.ts';
        expect(() => assertBrowserAiWebGpuJob(defaultMatrix)).toThrow(
            'Browser AI WebGPU job must run the dedicated hardware command'
        );

        const disconnectedGate = asRecord(structuredClone(workflow), 'disconnected Browser AI workflow');
        const gateNeeds = arrayAt(jobAt(disconnectedGate, 'gate'), 'needs');
        gateNeeds.splice(gateNeeds.indexOf(BROWSER_AI_WEBGPU_JOB), 1);
        expect(() => assertBrowserAiWebGpuJob(disconnectedGate)).toThrow(
            'gate must depend on the Browser AI WebGPU job'
        );

        const indirectPackageScript = asRecord(structuredClone(packageManifest), 'indirect package manifest');
        recordAt(indirectPackageScript, 'scripts')[BROWSER_AI_WEBGPU_SCRIPT_NAME] =
            'playwright test tests/e2e/browserAiWebGpuAdmission.spec.ts';
        expect(() => assertBrowserAiWebGpuProofChain(indirectPackageScript, browserAiWebGpuConfig)).toThrow(
            'Browser AI WebGPU package script must run the dedicated Playwright config'
        );

        const broadConfig = asRecord(structuredClone(browserAiWebGpuConfig), 'broad Browser AI config');
        broadConfig.testMatch = '*.spec.ts';
        expect(() => assertBrowserAiWebGpuProofChain(packageManifest, broadConfig)).toThrow(
            'Browser AI WebGPU config must match only the dedicated admission spec'
        );

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
        expect(runGateScript(gateScript, gateResults(workflow, 'success'))).toBe(0);
        expect(runGateScript(gateScript, gateResults(workflow, 'skipped'))).toBe(0);
        expect(runGateScript(gateScript, gateResults(workflow, 'failure'))).not.toBe(0);
        expect(runGateScript(gateScript, gateResults(workflow, 'cancelled'))).not.toBe(0);
        const renamedGate = asRecord(structuredClone(workflow), 'renamed gate workflow');
        jobAt(renamedGate, 'gate').name = 'Health summary';
        expect(() => assertGateContract(renamedGate)).toThrow('the Gate job must always report under its stable name');
    });

    it('runs a trusted, credentialless scanner over the untrusted target history', () => {
        expect(() => assertCredentiallessScanner(workflow)).not.toThrow();
        const targetControlledScanner = asRecord(structuredClone(workflow), 'target-controlled scanner workflow');
        recordAt(stepNamed(jobAt(targetControlledScanner, 'secrets'), 'Checkout trusted scanner'), 'with').ref =
            SCAN_TARGET_REF;
        expect(() => assertCredentiallessScanner(targetControlledScanner)).toThrow(
            'secret scanner must come from the trusted base and retain no credentials'
        );
        const tokenBearingScanner = asRecord(structuredClone(workflow), 'token-bearing scanner workflow');
        jobAt(tokenBearingScanner, 'secrets').env = { GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}' };
        expect(() => assertCredentiallessScanner(tokenBearingScanner)).toThrow(
            'secret scan job must not reference GitHub tokens or repository secrets'
        );
    });
});
