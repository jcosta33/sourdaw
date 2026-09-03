import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDocument } from 'yaml';

import {
    getBrowserAiWebGpuHardwareRequirement,
    probeBrowserWebGpuHardwareInPage,
    requireBrowserWebGpuHardware,
} from '../../tests/e2e/browserAiHardware';
import browserAiWebGpuAdmissionConfig from '../../tests/e2e/browserAiWebGpuAdmission.playwright.config';
import { assertDeployWebBuildRun, assertDeployWebJobNoVercelPull } from '../deployWebWorkflowContract';

type UnknownRecord = Record<string, unknown>;
type JobResult = 'cancelled' | 'failure' | 'skipped' | 'success';

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
    rust: '${{ steps.scope.outputs.rust }}',
    server: '${{ steps.scope.outputs.server }}',
    e2e: '${{ steps.scope.outputs.e2e }}',
    web: '${{ steps.scope.outputs.web }}',
    code: '${{ steps.scope.outputs.code }}',
};
const NIGHTLY_SCOPE_OUTPUT_REFERENCES = {
    heavy: HEAVY_OUTPUT_REFERENCE,
    ...SCOPE_OUTPUT_REFERENCES,
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
const NIGHTLY_CONCURRENCY_GROUP = 'nightly-${{ github.run_id }}';
const GATE_CONDITION = '${{ !cancelled() }}';
const GATE_SUMMARY_NAME = 'Gate';
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
// Exact, ordered, and length-checked. This leg is the only runner that reaches
// the admitted side of AI availability — the general matrix has no adapter — so
// a spec missing from this list has no runner that executes its admitted
// assertions, and a dropped entry retires that proof without failing anything.
const BROWSER_AI_WEBGPU_TEST_MATCH = ['browserAiWebGpuAdmission.spec.ts', 'browserAiAdmittedPresentation.spec.ts'];
const BROWSER_AI_WEBGPU_ORIGIN = 'http://localhost:5188';
const BROWSER_AI_WEBGPU_SERVER_COMMAND = 'pnpm dev --host 127.0.0.1 --port 5188 --strictPort';
// `webServer.url` answers on the HTML shell, long before Vite has compiled the
// SPA module graph, so without a warmup the first admission spec absorbs that
// cold compile inside its own first-paint bound and times out on cold runners.
const BROWSER_AI_WEBGPU_GLOBAL_SETUP = './firstPaintWarmup.ts';
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
    'native-parity',
] as const;
const NATIVE_PARITY_JOB = 'native-parity';
const NATIVE_PARITY_JOB_NAME = 'Native parity (macOS)';
const NATIVE_PARITY_RUNNER = 'macos-latest';
// Parity breaks from either side of the seam: the Rust renderer the addon
// exposes, or the TypeScript that produces the graph it renders.
const NATIVE_PARITY_CONDITION = "needs.decide.outputs.rust == 'true' || needs.decide.outputs.web == 'true'";
const NATIVE_PARITY_BUILD_STEP = 'Build the native addon';
const NATIVE_PARITY_ADDON_STEP = 'Require the built addon the parity specs probe for';
const NATIVE_PARITY_RUN_STEP = 'Run the addon parity specs';
const NATIVE_ADDON_BUILD_COMMAND = 'node scripts/buildNativeAddon.ts';
// The single path every addon-loading spec probes with `existsSync` to choose
// between running and skipping. Requiring it after the build is what turns the
// silent hosted skip this leg exists to end into a failure — so the presence
// step is executed below against a tree with and without this file, never read
// for a substring: a body that merely names the path and exits 0 reads exactly
// like a working guard.
const NATIVE_ADDON_ARTIFACT = 'crates/sourdaw-native/sourdaw-native.node';
// What makes a spec addon-loading. Discovered rather than listed: a fourth
// such spec added without this leg would otherwise skip on every hosted run
// forever, and a written list is exactly what nobody updates.
const NATIVE_ADDON_IMPORT = 'NATIVE_ADDON_FILE';
const CURRENT_NON_GATING_JOBS = ['unit'] as const;
const PULL_REQUEST_EXCLUDED_JOBS = [
    'e2e',
    'e2e-report',
    'browser-ai-webgpu',
    'codeql',
    'secrets',
    'deploy-web',
    'nightly-report',
] as const;
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
const VERCEL_CLI_STEPS = ['Deploy the prebuilt revision'] as const;
const VERCEL_PULL_STEP = 'Pull the production environment';
// Every leg a scheduled run performs. The train promotes a revision only once
// each of them has reported success on that same revision.
const DEPLOY_WEB_NEEDS = [
    'static',
    'lint',
    'boundaries',
    'unit',
    'build',
    'rust',
    'native-macos',
    'native-windows',
    'e2e',
    'browser-ai-webgpu',
    'codeql',
    'secrets',
] as const;
const DEPLOY_CREDENTIAL_REFERENCE = "${{ secrets.VERCEL_TOKEN != '' }}";
const DEPLOY_CREDENTIAL_CONDITION = "env.DEPLOY_CREDENTIAL_PRESENT == 'true'";
const DEPLOY_FRESH_REVISION_CONDITION = `${DEPLOY_CREDENTIAL_CONDITION} && steps.freshness.outputs.fresh == 'true'`;
const DEPLOY_CHANGED_REVISION_CONDITION = `${DEPLOY_FRESH_REVISION_CONDITION} && steps.production.outputs.deploy == 'true'`;
// Only the freshness check itself runs on credential presence alone; it decides
// for everything after it, and its output is empty when it never ran.
const DEPLOY_CREDENTIAL_GATED_STEPS = [DEPLOY_WEB_FRESHNESS_STEP] as const;
const PNPM_SETUP_STEP = 'Set up pnpm';
const NODE_SETUP_STEP = 'Set up Node';
const DEPLOY_FRESH_GATED_STEPS = [
    'Checkout the validated revision',
    'Enable Corepack',
    PNPM_SETUP_STEP,
    NODE_SETUP_STEP,
    'Resolve the current production revision',
] as const;
const DEPLOY_REVISION_GATED_STEPS = [
    'Install dependencies',
    'Link the Vercel CLI to the production project',
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
const CURRENT_NON_GATING_JOB_WIRING = {
    unit: { needs: 'decide', if: "needs.decide.outputs.web == 'true'" },
} satisfies Record<(typeof CURRENT_NON_GATING_JOBS)[number], Readonly<{ needs: string; if: string }>>;
const NIGHTLY_E2E_WIRING = {
    needs: 'decide',
    if: "needs.decide.outputs.heavy == 'true' && needs.decide.outputs.e2e == 'true'",
} as const;

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
const nightlySource = readFileSync(join(repositoryRoot, '.github/workflows/nightly.yml'), 'utf8');
const nightlyDocument = parseDocument(nightlySource);
if (nightlyDocument.errors.length > 0) {
    throw new Error(`nightly.yml is invalid YAML: ${nightlyDocument.errors.map((error) => error.message).join('; ')}`);
}
const nightly = asRecord(nightlyDocument.toJS(), 'nightly workflow');
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
    if (decide.if !== undefined) {
        throw new Error('decide must run on every pull_request');
    }
    const outputs = recordAt(decide, 'outputs');
    for (const [name, reference] of Object.entries(SCOPE_OUTPUT_REFERENCES)) {
        if (outputs[name] !== reference) {
            throw new Error(`decide ${name} output must expose steps.scope.outputs.${name}`);
        }
    }
    if (Object.hasOwn(outputs, 'heavy')) {
        throw new Error('the pull-request workflow must not mint a heavy scope');
    }
    const scope = stepNamed(decide, 'Resolve scope');
    if (scope.id !== 'scope') {
        throw new Error('Resolve scope must retain the scope step id');
    }
    return stringAt(scope, 'run');
}

function assertNightlyScopeContract(candidate: UnknownRecord): string {
    const decide = jobAt(candidate, 'decide');
    if (decide.if !== undefined) {
        throw new Error('nightly decide must run on every scheduled and dispatched run');
    }
    const outputs = recordAt(decide, 'outputs');
    for (const [name, reference] of Object.entries(NIGHTLY_SCOPE_OUTPUT_REFERENCES)) {
        if (outputs[name] !== reference) {
            throw new Error(`nightly decide ${name} output must expose steps.scope.outputs.${name}`);
        }
    }
    const scope = stepNamed(decide, 'Resolve scope');
    if (scope.id !== 'scope') {
        throw new Error('nightly Resolve scope must retain the scope step id');
    }
    return stringAt(scope, 'run');
}

function assertPullRequestWorkflowIsolation(candidate: UnknownRecord): void {
    const jobs = recordAt(candidate, 'jobs');
    for (const name of PULL_REQUEST_EXCLUDED_JOBS) {
        if (Object.hasOwn(jobs, name)) {
            throw new Error(`the pull-request workflow must not define ${name}`);
        }
    }
}

function nightlyJobCheckName(jobId: string, value: unknown): string {
    const job = asRecord(value, jobId);
    const name = job.name;
    if (typeof name === 'string') {
        return name;
    }
    return jobId;
}

function assertNightlyDoesNotMintGate(jobs: UnknownRecord): void {
    if (Object.hasOwn(jobs, 'gate')) {
        throw new Error('the nightly train must not mint Gate');
    }
    for (const [jobId, value] of Object.entries(jobs)) {
        if (nightlyJobCheckName(jobId, value) === GATE_SUMMARY_NAME) {
            throw new Error('the nightly train must not mint Gate');
        }
    }
}

function assertNightlyWorkflowIsolation(candidate: UnknownRecord): void {
    const jobs = recordAt(candidate, 'jobs');
    assertNightlyDoesNotMintGate(jobs);
    for (const name of ['e2e', 'browser-ai-webgpu', 'codeql', 'secrets', 'deploy-web', 'nightly-report']) {
        if (!Object.hasOwn(jobs, name)) {
            throw new Error(`nightly must define ${name}`);
        }
    }
}

function assertNightlyPermissions(candidate: UnknownRecord): void {
    const permissions = recordAt(candidate, 'permissions');
    if (permissions.contents !== 'read' || Object.keys(permissions).length !== 1) {
        throw new Error('nightly must grant only read access to contents');
    }
}

function assertNightlyConcurrencyContract(candidate: UnknownRecord): void {
    const concurrency = recordAt(candidate, 'concurrency');
    if (concurrency.group !== NIGHTLY_CONCURRENCY_GROUP) {
        throw new Error('nightly must isolate each run on its own run id');
    }
    if (concurrency['cancel-in-progress'] !== false) {
        throw new Error('nightly must not cancel an in-progress train');
    }
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

/**
 * Runs the addon-presence step's own script in an empty tree, with and without
 * the artifact every parity spec probes for. Absence must end the job: a guard
 * that cannot fail leaves the specs skipping on every hosted run while this
 * file stays green, which is the whole failure mode the step exists to close.
 */
function runAddonPresenceGuard(script: string, artifactPresent: boolean): number | null {
    const directory = mkdtempSync(join(tmpdir(), 'sourdaw-health-addon-'));
    try {
        if (artifactPresent) {
            const artifact = join(directory, NATIVE_ADDON_ARTIFACT);
            mkdirSync(dirname(artifact), { recursive: true });
            writeFileSync(artifact, '');
        }
        return spawnSync('bash', ['-c', script], {
            cwd: directory,
            encoding: 'utf8',
            env: { ...process.env },
            shell: false,
        }).status;
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

function addonLoadingSpecs(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            return addonLoadingSpecs(path);
        }
        if (!/\.spec\.tsx?$/u.test(entry.name) || !readFileSync(path, 'utf8').includes(NATIVE_ADDON_IMPORT)) {
            return [];
        }
        return [relative(repositoryRoot, path).split(sep).join('/')];
    });
}

function assertNativeParityJob(candidate: UnknownRecord): void {
    const job = jobAt(candidate, NATIVE_PARITY_JOB);
    if (job.name !== NATIVE_PARITY_JOB_NAME || job['runs-on'] !== NATIVE_PARITY_RUNNER) {
        throw new Error('native parity must run on the one platform the native crate compiles on');
    }
    if (job.needs !== 'decide' || job.if !== NATIVE_PARITY_CONDITION) {
        throw new Error('native parity must answer to both the Rust and the web scopes');
    }
    if (job['continue-on-error'] !== undefined) {
        throw new Error('native parity must not continue on error');
    }
    if (stringAt(stepNamed(job, NATIVE_PARITY_BUILD_STEP), 'run') !== NATIVE_ADDON_BUILD_COMMAND) {
        throw new Error('native parity must build the addon through the builder the desktop chain ships');
    }
    const presenceGuard = stringAt(stepNamed(job, NATIVE_PARITY_ADDON_STEP), 'run');
    if (runAddonPresenceGuard(presenceGuard, false) === 0) {
        throw new Error('native parity must fail a run whose addon the parity specs would not find');
    }
    if (runAddonPresenceGuard(presenceGuard, true) !== 0) {
        throw new Error('native parity must accept the addon its own builder produces');
    }
    const runStep = stepNamed(job, NATIVE_PARITY_RUN_STEP);
    if (runStep['continue-on-error'] !== undefined) {
        throw new Error('native parity must not continue on error');
    }
    const specs = addonLoadingSpecs(join(repositoryRoot, 'src'));
    // Without this the loop below is vacuous, and a discovery that stopped
    // finding anything would read as a leg with nothing left to prove.
    if (specs.length === 0) {
        throw new Error('no spec loads the native addon, so the parity leg proves nothing');
    }
    const command = stringAt(runStep, 'run');
    for (const spec of specs) {
        if (!command.includes(spec)) {
            throw new Error(`native parity must run ${spec}`);
        }
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

function assertNightlySecurityGraph(candidate: UnknownRecord): void {
    if (jobAt(candidate, 'codeql').if !== HEAVY_CONDITION || jobAt(candidate, 'secrets').if !== HEAVY_CONDITION) {
        throw new Error('security scans must consume the heavy scope output');
    }
    if (jobAt(candidate, 'codeql').needs !== 'decide' || jobAt(candidate, 'secrets').needs !== 'decide') {
        throw new Error('security scans must depend directly on decide');
    }
    const e2e = jobAt(candidate, 'e2e');
    if (e2e.needs !== NIGHTLY_E2E_WIRING.needs || e2e.if !== NIGHTLY_E2E_WIRING.if) {
        throw new Error('e2e must retain its current decide dependency and scope condition');
    }
    if (e2e['continue-on-error'] !== undefined) {
        throw new Error('nightly e2e must not continue on error');
    }
    const unit = jobAt(candidate, 'unit');
    if (unit['continue-on-error'] !== undefined) {
        throw new Error('nightly unit must not continue on error');
    }
    if (stepNamed(unit, 'Run shard')['continue-on-error'] !== undefined) {
        throw new Error('nightly unit Run shard must not continue on error');
    }
    if (stepNamed(e2e, 'Run shard')['continue-on-error'] !== undefined) {
        throw new Error('nightly e2e Run shard must not continue on error');
    }
}

function stepUsesPnpmCache(step: UnknownRecord): boolean {
    const setupOptions = step.with;
    if (setupOptions === undefined) {
        return false;
    }
    return recordAt(step, 'with').cache === 'pnpm';
}

function assertNightlyPnpmBeforeNodeOrder(candidate: UnknownRecord): void {
    for (const [jobId, jobValue] of Object.entries(recordAt(candidate, 'jobs'))) {
        const job = asRecord(jobValue, `${jobId} job`);
        const steps = arrayAt(job, 'steps');
        for (let index = 0; index < steps.length; index += 1) {
            const step = asRecord(steps[index], 'step');
            if (step.name !== NODE_SETUP_STEP || !stepUsesPnpmCache(step)) {
                continue;
            }
            if (index === 0) {
                throw new Error(
                    `${jobId} must run ${PNPM_SETUP_STEP} immediately before ${NODE_SETUP_STEP} when setup-node caches pnpm`
                );
            }
            const previous = asRecord(steps[index - 1], 'previous step');
            if (previous.name !== PNPM_SETUP_STEP) {
                throw new Error(
                    `${jobId} must run ${PNPM_SETUP_STEP} immediately before ${NODE_SETUP_STEP} when setup-node caches pnpm`
                );
            }
        }
    }
}

function removeStepNamed(job: UnknownRecord, name: string): void {
    const steps = arrayAt(job, 'steps');
    const index = steps.findIndex((candidate) => asRecord(candidate, 'step').name === name);
    if (index === -1) {
        throw new Error(`missing workflow step: ${name}`);
    }
    steps.splice(index, 1);
}

function swapStepsNamed(job: UnknownRecord, firstName: string, secondName: string): void {
    const steps = arrayAt(job, 'steps');
    const firstIndex = steps.findIndex((candidate) => asRecord(candidate, 'step').name === firstName);
    const secondIndex = steps.findIndex((candidate) => asRecord(candidate, 'step').name === secondName);
    if (firstIndex === -1 || secondIndex === -1) {
        throw new Error(`missing workflow steps to swap: ${firstName}, ${secondName}`);
    }
    const first = steps[firstIndex];
    steps[firstIndex] = steps[secondIndex];
    steps[secondIndex] = first;
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
    if (config.globalSetup !== BROWSER_AI_WEBGPU_GLOBAL_SETUP) {
        throw new Error('Browser AI WebGPU config must warm the cold first paint before its specs observe it');
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
    const buildStep = stepNamed(job, 'Build the validated revision');
    assertDeployWebBuildRun(stringAt(buildStep, 'run'));
    assertDeployWebJobNoVercelPull(arrayAt(job, 'steps'));
    if (buildStep.env !== undefined) {
        const buildEnv = recordAt(buildStep, 'env');
        if (
            buildEnv.VERCEL_TOKEN !== undefined ||
            buildEnv.VERCEL_ORG_ID !== undefined ||
            buildEnv.VERCEL_PROJECT_ID !== undefined
        ) {
            throw new Error('Build the validated revision must not set Vercel CLI credentials');
        }
    }
    for (const name of VERCEL_CLI_STEPS) {
        const env = recordAt(stepNamed(job, name), 'env');
        if (env.VERCEL_TOKEN !== VERCEL_TOKEN_REFERENCE) {
            throw new Error(`${name} must authenticate from the environment rather than an echoed argument`);
        }
        if (env.VERCEL_ORG_ID !== undefined) {
            throw new Error(`${name} must not pass VERCEL_ORG_ID to the CLI`);
        }
        if (env.VERCEL_PROJECT_ID !== undefined) {
            throw new Error(`${name} must not pass VERCEL_PROJECT_ID to the CLI`);
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
    assertNightlyDoesNotMintGate(recordAt(candidate, 'jobs'));
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

    it('parses and subscribes only to the intended events', () => {
        expect(workflowDocument.errors).toEqual([]);
        expect(nightlyDocument.errors).toEqual([]);
        const events = recordAt(workflow, 'on');
        expect(Object.keys(events).sort()).toEqual(['pull_request']);
        expect(() => assertWorkflowPermissions(workflow)).not.toThrow();
        expect(() => assertConcurrencyContract(workflow)).not.toThrow();
        expect(() => assertPullRequestWorkflowIsolation(workflow)).not.toThrow();

        const nightlyEvents = recordAt(nightly, 'on');
        expect(Object.keys(nightlyEvents).sort()).toEqual(['schedule', 'workflow_dispatch']);
        expect(nightly.name).toBe('Nightly');
        expect(() => assertNightlyPermissions(nightly)).not.toThrow();
        expect(() => assertNightlyConcurrencyContract(nightly)).not.toThrow();
        expect(() => assertNightlyWorkflowIsolation(nightly)).not.toThrow();

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

        const leakingDeploy = asRecord(structuredClone(workflow), 'leaking deploy workflow');
        recordAt(leakingDeploy, 'jobs')[DEPLOY_WEB_JOB] = jobAt(nightly, DEPLOY_WEB_JOB);
        expect(() => assertPullRequestWorkflowIsolation(leakingDeploy)).toThrow(
            'the pull-request workflow must not define deploy-web'
        );

        const mintingGate = asRecord(structuredClone(nightly), 'minting-gate nightly');
        recordAt(mintingGate, 'jobs').gate = jobAt(workflow, 'gate');
        expect(() => assertNightlyWorkflowIsolation(mintingGate)).toThrow('the nightly train must not mint Gate');

        const impostorGate = asRecord(structuredClone(nightly), 'impostor-gate nightly');
        recordAt(impostorGate, 'jobs')['fake-gate'] = { name: 'Gate', needs: ['decide'] };
        expect(() => assertNightlyWorkflowIsolation(impostorGate)).toThrow('the nightly train must not mint Gate');

        const namelessGateId = asRecord(structuredClone(nightly), 'nameless-gate-id nightly');
        recordAt(namelessGateId, 'jobs').Gate = { needs: ['decide'] };
        expect(() => assertNightlyWorkflowIsolation(namelessGateId)).toThrow('the nightly train must not mint Gate');

        const extraPullRequestTarget = asRecord(structuredClone(workflow), 'extra pull_request_target workflow');
        recordAt(extraPullRequestTarget, 'on').pull_request_target = {};
        expect(() => {
            expect(Object.keys(recordAt(extraPullRequestTarget, 'on')).sort()).toEqual(['pull_request']);
        }).toThrow();

        const extraPullRequestOnNightly = asRecord(structuredClone(nightly), 'extra pull_request nightly');
        recordAt(extraPullRequestOnNightly, 'on').pull_request = {};
        expect(() => {
            expect(Object.keys(recordAt(extraPullRequestOnNightly, 'on')).sort()).toEqual([
                'schedule',
                'workflow_dispatch',
            ]);
        }).toThrow();
    });

    it('rejects review-triggered cancellation and changing the pull-request grouping key', () => {
        const pausingPullRequest = asRecord(structuredClone(workflow), 'pausing pull-request workflow');
        recordAt(pausingPullRequest, 'concurrency')['cancel-in-progress'] = false;
        expect(() => assertConcurrencyContract(pausingPullRequest)).toThrow(
            'only a newer pull-request run may cancel in-progress work'
        );
        const splitPullRequest = asRecord(structuredClone(workflow), 'split pull-request workflow');
        recordAt(splitPullRequest, 'concurrency').group = 'health-gates-${{ github.run_id }}';
        expect(() => assertConcurrencyContract(splitPullRequest)).toThrow(
            'workflow must group runs by pull request or ref'
        );
        const cancellingNightly = asRecord(structuredClone(nightly), 'cancelling nightly workflow');
        recordAt(cancellingNightly, 'concurrency')['cancel-in-progress'] = true;
        expect(() => assertNightlyConcurrencyContract(cancellingNightly)).toThrow(
            'nightly must not cancel an in-progress train'
        );
    });

    it('runs the heavy security lane only on the nightly train', () => {
        const scopeScript = assertScopeContract(workflow);
        expect(runScopeScript(scopeScript, 'pull_request')).toEqual({
            rust: 'false',
            server: 'false',
            e2e: 'false',
            web: 'false',
            code: 'false',
        });
        const gatedDecide = asRecord(structuredClone(workflow), 'gated decide workflow');
        jobAt(gatedDecide, 'decide').if = "github.event_name != 'pull_request_review'";
        expect(() => assertScopeContract(gatedDecide)).toThrow('decide must run on every pull_request');
        const undisclosedWebScope = asRecord(structuredClone(workflow), 'undisclosed web scope workflow');
        recordAt(jobAt(undisclosedWebScope, 'decide'), 'outputs').web = HEAVY_OUTPUT_REFERENCE;
        expect(() => assertScopeContract(undisclosedWebScope)).toThrow(
            'decide web output must expose steps.scope.outputs.web'
        );
        const leakingHeavy = asRecord(structuredClone(workflow), 'leaking heavy workflow');
        recordAt(jobAt(leakingHeavy, 'decide'), 'outputs').heavy = HEAVY_OUTPUT_REFERENCE;
        expect(() => assertScopeContract(leakingHeavy)).toThrow(
            'the pull-request workflow must not mint a heavy scope'
        );

        const nightlyScope = assertNightlyScopeContract(nightly);
        expect(runScopeScript(nightlyScope, 'schedule')).toEqual(FORCED_SCOPE_OUTPUTS);
        expect(runScopeScript(nightlyScope, 'workflow_dispatch')).toEqual(FORCED_SCOPE_OUTPUTS);
        const gatedNightly = asRecord(structuredClone(nightly), 'gated nightly decide');
        jobAt(gatedNightly, 'decide').if = "github.event_name == 'schedule'";
        expect(() => assertNightlyScopeContract(gatedNightly)).toThrow(
            'nightly decide must run on every scheduled and dispatched run'
        );
    });

    it('treats an unclassified path as code-bearing and prose as nothing to check', () => {
        const scopeScript = assertScopeContract(workflow);
        expect(() => assertUnclassifiedFallback(workflow)).not.toThrow();
        expect(() => assertProseSkippingJobs(workflow)).not.toThrow();

        expect(runScopeScript(scopeScript, 'pull_request', { UNCLASSIFIED: 'true' })).toEqual({
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
        expect(() => assertNightlySecurityGraph(nightly)).not.toThrow();
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
        const disconnected = asRecord(structuredClone(nightly), 'disconnected security workflow');
        jobAt(disconnected, 'secrets').needs = 'build';
        expect(() => assertNightlySecurityGraph(disconnected)).toThrow('security scans must depend directly on decide');
        const disconnectedUnit = asRecord(structuredClone(workflow), 'disconnected unit workflow');
        jobAt(disconnectedUnit, 'unit').needs = 'static';
        expect(() => assertJobGraph(disconnectedUnit)).toThrow(
            'unit must retain its current decide dependency and scope condition'
        );
        const ungatedE2eScope = asRecord(structuredClone(nightly), 'ungated e2e scope workflow');
        jobAt(ungatedE2eScope, 'e2e').if = "needs.decide.outputs.e2e == 'true'";
        expect(() => assertNightlySecurityGraph(ungatedE2eScope)).toThrow(
            'e2e must retain its current decide dependency and scope condition'
        );
        const prematureUnitGate = asRecord(structuredClone(workflow), 'premature unit gate workflow');
        arrayAt(jobAt(prematureUnitGate, 'gate'), 'needs').push('unit');
        expect(() => assertJobGraph(prematureUnitGate)).toThrow('unit is currently non-gating');
        const permissiveNightlyUnit = asRecord(structuredClone(nightly), 'permissive nightly unit');
        stepNamed(jobAt(permissiveNightlyUnit, 'unit'), 'Run shard')['continue-on-error'] = true;
        expect(() => assertNightlySecurityGraph(permissiveNightlyUnit)).toThrow(
            'nightly unit Run shard must not continue on error'
        );
    });

    it('requires Set up pnpm immediately before Set up Node on every pnpm-cached nightly job', () => {
        expect(() => assertNightlyPnpmBeforeNodeOrder(nightly)).not.toThrow();

        const missingPnpmSetup = asRecord(structuredClone(nightly), 'missing pnpm setup nightly');
        removeStepNamed(jobAt(missingPnpmSetup, 'unit'), PNPM_SETUP_STEP);
        expect(() => assertNightlyPnpmBeforeNodeOrder(missingPnpmSetup)).toThrow(
            `unit must run ${PNPM_SETUP_STEP} immediately before ${NODE_SETUP_STEP} when setup-node caches pnpm`
        );

        const reversedSetup = asRecord(structuredClone(nightly), 'reversed pnpm setup nightly');
        swapStepsNamed(jobAt(reversedSetup, 'unit'), PNPM_SETUP_STEP, NODE_SETUP_STEP);
        expect(() => assertNightlyPnpmBeforeNodeOrder(reversedSetup)).toThrow(
            `unit must run ${PNPM_SETUP_STEP} immediately before ${NODE_SETUP_STEP} when setup-node caches pnpm`
        );

        const reversedDeploySetup = asRecord(structuredClone(nightly), 'reversed deploy pnpm setup nightly');
        swapStepsNamed(jobAt(reversedDeploySetup, DEPLOY_WEB_JOB), PNPM_SETUP_STEP, NODE_SETUP_STEP);
        expect(() => assertNightlyPnpmBeforeNodeOrder(reversedDeploySetup)).toThrow(
            `${DEPLOY_WEB_JOB} must run ${PNPM_SETUP_STEP} immediately before ${NODE_SETUP_STEP} when setup-node caches pnpm`
        );
    });

    it('builds the native addon and runs every spec that loads it, unsoftened', () => {
        expect(() => assertNativeParityJob(workflow)).not.toThrow();
        expect(addonLoadingSpecs(join(repositoryRoot, 'src'))).toContain(
            'src/modules/AudioEngine/useCases/livePlayback/__tests__/projectLiveGraphProgrammeParity.spec.ts'
        );

        const softenedJob = asRecord(structuredClone(workflow), 'softened native parity job');
        jobAt(softenedJob, NATIVE_PARITY_JOB)['continue-on-error'] = true;
        expect(() => assertNativeParityJob(softenedJob)).toThrow('native parity must not continue on error');

        const softenedRun = asRecord(structuredClone(workflow), 'softened native parity run');
        stepNamed(jobAt(softenedRun, NATIVE_PARITY_JOB), NATIVE_PARITY_RUN_STEP)['continue-on-error'] = true;
        expect(() => assertNativeParityJob(softenedRun)).toThrow('native parity must not continue on error');

        const forkedBuild = asRecord(structuredClone(workflow), 'forked native addon build');
        stepNamed(jobAt(forkedBuild, NATIVE_PARITY_JOB), NATIVE_PARITY_BUILD_STEP).run =
            'cargo build --release --package sourdaw-native --features napi-addon';
        expect(() => assertNativeParityJob(forkedBuild)).toThrow(
            'native parity must build the addon through the builder the desktop chain ships'
        );

        const narrowedScope = asRecord(structuredClone(workflow), 'narrowed native parity scope');
        jobAt(narrowedScope, NATIVE_PARITY_JOB).if = "needs.decide.outputs.rust == 'true'";
        expect(() => assertNativeParityJob(narrowedScope)).toThrow(
            'native parity must answer to both the Rust and the web scopes'
        );

        const droppedSpec = asRecord(structuredClone(workflow), 'dropped parity spec workflow');
        const runStep = stepNamed(jobAt(droppedSpec, NATIVE_PARITY_JOB), NATIVE_PARITY_RUN_STEP);
        const dropped = addonLoadingSpecs(join(repositoryRoot, 'src'))[0] ?? '';
        runStep.run = stringAt(runStep, 'run').replace(dropped, '');
        expect(() => assertNativeParityJob(droppedSpec)).toThrow(`native parity must run ${dropped}`);
    });

    it('refuses an addon presence guard that cannot fail', () => {
        // Executed, not read: each of these bodies names the artifact exactly as
        // the real step does, and each would let the parity specs skip on every
        // hosted run while a substring pin reported the leg intact.
        const namingGuard = asRecord(structuredClone(workflow), 'path-naming native parity guard');
        stepNamed(jobAt(namingGuard, NATIVE_PARITY_JOB), NATIVE_PARITY_ADDON_STEP).run =
            `echo ${NATIVE_ADDON_ARTIFACT}; true`;
        expect(() => assertNativeParityJob(namingGuard)).toThrow(
            'native parity must fail a run whose addon the parity specs would not find'
        );

        const misdirectedGuard = asRecord(structuredClone(workflow), 'misdirected native parity guard');
        stepNamed(jobAt(misdirectedGuard, NATIVE_PARITY_JOB), NATIVE_PARITY_ADDON_STEP).run =
            `test -f ${NATIVE_ADDON_ARTIFACT}.built`;
        expect(() => assertNativeParityJob(misdirectedGuard)).toThrow(
            'native parity must accept the addon its own builder produces'
        );
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

    it('gates the dedicated Browser AI WebGPU and admitted-presentation proofs on a standard macOS runner', async () => {
        expect(() => assertBrowserAiWebGpuJob(nightly)).not.toThrow();
        expect(() => assertBrowserAiWebGpuProofChain(packageManifest, browserAiWebGpuConfig)).not.toThrow();

        for (const runner of ['self-hosted', 'macos-14-large', 'macos-14-xlarge']) {
            const premiumRunner = asRecord(structuredClone(nightly), `${runner} Browser AI workflow`);
            jobAt(premiumRunner, BROWSER_AI_WEBGPU_JOB)['runs-on'] = runner;
            expect(() => assertBrowserAiWebGpuJob(premiumRunner)).toThrow(
                'Browser AI WebGPU job must use the standard macos-14 runner'
            );
        }

        const fastLane = asRecord(structuredClone(nightly), 'fast-lane Browser AI workflow');
        jobAt(fastLane, BROWSER_AI_WEBGPU_JOB).if = "needs.decide.outputs.e2e == 'true'";
        expect(() => assertBrowserAiWebGpuJob(fastLane)).toThrow(
            'Browser AI WebGPU job must retain its heavy E2E scope condition'
        );

        const defaultMatrix = asRecord(structuredClone(nightly), 'default-matrix Browser AI workflow');
        stepNamed(jobAt(defaultMatrix, BROWSER_AI_WEBGPU_JOB), 'Run Browser AI WebGPU admission').run =
            'pnpm test:e2e tests/e2e/browserAiWebGpuAdmission.spec.ts';
        expect(() => assertBrowserAiWebGpuJob(defaultMatrix)).toThrow(
            'Browser AI WebGPU job must run the dedicated hardware command'
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

        const coldFirstPaint = asRecord(structuredClone(browserAiWebGpuConfig), 'cold-first-paint Browser AI config');
        delete coldFirstPaint.globalSetup;
        expect(() => assertBrowserAiWebGpuProofChain(packageManifest, coldFirstPaint)).toThrow(
            'Browser AI WebGPU config must warm the cold first paint before its specs observe it'
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
        expect(() => assertCredentiallessScanner(nightly)).not.toThrow();
        const targetControlledScanner = asRecord(structuredClone(nightly), 'target-controlled scanner workflow');
        recordAt(stepNamed(jobAt(targetControlledScanner, 'secrets'), 'Checkout trusted scanner'), 'with').ref =
            SCAN_TARGET_REF;
        expect(() => assertCredentiallessScanner(targetControlledScanner)).toThrow(
            'secret scanner must come from the trusted base and retain no credentials'
        );
        const tokenBearingScanner = asRecord(structuredClone(nightly), 'token-bearing scanner workflow');
        jobAt(tokenBearingScanner, 'secrets').env = { GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}' };
        expect(() => assertCredentiallessScanner(tokenBearingScanner)).toThrow(
            'secret scan job must not reference GitHub tokens or repository secrets'
        );
    });

    it('promotes the validated revision daily, only with a credential and only when it changed', () => {
        expect(() => assertGitDeploymentsDisabled(vercelConfig)).not.toThrow();
        expect(() => assertCrossOriginIsolationHeaders(vercelConfig)).not.toThrow();
        const { validation: validationGuard, freshness: freshnessGuard } = assertDailyDeployTrain(nightly);

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
        expect(runResultsGuard(validationGuard, needsResults(nightly, DEPLOY_WEB_JOB, 'success'), onMain)).toBe(0);
        const degraded: JobResult[] = ['failure', 'cancelled', 'skipped'];
        for (const result of degraded) {
            expect(
                runResultsGuard(
                    validationGuard,
                    needsResults(nightly, DEPLOY_WEB_JOB, 'success', { e2e: result }),
                    onMain
                )
            ).not.toBe(0);
        }
        // The job condition already refuses a dispatch off main; this is the
        // half that still holds when somebody edits that condition.
        for (const ref of ['refs/heads/agent/2940/daily-train', 'refs/tags/v1.0.0', 'main']) {
            expect(
                runResultsGuard(validationGuard, needsResults(nightly, DEPLOY_WEB_JOB, 'success'), {
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

        const pullRequestTrain = asRecord(structuredClone(nightly), 'pull-request deploy train');
        jobAt(pullRequestTrain, DEPLOY_WEB_JOB).if = PULL_REQUEST_PAYLOAD_CONDITION;
        expect(() => assertDailyDeployTrain(pullRequestTrain)).toThrow(
            'the daily deploy train must run only on the schedule and a dispatch of main'
        );

        // A dispatch carries whichever ref was chosen, and every validation leg
        // would report honestly on it, so dropping this clause is what would
        // let an unmerged branch reach production.
        const anyBranchDispatch = asRecord(structuredClone(nightly), 'any-branch dispatch deploy train');
        jobAt(anyBranchDispatch, DEPLOY_WEB_JOB).if =
            "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'";
        expect(() => assertDailyDeployTrain(anyBranchDispatch)).toThrow(
            'the daily deploy train must run only on the schedule and a dispatch of main'
        );

        const unguardedRef = asRecord(structuredClone(nightly), 'unguarded-ref deploy train');
        delete recordAt(stepNamed(jobAt(unguardedRef, DEPLOY_WEB_JOB), DEPLOY_WEB_GUARD_STEP), 'env').TRAIN_REF;
        expect(() => assertDailyDeployTrain(unguardedRef)).toThrow(
            'the daily deploy train must read the ref it is about to deploy'
        );

        const racingTrain = asRecord(structuredClone(nightly), 'racing deploy train');
        delete jobAt(racingTrain, DEPLOY_WEB_JOB).concurrency;
        expect(() => assertDailyDeployTrain(racingTrain)).toThrow(
            'the daily deploy train must serialise itself against every other production deploy'
        );

        const cancellingTrain = asRecord(structuredClone(nightly), 'cancelling deploy train');
        recordAt(jobAt(cancellingTrain, DEPLOY_WEB_JOB), 'concurrency')['cancel-in-progress'] = true;
        expect(() => assertDailyDeployTrain(cancellingTrain)).toThrow(
            'the daily deploy train must queue behind a running deploy rather than cancel it'
        );

        const unauthenticatedDeploy = asRecord(structuredClone(nightly), 'unauthenticated deploy train');
        delete recordAt(stepNamed(jobAt(unauthenticatedDeploy, DEPLOY_WEB_JOB), 'Deploy the prebuilt revision'), 'env')
            .VERCEL_TOKEN;
        expect(() => assertDailyDeployTrain(unauthenticatedDeploy)).toThrow(
            'Deploy the prebuilt revision must authenticate from the environment rather than an echoed argument'
        );

        const envLinkedDeploy = asRecord(structuredClone(nightly), 'env-linked deploy train');
        recordAt(
            stepNamed(jobAt(envLinkedDeploy, DEPLOY_WEB_JOB), 'Deploy the prebuilt revision'),
            'env'
        ).VERCEL_ORG_ID = '${{ secrets.VERCEL_ORG_ID }}';
        expect(() => assertDailyDeployTrain(envLinkedDeploy)).toThrow(
            'Deploy the prebuilt revision must not pass VERCEL_ORG_ID to the CLI'
        );

        const vercelCliBuild = asRecord(structuredClone(nightly), 'vercel-cli build deploy train');
        const vercelCliBuildStep = stepNamed(jobAt(vercelCliBuild, DEPLOY_WEB_JOB), 'Build the validated revision');
        vercelCliBuildStep.run = `${stringAt(vercelCliBuildStep, 'run')}\npnpm dlx "$VERCEL_CLI" build`;
        expect(() => assertDailyDeployTrain(vercelCliBuild)).toThrow(
            'Build the validated revision must not invoke the Vercel CLI'
        );

        const vercelCliPull = asRecord(structuredClone(nightly), 'vercel-cli pull deploy train');
        arrayAt(jobAt(vercelCliPull, DEPLOY_WEB_JOB), 'steps').unshift({
            name: VERCEL_PULL_STEP,
            run: 'pnpm dlx "$VERCEL_CLI" pull --environment=production',
        });
        expect(() => assertDailyDeployTrain(vercelCliPull)).toThrow(
            'the daily deploy train must not pull the production environment through the Vercel CLI'
        );

        const echoOnlyBuild = asRecord(structuredClone(nightly), 'echo-only build deploy train');
        stepNamed(jobAt(echoOnlyBuild, DEPLOY_WEB_JOB), 'Build the validated revision').run =
            'set -euo pipefail\necho "pnpm build"\necho "node scripts/writeVercelPrebuiltOutput.ts"';
        expect(() => assertDailyDeployTrain(echoOnlyBuild)).toThrow(
            'Build the validated revision must execute pnpm build'
        );

        const pullOnLinkStep = asRecord(structuredClone(nightly), 'link-step pull deploy train');
        const linkStep = stepNamed(
            jobAt(pullOnLinkStep, DEPLOY_WEB_JOB),
            'Link the Vercel CLI to the production project'
        );
        linkStep.run = `${stringAt(linkStep, 'run')}\npnpm dlx "$VERCEL_CLI" pull --environment=production`;
        expect(() => assertDailyDeployTrain(pullOnLinkStep)).toThrow(
            'the daily deploy train must not pull the production environment through the Vercel CLI'
        );

        const reboundIsolation = asRecord(structuredClone(nightly), 'rebound-isolation deploy train');
        recordAt(
            stepNamed(jobAt(reboundIsolation, DEPLOY_WEB_JOB), 'Assert cross-origin isolation on the deployment'),
            'env'
        ).DEPLOYMENT_URL = 'https://sourdaw.vercel.app';
        expect(() => assertDailyDeployTrain(reboundIsolation)).toThrow(
            'the daily deploy train must read its headers back off the deployment it just created'
        );

        const unvalidatedTrain = asRecord(structuredClone(nightly), 'unvalidated deploy train');
        const trainNeeds = arrayAt(jobAt(unvalidatedTrain, DEPLOY_WEB_JOB), 'needs');
        trainNeeds.splice(trainNeeds.indexOf('codeql'), 1);
        expect(() => assertDailyDeployTrain(unvalidatedTrain)).toThrow('the daily deploy train must depend on codeql');

        const widenedTrain = asRecord(structuredClone(nightly), 'widened deploy train');
        arrayAt(jobAt(widenedTrain, DEPLOY_WEB_JOB), 'needs').push('smoke');
        expect(() => assertDailyDeployTrain(widenedTrain)).toThrow(
            'the daily deploy train must depend on exactly the scheduled validation legs'
        );

        const unscopedTrain = asRecord(structuredClone(nightly), 'unscoped deploy train');
        delete jobAt(unscopedTrain, DEPLOY_WEB_JOB).environment;
        expect(() => assertDailyDeployTrain(unscopedTrain)).toThrow(
            'the daily deploy train must draw its credential from the Production environment'
        );

        const ungatedTrain = asRecord(structuredClone(nightly), 'ungated deploy train');
        delete recordAt(jobAt(ungatedTrain, DEPLOY_WEB_JOB), 'env').DEPLOY_CREDENTIAL_PRESENT;
        expect(() => assertDailyDeployTrain(ungatedTrain)).toThrow(
            'the daily deploy train must resolve credential presence without exposing the token'
        );

        const credentiallessDeploy = asRecord(structuredClone(nightly), 'credentialless deploy train');
        stepNamed(jobAt(credentiallessDeploy, DEPLOY_WEB_JOB), DEPLOY_WEB_FRESHNESS_STEP).if =
            "github.event_name == 'schedule'";
        expect(() => assertDailyDeployTrain(credentiallessDeploy)).toThrow(
            `${DEPLOY_WEB_FRESHNESS_STEP} must not run without the deployment credential`
        );

        const unfreshResolver = asRecord(structuredClone(nightly), 'stale-tolerant deploy train');
        stepNamed(jobAt(unfreshResolver, DEPLOY_WEB_JOB), 'Resolve the current production revision').if =
            DEPLOY_CREDENTIAL_CONDITION;
        expect(() => assertDailyDeployTrain(unfreshResolver)).toThrow(
            'Resolve the current production revision must not run for a revision that is no longer the tip of main'
        );

        const untippedTrain = asRecord(structuredClone(nightly), 'untipped deploy train');
        const untippedStep = stepNamed(jobAt(untippedTrain, DEPLOY_WEB_JOB), DEPLOY_WEB_FRESHNESS_STEP);
        untippedStep.run = stringAt(untippedStep, 'run').replace(
            'git ls-remote "https://github.com/$GITHUB_REPOSITORY.git" refs/heads/main',
            'git rev-parse HEAD'
        );
        expect(() => assertDailyDeployTrain(untippedTrain)).toThrow(
            'the freshness check must read the current tip of main from the remote'
        );

        const uncomparedTip = asRecord(structuredClone(nightly), 'uncompared-tip deploy train');
        const uncomparedStep = stepNamed(jobAt(uncomparedTip, DEPLOY_WEB_JOB), DEPLOY_WEB_FRESHNESS_STEP);
        uncomparedStep.run = stringAt(uncomparedStep, 'run').replace('"$tip" != "$CANDIDATE_REVISION"', '1 -eq 2');
        expect(() => assertDailyDeployTrain(uncomparedTip)).toThrow(
            'the freshness check must compare the candidate against that tip'
        );

        // The structural pins above cannot see a stale path that still writes
        // `fresh=true`; running the script is what does.
        const alwaysFresh = stringAt(uncomparedStep, 'run');
        expect(runFreshnessGuard(alwaysFresh, candidate, newerTip).outputs).toContain('fresh=true');

        const halfArmedReport = asRecord(structuredClone(nightly), 'half-armed deploy train');
        const reportStep = stepNamed(jobAt(halfArmedReport, DEPLOY_WEB_JOB), DEPLOY_WEB_CREDENTIAL_REPORT_STEP);
        reportStep.run = stringAt(reportStep, 'run').replace('deployment branch policy limited to `main`', 'nothing');
        expect(() => assertDailyDeployTrain(halfArmedReport)).toThrow(
            'the gated-off report must name every arming precondition, including deployment branch policy limited to `main`'
        );

        const floatingCli = asRecord(structuredClone(nightly), 'floating-CLI deploy train');
        recordAt(jobAt(floatingCli, DEPLOY_WEB_JOB), 'env').VERCEL_CLI = 'vercel@latest';
        expect(() => assertDailyDeployTrain(floatingCli)).toThrow(
            'the daily deploy train must pin an exact Vercel CLI version'
        );

        const movingTarget = asRecord(structuredClone(nightly), 'moving-target deploy train');
        recordAt(stepNamed(jobAt(movingTarget, DEPLOY_WEB_JOB), 'Checkout the validated revision'), 'with').ref =
            '${{ github.ref }}';
        expect(() => assertDailyDeployTrain(movingTarget)).toThrow(
            'the daily deploy train must build the revision its validation legs reported on'
        );

        const duplicatingTrain = asRecord(structuredClone(nightly), 'duplicating deploy train');
        stepNamed(jobAt(duplicatingTrain, DEPLOY_WEB_JOB), 'Deploy the prebuilt revision').if =
            DEPLOY_CREDENTIAL_CONDITION;
        expect(() => assertDailyDeployTrain(duplicatingTrain)).toThrow(
            'Deploy the prebuilt revision must not run for a revision production already serves'
        );

        const anonymousDeploy = asRecord(structuredClone(nightly), 'anonymous deploy train');
        const deployStep = stepNamed(jobAt(anonymousDeploy, DEPLOY_WEB_JOB), 'Deploy the prebuilt revision');
        deployStep.run = stringAt(deployStep, 'run').replace('--meta githubCommitSha="$GITHUB_SHA"', '');
        expect(() => assertDailyDeployTrain(anonymousDeploy)).toThrow(
            'the daily deploy train must record the deployed revision on the deployment'
        );

        const unassertedIsolation = asRecord(structuredClone(nightly), 'unasserted-isolation deploy train');
        stepNamed(jobAt(unassertedIsolation, DEPLOY_WEB_JOB), 'Assert cross-origin isolation on the deployment').run =
            'curl --fail --silent --head "$DEPLOYMENT_URL"';
        expect(() => assertDailyDeployTrain(unassertedIsolation)).toThrow(
            'the daily deploy train must read the isolation headers back off the deployment'
        );

        const taggingTrain = asRecord(structuredClone(nightly), 'tagging deploy train');
        arrayAt(jobAt(taggingTrain, DEPLOY_WEB_JOB), 'steps').push({
            name: 'Tag the deployed revision',
            run: 'git tag "web-$GITHUB_SHA"',
        });
        expect(() => assertDailyDeployTrain(taggingTrain)).toThrow(
            'a daily web deployment must not carry a release side effect: git tag'
        );

        const gatingTrain = asRecord(structuredClone(nightly), 'gating deploy train');
        recordAt(gatingTrain, 'jobs').gate = { name: 'Gate', needs: [DEPLOY_WEB_JOB] };
        expect(() => assertDailyDeployTrain(gatingTrain)).toThrow('the nightly train must not mint Gate');
    });
});
