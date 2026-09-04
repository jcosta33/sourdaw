import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import {
    assertWorkflowFileInventory,
    assertWorkflowSnapshotMatch,
    HEALTH_GATE_WORKFLOW_FILES,
    JOB_LEVEL_PERMISSION_FREE_FILES,
    parseHealthGateWorkflows,
    readRecordedWorkflowSnapshot,
    SHARD_MATRIX_JOBS,
    STEP_INVENTORY,
} from '../healthGateWorkflowContract';

type UnknownRecord = Record<string, unknown>;
type JobResult = 'cancelled' | 'failure' | 'skipped' | 'success';

const REVIEW_CONDITION = "github.event_name != 'pull_request_review' || github.event.review.state == 'approved'";
const APPROVED_REVIEW_CONDITION = "github.event.review.state == 'approved'";
const HEAVY_OUTPUT_REFERENCE = '${{ steps.scope.outputs.heavy }}';
const HEAVY_CONDITION = "needs.validation.outputs.heavy == 'true'";
// An approved review of a fork pull request runs with a read-only
// GITHUB_TOKEN, and the code-scanning upload carve-out covers only the
// `pull_request` event, so the SARIF upload would be refused and fail the run
// on the head. The fork's code is scanned by the nightly once it merges.
const HEAVY_SARIF_CONDITION =
    "needs.validation.outputs.heavy == 'true' && github.event.pull_request.head.repo.full_name == github.repository";
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
const HEAVY_GATES_TRIGGERS = ['pull_request_review'] as const;
const NIGHTLY_TRIGGERS = ['schedule', 'workflow_dispatch'] as const;
const VALIDATION_TRIGGERS = ['workflow_call'] as const;
const VALIDATION_CALL = './.github/workflows/validation.yml';
const REQUIRED_CHECK_NAME = 'Gate';
const HEAVY_SUMMARY_NAME = 'HeavyGate';
const NIGHTLY_CRON = '0 3 * * *';
const NIGHTLY_CONCURRENCY_GROUP = 'nightly-${{ github.run_id }}';
const HEAVY_CONCURRENCY_GROUP =
    "heavy-gates-${{ (github.event_name == 'pull_request_review' && github.event.review.state == 'approved') && github.event.pull_request.number || github.run_id }}";
const NIGHTLY_HEAVY_CONDITION = "needs.decide.outputs.heavy == 'true'";
const NIGHTLY_E2E_WIRING = {
    needs: 'decide',
    if: "needs.decide.outputs.heavy == 'true' && needs.decide.outputs.e2e == 'true'",
} as const;
const NIGHTLY_BROWSER_AI_WEBGPU_CONDITION =
    "needs.decide.outputs.heavy == 'true' && needs.decide.outputs.e2e == 'true'";
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
const PNPM_SETUP_STEP = 'Set up pnpm';
const NODE_SETUP_STEP = 'Set up Node';
const PULL_REQUEST_EXCLUDED_JOBS = [
    'e2e',
    'e2e-report',
    'browser-ai-webgpu',
    'codeql',
    'secrets',
    'deploy-web',
    'nightly-report',
] as const;
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
const BROWSER_AI_WEBGPU_GLOBAL_SETUP = './firstPaintWarmup.ts';
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
    'native-parity',
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
const DEPLOY_WEB_RESOLVE_STEP = 'Resolve the current production revision';
const DEPLOY_WEB_CREDENTIAL_REPORT_STEP = 'Report the missing deployment credential';
const DEPLOY_WEB_SKIP_REPORT_STEP = 'Report why nothing was deployed';
// Arming the leg takes all four, and the fourth is the one a reader forgets.
const DEPLOY_ARMING_PRECONDITIONS = [
    'VERCEL_TOKEN',
    'VERCEL_ORG_ID',
    'VERCEL_PROJECT_ID',
    'deployment branch policy limited to `main`',
] as const;
const DEPLOYMENT_URL_REFERENCE = '${{ steps.deployment.outputs.url }}';
const VERCEL_TOKEN_REFERENCE = '${{ secrets.VERCEL_TOKEN }}';
const VERCEL_ORG_ID_REFERENCE = '${{ secrets.VERCEL_ORG_ID }}';
const VERCEL_PROJECT_ID_REFERENCE = '${{ secrets.VERCEL_PROJECT_ID }}';
const VERCEL_CLI_STEPS = ['Deploy the prebuilt revision'] as const;
const VERCEL_PULL_STEP = 'Pull the production environment';
const VERCEL_LINK_STEP = 'Link the Vercel CLI to the production project';
// Every leg that validates the web artifact. The Rust workspace leg is one
// of them: it is the only test of daw-dsp, daw-wasm-decoder, proof-chamber
// and scoring, which ship in the web bundle as the committed
// `public/wasm/*` packages. The native macOS and Windows legs validate the
// desktop shell instead, which this deployment does not ship, so their
// failures must not freeze it.
const DEPLOY_WEB_NEEDS = [
    'static',
    'lint',
    'boundaries',
    'unit',
    'build',
    'rust',
    'e2e',
    'browser-ai-webgpu',
    'codeql',
    'secrets',
] as const;
// Every leg a scheduled run performs, in the workflow's own order. The deploy
// deliberately does not wait for the native legs (DEPLOY_WEB_NEEDS), but the
// reporter observes the whole train: a native failure must still file the issue.
const NIGHTLY_REPORT_NEEDS = [
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
    DEPLOY_WEB_JOB,
] as const;
const DEPLOY_CREDENTIAL_REFERENCE = "${{ secrets.VERCEL_TOKEN != '' }}";
const DEPLOY_CREDENTIAL_CONDITION = "env.DEPLOY_CREDENTIAL_PRESENT == 'true'";
const DEPLOY_CHANGED_REVISION_CONDITION = `${DEPLOY_CREDENTIAL_CONDITION} && steps.production.outputs.deploy == 'true'`;
// Everything that reads or spends the deployment credential runs on its
// presence alone; the production-revision step decides for everything after
// it, and its `deploy` output is empty when it never ran.
const DEPLOY_CREDENTIAL_GATED_STEPS = [
    'Checkout the validated revision',
    'Enable Corepack',
    PNPM_SETUP_STEP,
    NODE_SETUP_STEP,
    DEPLOY_WEB_RESOLVE_STEP,
] as const;
const DEPLOY_REVISION_GATED_STEPS = [
    'Install dependencies',
    'Link the Vercel CLI to the production project',
    'Build the validated revision',
    'Deploy the prebuilt revision',
    'Assert cross-origin isolation on the deployment',
] as const;
const DEPLOY_ENVIRONMENT = { name: 'Production', url: DEPLOYMENT_URL_REFERENCE } as const;
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
// The four scope conditions no other pin reads. Each is the whole definition
// of when its job may legitimately skip: widening one runs the leg where it
// proves nothing, and narrowing or dropping one retires the proof while every
// other pin stays green.
const BUILD_CONDITION = "needs.decide.outputs.web == 'true'";
const RUST_CONDITION = "needs.decide.outputs.rust == 'true' || needs.decide.outputs.server == 'true'";
const NATIVE_MACOS_CONDITION = "needs.decide.outputs.rust == 'true'";
const NATIVE_WINDOWS_CONDITION = "needs.decide.outputs.rust == 'true'";
// The failed shard is already fatal, so these reporters are the one reason a
// step may carry a condition at all; `!cancelled()` replaces the implicit
// `success()` that would skip the annotation over the very failure it names.
const SHARD_FAILURE_REPORT_CONDITION = "${{ !cancelled() && steps.run_shard.outcome == 'failure' }}";
const E2E_BLOB_UPLOAD_CONDITION = '${{ !cancelled() }}';
const DEPLOY_MISSING_CREDENTIAL_REPORT_CONDITION = "env.DEPLOY_CREDENTIAL_PRESENT != 'true'";
const DEPLOY_SKIP_REPORT_CONDITION = `${DEPLOY_CREDENTIAL_CONDITION} && steps.production.outputs.deploy != 'true'`;
// Every step condition in the four workflows, keyed by file, job, and step
// name. A step condition is legitimate only when it is one of these exact,
// individually pinned exceptions — the shard-failure reporters, the blob
// uploads that must outlive their shard, and the deploy legs already pinned
// beside the job that owns them. An `if` anywhere else retires a proof by
// flipping the condition while every other pin stays green.
type ConditionalStepPin = Readonly<{ workflow: string; job: string; step: string; condition: string }>;
const CONDITIONAL_STEP_ALLOWLIST: readonly ConditionalStepPin[] = [
    {
        workflow: 'validation.yml',
        job: 'unit',
        step: 'Report shard failure',
        condition: SHARD_FAILURE_REPORT_CONDITION,
    },
    {
        workflow: 'heavy-gates.yml',
        job: 'e2e',
        step: 'Report shard failure',
        condition: SHARD_FAILURE_REPORT_CONDITION,
    },
    { workflow: 'heavy-gates.yml', job: 'e2e', step: 'Upload blob report', condition: E2E_BLOB_UPLOAD_CONDITION },
    { workflow: 'nightly.yml', job: 'unit', step: 'Report shard failure', condition: SHARD_FAILURE_REPORT_CONDITION },
    { workflow: 'nightly.yml', job: 'e2e', step: 'Report shard failure', condition: SHARD_FAILURE_REPORT_CONDITION },
    { workflow: 'nightly.yml', job: 'e2e', step: 'Upload blob report', condition: E2E_BLOB_UPLOAD_CONDITION },
    {
        workflow: 'nightly.yml',
        job: DEPLOY_WEB_JOB,
        step: DEPLOY_WEB_CREDENTIAL_REPORT_STEP,
        condition: DEPLOY_MISSING_CREDENTIAL_REPORT_CONDITION,
    },
    ...DEPLOY_CREDENTIAL_GATED_STEPS.map((step) => ({
        workflow: 'nightly.yml',
        job: DEPLOY_WEB_JOB,
        step,
        condition: DEPLOY_CREDENTIAL_CONDITION,
    })),
    {
        workflow: 'nightly.yml',
        job: DEPLOY_WEB_JOB,
        step: DEPLOY_WEB_SKIP_REPORT_STEP,
        condition: DEPLOY_SKIP_REPORT_CONDITION,
    },
    ...DEPLOY_REVISION_GATED_STEPS.map((step) => ({
        workflow: 'nightly.yml',
        job: DEPLOY_WEB_JOB,
        step,
        condition: DEPLOY_CHANGED_REVISION_CONDITION,
    })),
];
// A softened shard step reports a failing suite as a passing required check.
const SUITE_SHARD_STEP = 'Run shard';
// The census walks production sources once per train, outside the unit shards,
// so it never inherits their accumulated jsdom/module load debt. A softened
// census step reports green while the device-write-boundary proof decides nothing.
const DEVICE_WRITE_BOUNDARY_CENSUS_STEP = 'Device write boundary census';
const DEVICE_WRITE_BOUNDARY_CENSUS_RUN =
    'pnpm test:run src/modules/Arrangement/stores/__tests__/deviceWriteBoundaryClosure.spec.ts';

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
const { document: nightlyDocument, parsed: nightly } = loadWorkflow('nightly.yml');
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
    // The decide outputs reach callers only through the `workflow_call` export
    // list: deleting one leaves `needs.validation.outputs.<name>` empty while
    // every pin above stays green, which is how the approved-review heavy lane
    // could skip under a green HeavyGate. Pin the exact export set and each
    // forwarding value.
    const callerOutputs = recordAt(recordAt(recordAt(candidate, 'on'), 'workflow_call'), 'outputs');
    const exportedNames = Object.keys(callerOutputs).sort();
    if (JSON.stringify(exportedNames) !== JSON.stringify(Object.keys(SCOPE_OUTPUT_REFERENCES).sort())) {
        throw new Error('validation.yml must export exactly the six scope outputs to its callers');
    }
    for (const name of exportedNames) {
        if (recordAt(callerOutputs, name).value !== `\${{ jobs.decide.outputs.${name} }}`) {
            throw new Error(`the ${name} caller output must forward jobs.decide.outputs.${name}`);
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

function assertNightlyScopeContract(candidate: UnknownRecord): string {
    const decide = jobAt(candidate, 'decide');
    if (decide.if !== undefined) {
        throw new Error('nightly decide must run on every scheduled and dispatched run');
    }
    const outputs = recordAt(decide, 'outputs');
    for (const [name, reference] of Object.entries(SCOPE_OUTPUT_REFERENCES)) {
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

// The check-run name GitHub reports for a job: its declared `name`, or its job
// id when it declares none. Reading the id as the name is what keeps an
// unnamed `Gate`-keyed job from minting the required context undetected.
function jobCheckName(jobId: string, value: unknown): string {
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
        if (jobCheckName(jobId, value) === REQUIRED_CHECK_NAME) {
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

function assertHeavyConcurrencyContract(candidate: UnknownRecord): void {
    const concurrency = recordAt(candidate, 'concurrency');
    if (concurrency.group !== HEAVY_CONCURRENCY_GROUP) {
        throw new Error('the heavy lane must group approving reviews by pull request and everything else by run id');
    }
    if (concurrency['cancel-in-progress'] !== false) {
        throw new Error('the heavy lane must not cancel an in-progress run');
    }
}

// GitHub evaluates a job-level `concurrency` as its own group, independent of
// the workflow-level one: a constant group with `cancel-in-progress: true` on
// a matrix job would let queued shards cancel in-progress ones. The
// workflow-level group is the only serialization these files get. Nightly is
// swept with the rest; its deploy-web job is the single allowlisted exception,
// and that block stays pinned where it lives.
function assertNoJobLevelConcurrency(candidate: UnknownRecord, file: string, exemptJob?: string): void {
    for (const [id, job] of Object.entries(recordAt(candidate, 'jobs'))) {
        if (id === exemptJob) {
            continue;
        }
        if (asRecord(job, `${file} job ${id}`).concurrency !== undefined) {
            throw new Error(
                `${file} job ${id} must not carry job-level concurrency; the workflow-level group is the only serialization`
            );
        }
    }
}

function assertNightlySecurityGraph(candidate: UnknownRecord): void {
    if (
        jobAt(candidate, 'codeql').if !== NIGHTLY_HEAVY_CONDITION ||
        jobAt(candidate, 'secrets').if !== NIGHTLY_HEAVY_CONDITION
    ) {
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
    if (stepNamed(unit, SUITE_SHARD_STEP)['continue-on-error'] !== undefined) {
        throw new Error('nightly unit Run shard must not continue on error');
    }
    if (stepNamed(e2e, SUITE_SHARD_STEP)['continue-on-error'] !== undefined) {
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

function assertPnpmBeforeNodeOrder(candidate: UnknownRecord): void {
    for (const [jobId, jobValue] of Object.entries(recordAt(candidate, 'jobs'))) {
        const job = asRecord(jobValue, `${jobId} job`);
        const steps = job.steps === undefined ? [] : arrayAt(job, 'steps');
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
        throw new Error(`missing workflow step: ${firstIndex === -1 ? firstName : secondName}`);
    }
    [steps[firstIndex], steps[secondIndex]] = [steps[secondIndex], steps[firstIndex]];
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

type WorkflowSet = { health: UnknownRecord; validation: UnknownRecord; heavy: UnknownRecord; nightly: UnknownRecord };

function workflowSet(): WorkflowSet {
    return { health: workflow, validation: validationWorkflow, heavy: heavyWorkflow, nightly };
}

function cloneWorkflows(label: string): WorkflowSet {
    const clone = structuredClone(workflowSet());
    return {
        health: asRecord(clone.health, `${label} health`),
        validation: asRecord(clone.validation, `${label} validation`),
        heavy: asRecord(clone.heavy, `${label} heavy`),
        nightly: asRecord(clone.nightly, `${label} nightly`),
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

function workflowFiles(set: WorkflowSet): ReadonlyArray<readonly [string, UnknownRecord]> {
    return [
        ['health-gates.yml', set.health],
        ['validation.yml', set.validation],
        ['heavy-gates.yml', set.heavy],
        ['nightly.yml', set.nightly],
    ];
}

function jobSteps(file: string, jobId: string, job: UnknownRecord): UnknownRecord[] {
    return job.steps === undefined
        ? []
        : arrayAt(job, 'steps').map((step) => asRecord(step, `${file} job ${jobId} step`));
}

function stepLabel(file: string, jobId: string, step: UnknownRecord): string {
    const name = typeof step.name === 'string' ? step.name : '<unnamed>';
    return `${file} job ${jobId} step ${name}`;
}

// A `continue-on-error` on any job concludes it success whatever its steps
// proved, and one on any step reports that step green whatever it ran. The
// position-enumerated pins above each cover one named job or step; the sweep
// covers every job in every file, because a softened leg reports a failing
// proof as a passing summary wherever it lands.
function assertNoContinueOnError(set: WorkflowSet): void {
    for (const [file, candidate] of workflowFiles(set)) {
        for (const [jobId, jobValue] of Object.entries(recordAt(candidate, 'jobs'))) {
            const job = asRecord(jobValue, `${file} job ${jobId}`);
            if (job['continue-on-error'] !== undefined) {
                throw new Error(`${file} job ${jobId} must not continue on error`);
            }
            for (const step of jobSteps(file, jobId, job)) {
                if (step['continue-on-error'] !== undefined) {
                    throw new Error(`${stepLabel(file, jobId, step)} must not continue on error`);
                }
            }
        }
    }
}

// A step-level `if` can skip, and a skipped step fails nothing: the job then
// succeeds having never run the proof. Only the allowlisted reporters and
// deploy legs may carry one, each pinned to its exact condition; an allowlist
// entry that matches no live step is a condition nobody pins any more, so the
// sweep refuses that too rather than letting the list rot beside the file.
function assertUnconditionalSteps(set: WorkflowSet): void {
    const pinned = new Map(
        CONDITIONAL_STEP_ALLOWLIST.map((entry) => [`${entry.workflow}${entry.job}${entry.step}`, entry] as const)
    );
    const seen = new Set<string>();
    for (const [file, candidate] of workflowFiles(set)) {
        for (const [jobId, jobValue] of Object.entries(recordAt(candidate, 'jobs'))) {
            const job = asRecord(jobValue, `${file} job ${jobId}`);
            for (const step of jobSteps(file, jobId, job)) {
                if (step.if === undefined) {
                    continue;
                }
                const label = stepLabel(file, jobId, step);
                const pin = pinned.get(`${file}${jobId}${typeof step.name === 'string' ? step.name : ''}`);
                if (pin === undefined) {
                    throw new Error(`${label} must stay unconditional`);
                }
                if (step.if !== pin.condition) {
                    throw new Error(`${label} must retain its pinned condition`);
                }
                seen.add(`${pin.workflow}${pin.job}${pin.step}`);
            }
        }
    }
    for (const entry of CONDITIONAL_STEP_ALLOWLIST) {
        if (!seen.has(`${entry.workflow}${entry.job}${entry.step}`)) {
            throw new Error(`${entry.workflow} job ${entry.job} step ${entry.step} must carry its pinned condition`);
        }
    }
}

function workflowByFile(set: WorkflowSet, file: string): UnknownRecord {
    const entry = workflowFiles(set).find(([name]) => name === file);
    if (entry === undefined) {
        throw new Error(`${file} missing from the workflow set`);
    }
    return entry[1];
}

// A shrunk shard list still reports green: every shard that ran passed, and
// the dropped shards never ran at all. The unit suite decides the required
// Gate and the e2e suite decides HeavyGate, so both pin their full inventory.
function assertShardMatrices(set: WorkflowSet): void {
    for (const [file, jobId, shards] of SHARD_MATRIX_JOBS) {
        const matrix = recordAt(recordAt(jobAt(workflowByFile(set, file), jobId), 'strategy'), 'matrix');
        const actual = arrayAt(matrix, 'shard');
        if (actual.length !== shards.length || actual.some((shard, index) => shard !== shards[index])) {
            throw new Error(`${file} job ${jobId} must shard across exactly ${shards.join(', ')}`);
        }
    }
}

// A job-level `permissions` block reshapes one leg's token away from the
// workflow-level pin the permission assertions verify, and no pin read it:
// `contents: write` on a validation leg would hand every pull request a token
// that can push. The heavy and nightly files keep their own exact job-level
// pins (CodeQL, the nightly reporter); these two files must grant nothing.
function assertNoJobLevelPermissions(set: WorkflowSet): void {
    for (const file of JOB_LEVEL_PERMISSION_FREE_FILES) {
        for (const [jobId, jobValue] of Object.entries(recordAt(workflowByFile(set, file), 'jobs'))) {
            const job = asRecord(jobValue, `${file} job ${jobId}`);
            if (job.permissions !== undefined) {
                throw new Error(`${file} job ${jobId} must inherit the workflow-level permissions`);
            }
        }
    }
}

// A deleted step fails nothing: the job goes green having never run the
// proof, and step presence was the one dimension the named pins never
// enumerated. The inventory pins every job to its exact ordered step names
// and refuses jobs the inventory does not know, in both directions.
function assertStepInventory(set: WorkflowSet): void {
    for (const [file, candidate] of workflowFiles(set)) {
        const inventory = STEP_INVENTORY[file];
        if (inventory === undefined) {
            throw new Error(`${file} has no pinned step inventory`);
        }
        const jobs = recordAt(candidate, 'jobs');
        for (const jobId of Object.keys(jobs)) {
            if (!(jobId in inventory)) {
                throw new Error(`${file} job ${jobId} is not in the pinned step inventory`);
            }
        }
        for (const [jobId, expectedSteps] of Object.entries(inventory)) {
            const jobValue = jobs[jobId];
            if (jobValue === undefined) {
                throw new Error(`${file} job ${jobId} must exist`);
            }
            const job = asRecord(jobValue, `${file} job ${jobId}`);
            if (expectedSteps === null) {
                if (job.steps !== undefined) {
                    throw new Error(`${file} job ${jobId} must not declare steps`);
                }
                continue;
            }
            const actualSteps = jobSteps(file, jobId, job).map((step) => step.name);
            if (
                actualSteps.length !== expectedSteps.length ||
                actualSteps.some((name, index) => name !== expectedSteps[index])
            ) {
                throw new Error(`${file} job ${jobId} steps drifted from the pinned inventory`);
            }
        }
    }
}

// Runs the file-inventory assertion against a throwaway repository root whose
// .github/workflows holds exactly `files`, so the mutation-kills below
// exercise the real directory read rather than a stubbed listing.
function withWorkflowFiles(files: readonly string[]): () => void {
    return () => {
        const directory = mkdtempSync(join(tmpdir(), 'sourdaw-health-inventory-'));
        try {
            mkdirSync(join(directory, '.github/workflows'), { recursive: true });
            for (const file of files) {
                writeFileSync(join(directory, '.github/workflows', file), 'name: stub\n');
            }
            assertWorkflowFileInventory(readRecordedWorkflowSnapshot(repositoryRoot), directory);
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    };
}

// The SARIF upload is the only write this job needs: `contents: write` would
// hand a workflow that runs on review of foreign code a token that can push,
// and dropping `security-events: write` would fail the upload on the head.
function assertHeavyCodeQlPermissions(candidate: UnknownRecord): void {
    const permissions = recordAt(jobAt(candidate, 'codeql'), 'permissions');
    if (
        permissions.contents !== 'read' ||
        permissions['security-events'] !== 'write' ||
        permissions.actions !== 'read' ||
        Object.keys(permissions).length !== 3
    ) {
        throw new Error(
            'the heavy CodeQL job must grant exactly contents: read, security-events: write, and actions: read'
        );
    }
}

function assertValidationScopeConditions(candidate: UnknownRecord): void {
    if (jobAt(candidate, 'build').if !== BUILD_CONDITION) {
        throw new Error('the production build must answer to the web scope alone');
    }
    if (jobAt(candidate, 'rust').if !== RUST_CONDITION) {
        throw new Error('the Rust workspace leg must answer to the Rust and server scopes');
    }
    if (jobAt(candidate, 'native-macos').if !== NATIVE_MACOS_CONDITION) {
        throw new Error('the native macOS leg must answer to the Rust scope alone');
    }
    if (jobAt(candidate, 'native-windows').if !== NATIVE_WINDOWS_CONDITION) {
        throw new Error('the native Windows leg must answer to the Rust scope alone');
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
        ['nightly.yml', set.nightly],
    ] as const) {
        for (const [id, job] of Object.entries(recordAt(candidate, 'jobs'))) {
            if (jobCheckName(id, job) === REQUIRED_CHECK_NAME) {
                throw new Error(`${file} must not name a job ${REQUIRED_CHECK_NAME}`);
            }
        }
    }
    if (JSON.stringify(Object.keys(recordAt(set.heavy, 'on')).sort()) !== JSON.stringify([...HEAVY_GATES_TRIGGERS])) {
        throw new Error('the heavy workflow must own exactly the review event that health-gates.yml gave up');
    }
    if (JSON.stringify(Object.keys(recordAt(set.validation, 'on'))) !== JSON.stringify([...VALIDATION_TRIGGERS])) {
        throw new Error('validation.yml must be reusable-only');
    }
    if (JSON.stringify(Object.keys(recordAt(set.nightly, 'on')).sort()) !== JSON.stringify([...NIGHTLY_TRIGGERS])) {
        throw new Error('the nightly workflow must own exactly the schedule and dispatch events');
    }
    const schedule = arrayAt(recordAt(set.nightly, 'on'), 'schedule');
    if (asRecord(schedule[0], 'nightly cron').cron !== NIGHTLY_CRON) {
        throw new Error('the nightly cron must survive the move to nightly.yml');
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
    if (jobAt(set.heavy, 'codeql').if !== HEAVY_SARIF_CONDITION) {
        throw new Error(
            'the CodeQL upload must refuse fork pull requests, whose read-only token cannot write the SARIF result'
        );
    }
    if (jobAt(set.heavy, 'secrets').if !== HEAVY_CONDITION) {
        throw new Error('the secret scan must consume the heavy scope output');
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
    // Only an approved review may run the review lane: without the predicate
    // the caller still executes on a comment-only or changes-requested
    // submission, and every skipped leg inside it lands on the head as a
    // `Validation / …` check run beside the push lane's. The push lane's own
    // caller stays unconditional — it is the run that mints `Gate`.
    if (jobAt(set.heavy, 'validation').if !== APPROVED_REVIEW_CONDITION) {
        throw new Error('the heavy validation lane must refuse non-approved reviews, which may mint no green verdict');
    }
    if (jobAt(set.health, 'validation').if !== undefined) {
        throw new Error('the health validation lane must run on every pull request');
    }
    if (JSON.stringify(Object.keys(recordAt(set.validation, 'jobs'))) !== JSON.stringify([...VALIDATION_JOBS])) {
        throw new Error('validation.yml must hold exactly the pinned job list, in order');
    }
    assertBlockingSuites(set);
    assertNightlySecurityGraph(set.nightly);
    assertNightlyReportCoverage(set);
    assertDeviceWriteBoundaryCensus(set);
    assertSummaryMembership(set);
}

// Both trains run the census once, in their static contract job, and a
// `continue-on-error` on either step would report a failing census as a green
// step while the device-write-boundary proof stops deciding the merge. An
// `if` on either step retires the same proof more quietly: this spec is
// excluded from the sharded unit runs, so the static step is its only
// execution point, and a conditional census may never execute at all.
function assertDeviceWriteBoundaryCensus(set: WorkflowSet): void {
    const censusJobs: ReadonlyArray<readonly [string, UnknownRecord]> = [
        ['validation.yml static', jobAt(set.validation, 'static')],
        ['nightly.yml static', jobAt(set.nightly, 'static')],
    ];
    for (const [label, job] of censusJobs) {
        const step = stepNamed(job, DEVICE_WRITE_BOUNDARY_CENSUS_STEP);
        if (stringAt(step, 'run') !== DEVICE_WRITE_BOUNDARY_CENSUS_RUN) {
            throw new Error(`${label} must run the device write boundary census outside unit shards`);
        }
        if (step['continue-on-error'] !== undefined) {
            throw new Error(`${label} device write boundary census must not continue on error`);
        }
        if (step.if !== undefined) {
            throw new Error(`${label} device write boundary census must stay unconditional`);
        }
    }
}

// The nightly reporter is the only thing that observes what path filters and
// the approval gate skip, so a leg missing from its needs is a class of failure
// that reports nowhere a person looks.
function assertNightlyReportCoverage(set: WorkflowSet): void {
    const nightlyReport = jobAt(set.nightly, 'nightly-report');
    if (JSON.stringify(arrayAt(nightlyReport, 'needs')) !== JSON.stringify([...NIGHTLY_REPORT_NEEDS])) {
        throw new Error('the nightly reporter must depend on every leg a scheduled run performs');
    }
    if (nightlyReport.if !== "${{ failure() && github.event_name == 'schedule' }}") {
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

// The nightly runs the same hardware proof off its own decide job; its
// membership in the deploy train and the nightly report is pinned through
// those needs lists, so no summary-gate check belongs here.
function assertNightlyBrowserAiWebGpuJob(candidate: UnknownRecord): void {
    const job = jobAt(candidate, BROWSER_AI_WEBGPU_JOB);
    if (job.name !== BROWSER_AI_WEBGPU_JOB_NAME) {
        throw new Error('Browser AI WebGPU job must retain its stable name');
    }
    if (job.needs !== 'decide' || job.if !== NIGHTLY_BROWSER_AI_WEBGPU_CONDITION) {
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

function assertDailyDeployTrain(candidate: UnknownRecord): string {
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
    const environment = job.environment === undefined ? {} : recordAt(job, 'environment');
    if (environment.name !== DEPLOY_ENVIRONMENT.name || environment.url !== DEPLOY_ENVIRONMENT.url) {
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
    // The link step is the one place the org and project ids belong: `vercel link` reads them from
    // the environment, and a missing id links the deploy to whatever the token's default resolves to.
    const linkEnv = recordAt(stepNamed(job, VERCEL_LINK_STEP), 'env');
    for (const [key, reference] of [
        ['VERCEL_TOKEN', VERCEL_TOKEN_REFERENCE],
        ['VERCEL_ORG_ID', VERCEL_ORG_ID_REFERENCE],
        ['VERCEL_PROJECT_ID', VERCEL_PROJECT_ID_REFERENCE],
    ] as const) {
        if (linkEnv[key] !== reference) {
            throw new Error(`${VERCEL_LINK_STEP} must read ${key} from the environment`);
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
    const resolveStep = stepNamed(job, DEPLOY_WEB_RESOLVE_STEP);
    if (resolveStep.id !== 'production') {
        throw new Error('the daily deploy train must publish its production-revision decision under a stable step id');
    }
    const resolveEnv = recordAt(resolveStep, 'env');
    if (resolveEnv.CANDIDATE_REVISION !== '${{ github.sha }}') {
        throw new Error('the production-revision step must read the revision this run is about to deploy');
    }
    if (resolveEnv.GITHUB_TOKEN !== '${{ github.token }}') {
        throw new Error('the production-revision step must authenticate its ancestry comparison with a GitHub token');
    }
    if (
        resolveEnv.VERCEL_TOKEN !== VERCEL_TOKEN_REFERENCE ||
        resolveEnv.VERCEL_ORG_ID !== VERCEL_ORG_ID_REFERENCE ||
        resolveEnv.VERCEL_PROJECT_ID !== VERCEL_PROJECT_ID_REFERENCE
    ) {
        throw new Error('the production-revision step must authenticate its Vercel query from the environment');
    }
    if (stringAt(resolveStep, 'run') !== 'node scripts/resolveVercelProductionDeployment.ts') {
        throw new Error('the daily deploy train must decide through scripts/resolveVercelProductionDeployment.ts');
    }
    const skipReportStep = stepNamed(job, DEPLOY_WEB_SKIP_REPORT_STEP);
    if (skipReportStep.if !== `${DEPLOY_CREDENTIAL_CONDITION} && steps.production.outputs.deploy != 'true'`) {
        throw new Error(
            'the daily deploy train must report why nothing was deployed only when credentialed but not deploying'
        );
    }
    const skipReportEnv = skipReportStep.env === undefined ? {} : recordAt(skipReportStep, 'env');
    if (skipReportEnv.REASON !== '${{ steps.production.outputs.reason }}') {
        throw new Error('the skip report must read the decision reason the production-revision step published');
    }
    return stringAt(guardStep, 'run');
}

// Promotion is not validation. It must not be able to fail either summary, and
// the required `Gate` lives in another workflow entirely now.
function assertDeployOutsideSummaries(set: WorkflowSet): void {
    if (arrayAt(jobAt(set.heavy, 'heavy-gate'), 'needs').includes(DEPLOY_WEB_JOB)) {
        throw new Error('the daily deploy train must stay outside the heavy summary');
    }
    if (arrayAt(jobAt(set.health, 'gate'), 'needs').includes(DEPLOY_WEB_JOB)) {
        throw new Error('the daily deploy train must stay outside the required Gate');
    }
}

function assertGateContract(candidate: UnknownRecord, jobId: string, expectedName: string, expectedIf: string): string {
    const gate = jobAt(candidate, jobId);
    if (gate.name !== expectedName || gate.if !== expectedIf) {
        throw new Error(`the ${expectedName} job must always report under its stable name`);
    }
    // Job-level `continue-on-error` concludes the required check success over
    // red needs: GitHub reports the job successful whatever the guard ran.
    if (gate['continue-on-error'] !== undefined) {
        throw new Error(`the ${expectedName} job must not continue on error`);
    }
    const step = stepNamed(gate, 'Require every job to have succeeded or been skipped');
    // A conditional guard step can skip, and a skipped step fails nothing:
    // the summary job then succeeds unconditionally.
    if (step.if !== undefined) {
        throw new Error(`the ${jobId} guard step must stay unconditional`);
    }
    if (recordAt(step, 'env').RESULTS !== '${{ toJSON(needs) }}') {
        throw new Error(`${jobId} must receive all dependency results through its environment`);
    }
    const script = stringAt(step, 'run');
    if (!script.includes('.value.result != "success" and .value.result != "skipped"')) {
        throw new Error(`${jobId} must reject every result other than success or skipped`);
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
        expect(nightlyDocument.errors).toEqual([]);
        expect(Object.keys(recordAt(workflow, 'on'))).toEqual([...HEALTH_GATES_TRIGGERS]);
        expect(Object.keys(recordAt(heavyWorkflow, 'on')).sort()).toEqual([...HEAVY_GATES_TRIGGERS]);
        expect(Object.keys(recordAt(validationWorkflow, 'on'))).toEqual([...VALIDATION_TRIGGERS]);
        expect(Object.keys(recordAt(nightly, 'on')).sort()).toEqual([...NIGHTLY_TRIGGERS]);
        expect(recordAt(recordAt(heavyWorkflow, 'on'), 'pull_request_review').types).toEqual(['submitted']);
        expect(nightly.name).toBe('Nightly');
        expect(() => assertRequiredCheckIsolation(workflowSet())).not.toThrow();
        expect(() => assertPullRequestWorkflowIsolation(workflow)).not.toThrow();
        expect(() => assertNightlyWorkflowIsolation(nightly)).not.toThrow();
        expect(() => assertNightlyPermissions(nightly)).not.toThrow();
        expect(() => assertNightlyConcurrencyContract(nightly)).not.toThrow();

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
        arrayAt(recordAt(strandedCron.nightly, 'on'), 'schedule')[0] = { cron: '0 4 * * *' };
        expect(() => assertRequiredCheckIsolation(strandedCron)).toThrow(
            'the nightly cron must survive the move to nightly.yml'
        );

        const shadowedNightlyGate = cloneWorkflows('shadowed nightly gate');
        jobAt(shadowedNightlyGate.nightly, 'secrets').name = REQUIRED_CHECK_NAME;
        expect(() => assertRequiredCheckIsolation(shadowedNightlyGate)).toThrow('nightly.yml must not name a job Gate');

        const scheduleInHeavy = cloneWorkflows('schedule in heavy');
        recordAt(scheduleInHeavy.heavy, 'on').schedule = [{ cron: NIGHTLY_CRON }];
        expect(() => assertRequiredCheckIsolation(scheduleInHeavy)).toThrow(
            'the heavy workflow must own exactly the review event that health-gates.yml gave up'
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

        // GitHub names an unnamed job's check run after its job id, so an
        // unnamed `Gate`-keyed job mints the required context exactly as a
        // `name: Gate` declaration would. The isolation sweep must read the id
        // as the name in every file, not only in nightly.yml.
        const namelessGateIdInHeavy = cloneWorkflows('nameless-gate-id heavy');
        recordAt(namelessGateIdInHeavy.heavy, 'jobs').Gate = { needs: ['validation'] };
        expect(() => assertRequiredCheckIsolation(namelessGateIdInHeavy)).toThrow(
            'heavy-gates.yml must not name a job Gate'
        );

        const namelessGateIdInValidation = cloneWorkflows('nameless-gate-id validation');
        recordAt(namelessGateIdInValidation.validation, 'jobs').Gate = { needs: ['decide'] };
        expect(() => assertRequiredCheckIsolation(namelessGateIdInValidation)).toThrow(
            'validation.yml must not name a job Gate'
        );

        const droppedNightlyLeg = asRecord(structuredClone(nightly), 'dropped-leg nightly');
        delete recordAt(droppedNightlyLeg, 'jobs')['nightly-report'];
        expect(() => assertNightlyWorkflowIsolation(droppedNightlyLeg)).toThrow('nightly must define nightly-report');

        // The `reviewTriggered` probe above already routes an extra health-gates
        // trigger through the same on-keys equality this block asserted inline,
        // so a second unrouted `pull_request_target` mutant would pin nothing.
        // The nightly trigger set has no such routed probe: this one exercises
        // the production pin rather than restating it inline.
        const extraPullRequestOnNightly = cloneWorkflows('extra pull_request nightly');
        recordAt(extraPullRequestOnNightly.nightly, 'on').pull_request = {};
        expect(() => assertRequiredCheckIsolation(extraPullRequestOnNightly)).toThrow(
            'the nightly workflow must own exactly the schedule and dispatch events'
        );

        expect(() => assertWorkflowPermissions(workflow)).not.toThrow();
        expect(() => assertWorkflowPermissions(validationWorkflow)).not.toThrow();
        expect(() => assertWorkflowPermissions(heavyWorkflow)).not.toThrow();
        expect(() => assertConcurrencyContract(workflow)).not.toThrow();
        expect(() => assertHeavyConcurrencyContract(heavyWorkflow)).not.toThrow();
        expect(() => assertNoJobLevelConcurrency(workflow, 'health-gates.yml')).not.toThrow();
        expect(() => assertNoJobLevelConcurrency(validationWorkflow, 'validation.yml')).not.toThrow();
        expect(() => assertNoJobLevelConcurrency(heavyWorkflow, 'heavy-gates.yml')).not.toThrow();
        expect(() => assertNoJobLevelConcurrency(nightly, 'nightly.yml', DEPLOY_WEB_JOB)).not.toThrow();

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
        const pausingPullRequest = asRecord(structuredClone(workflow), 'pausing pull-request workflow');
        recordAt(pausingPullRequest, 'concurrency')['cancel-in-progress'] = false;
        expect(() => assertConcurrencyContract(pausingPullRequest)).toThrow(
            'only a newer pull-request run may cancel in-progress work'
        );
        const cancellingNightly = asRecord(structuredClone(nightly), 'cancelling nightly workflow');
        recordAt(cancellingNightly, 'concurrency')['cancel-in-progress'] = true;
        expect(() => assertNightlyConcurrencyContract(cancellingNightly)).toThrow(
            'nightly must not cancel an in-progress train'
        );
        // Flattening the group to a bare run id isolates every approving
        // review onto its own group, so two approvals on one pull request run
        // the heavy lane concurrently instead of serially.
        const flattenedHeavy = asRecord(structuredClone(heavyWorkflow), 'flattened heavy group heavyWorkflow');
        recordAt(flattenedHeavy, 'concurrency').group = 'heavy-gates-${{ github.run_id }}';
        expect(() => assertHeavyConcurrencyContract(flattenedHeavy)).toThrow(
            'the heavy lane must group approving reviews by pull request and everything else by run id'
        );
        // A constant job-level group with cancellation on the e2e matrix would
        // let queued shards cancel the in-progress ones: GitHub evaluates a
        // job-level `concurrency` as its own group, independent of the
        // workflow-level one this lane serializes on.
        const shardCancelling = asRecord(structuredClone(heavyWorkflow), 'shard-cancelling heavyWorkflow');
        jobAt(shardCancelling, 'e2e').concurrency = { group: 'e2e-shards', 'cancel-in-progress': true };
        expect(() => assertNoJobLevelConcurrency(shardCancelling, 'heavy-gates.yml')).toThrow(
            'heavy-gates.yml job e2e must not carry job-level concurrency'
        );
        // The nightly e2e matrix carries the same shard-cancellation hazard.
        // Only deploy-web is allowlisted, so a job-level group anywhere else
        // in nightly must trip the sweep.
        const shardCancellingNightly = asRecord(structuredClone(nightly), 'shard-cancelling nightly');
        jobAt(shardCancellingNightly, 'e2e').concurrency = { group: 'e2e-shards', 'cancel-in-progress': true };
        expect(() => assertNoJobLevelConcurrency(shardCancellingNightly, 'nightly.yml', DEPLOY_WEB_JOB)).toThrow(
            'nightly.yml job e2e must not carry job-level concurrency'
        );
    });

    it('runs the heavy security lane only for approved reviews, and the full train on the nightly', () => {
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
        const nightlyScope = assertNightlyScopeContract(nightly);
        expect(runScopeScript(nightlyScope, 'schedule')).toEqual(FORCED_SCOPE_OUTPUTS);
        expect(runScopeScript(nightlyScope, 'workflow_dispatch')).toEqual(FORCED_SCOPE_OUTPUTS);
        const gatedNightly = asRecord(structuredClone(nightly), 'gated nightly decide');
        jobAt(gatedNightly, 'decide').if = "github.event_name == 'schedule'";
        expect(() => assertNightlyScopeContract(gatedNightly)).toThrow(
            'nightly decide must run on every scheduled and dispatched run'
        );
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
        // Deleting the `heavy` export leaves `needs.validation.outputs.heavy`
        // empty, so the whole approved-review heavy lane skips while HeavyGate
        // still reports green: the export list is part of the contract.
        const unexportedHeavy = asRecord(structuredClone(validationWorkflow), 'unexported heavy validationWorkflow');
        delete recordAt(recordAt(recordAt(unexportedHeavy, 'on'), 'workflow_call'), 'outputs').heavy;
        expect(() => assertScopeContract(unexportedHeavy)).toThrow(
            'validation.yml must export exactly the six scope outputs to its callers'
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
        const nightlyNeeds = arrayAt(jobAt(blindNightly.nightly, 'nightly-report'), 'needs');
        nightlyNeeds.splice(nightlyNeeds.indexOf('unit'), 1);
        expect(() => assertJobGraph(blindNightly)).toThrow(
            'the nightly reporter must depend on every leg a scheduled run performs'
        );

        const disconnectedNightly = cloneWorkflows('disconnected nightly security');
        jobAt(disconnectedNightly.nightly, 'secrets').needs = 'build';
        expect(() => assertJobGraph(disconnectedNightly)).toThrow('security scans must depend directly on decide');

        const ungatedNightlyE2eScope = cloneWorkflows('ungated nightly e2e scope');
        jobAt(ungatedNightlyE2eScope.nightly, 'e2e').if = "needs.decide.outputs.e2e == 'true'";
        expect(() => assertJobGraph(ungatedNightlyE2eScope)).toThrow(
            'e2e must retain its current decide dependency and scope condition'
        );

        const permissiveNightlyUnit = cloneWorkflows('permissive nightly unit');
        stepNamed(jobAt(permissiveNightlyUnit.nightly, 'unit'), SUITE_SHARD_STEP)['continue-on-error'] = true;
        expect(() => assertJobGraph(permissiveNightlyUnit)).toThrow(
            'nightly unit Run shard must not continue on error'
        );

        // Mutation-kill: a census that may fail softly still reports a green
        // step while the device-write-boundary proof decides nothing.
        const softenedCensus = cloneWorkflows('softened device census');
        stepNamed(jobAt(softenedCensus.validation, 'static'), DEVICE_WRITE_BOUNDARY_CENSUS_STEP)['continue-on-error'] =
            true;
        expect(() => assertJobGraph(softenedCensus)).toThrow(
            'validation.yml static device write boundary census must not continue on error'
        );

        // Mutation-kill: a census behind a condition can be retired by
        // flipping that condition, while every other pin here stays green.
        const conditionalCensus = cloneWorkflows('conditional device census');
        stepNamed(jobAt(conditionalCensus.validation, 'static'), DEVICE_WRITE_BOUNDARY_CENSUS_STEP).if = false;
        expect(() => assertJobGraph(conditionalCensus)).toThrow(
            'validation.yml static device write boundary census must stay unconditional'
        );

        const widenedSummary = cloneWorkflows('widened summary');
        arrayAt(jobAt(widenedSummary.health, 'gate'), 'needs').push('nightly-report');
        expect(() => assertJobGraph(widenedSummary)).toThrow('gate must depend on exactly the pinned member list');

        const ungatedValidation = cloneWorkflows('ungated validation');
        const ungatedNeeds = arrayAt(jobAt(ungatedValidation.health, 'gate'), 'needs');
        ungatedNeeds.splice(ungatedNeeds.indexOf('validation'), 1);
        expect(() => assertJobGraph(ungatedValidation)).toThrow('gate must depend on validation');

        // A review that does not approve may mint no green verdict: drop the
        // predicate and the reusable lane runs on every submission, landing
        // its skipped legs on the head as `Validation / …` check runs.
        const ungatedReviewLane = cloneWorkflows('ungated review lane');
        delete jobAt(ungatedReviewLane.heavy, 'validation').if;
        expect(() => assertJobGraph(ungatedReviewLane)).toThrow(
            'the heavy validation lane must refuse non-approved reviews, which may mint no green verdict'
        );

        // A fork's approved review runs with a read-only token, so a CodeQL
        // job gated only on scope would fail its SARIF upload on the head.
        const forkBlindCodeql = cloneWorkflows('fork-blind codeql');
        jobAt(forkBlindCodeql.heavy, 'codeql').if = HEAVY_CONDITION;
        expect(() => assertJobGraph(forkBlindCodeql)).toThrow(
            'the CodeQL upload must refuse fork pull requests, whose read-only token cannot write the SARIF result'
        );

        const gatedPushLane = cloneWorkflows('gated push lane');
        jobAt(gatedPushLane.health, 'validation').if = APPROVED_REVIEW_CONDITION;
        expect(() => assertJobGraph(gatedPushLane)).toThrow(
            'the health validation lane must run on every pull request'
        );

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

    it('sweeps every job and step for softening, with only the pinned conditional steps', () => {
        expect(() => assertNoContinueOnError(workflowSet())).not.toThrow();
        expect(() => assertUnconditionalSteps(workflowSet())).not.toThrow();
        expect(() => assertValidationScopeConditions(validationWorkflow)).not.toThrow();
        expect(() => assertHeavyCodeQlPermissions(heavyWorkflow)).not.toThrow();

        // Mutation-kill: a job-level softening anywhere reports that leg green
        // whatever it proved — the review-found hole, on the lint job.
        const softenedLint = cloneWorkflows('softened lint job');
        jobAt(softenedLint.validation, 'lint')['continue-on-error'] = true;
        expect(() => assertNoContinueOnError(softenedLint)).toThrow(
            'validation.yml job lint must not continue on error'
        );

        // Mutation-kill: the same softening one level down, on a step the
        // position-enumerated pins never named.
        const softenedLintStep = cloneWorkflows('softened lint step');
        stepNamed(jobAt(softenedLintStep.validation, 'lint'), 'Lint')['continue-on-error'] = true;
        expect(() => assertNoContinueOnError(softenedLintStep)).toThrow(
            'validation.yml job lint step Lint must not continue on error'
        );

        // Mutation-kill: a conditional Run shard step can skip, and a skipped
        // step fails nothing — the second review-found hole.
        const gatedShard = cloneWorkflows('gated unit shard step');
        stepNamed(jobAt(gatedShard.validation, 'unit'), SUITE_SHARD_STEP).if = 'false';
        expect(() => assertUnconditionalSteps(gatedShard)).toThrow(
            'validation.yml job unit step Run shard must stay unconditional'
        );

        // Mutation-kill: an added condition on a step that must always run.
        const gatedLintStep = cloneWorkflows('gated lint step');
        stepNamed(jobAt(gatedLintStep.validation, 'lint'), 'Lint').if = CODE_CONDITION;
        expect(() => assertUnconditionalSteps(gatedLintStep)).toThrow(
            'validation.yml job lint step Lint must stay unconditional'
        );

        // Mutation-kill: an allowlisted reporter whose condition drifts from
        // its pin is the same hole wearing an allowlisted name.
        const widenedShardReport = cloneWorkflows('widened shard report condition');
        stepNamed(jobAt(widenedShardReport.validation, 'unit'), 'Report shard failure').if = E2E_BLOB_UPLOAD_CONDITION;
        expect(() => assertUnconditionalSteps(widenedShardReport)).toThrow(
            'validation.yml job unit step Report shard failure must retain its pinned condition'
        );

        // Mutation-kill: an allowlist entry matching no live step leaves that
        // condition unpinned, so the sweep refuses the orphan rather than
        // letting the list rot beside the file.
        const orphanedPin = cloneWorkflows('orphaned shard report pin');
        removeStepNamed(jobAt(orphanedPin.validation, 'unit'), 'Report shard failure');
        expect(() => assertUnconditionalSteps(orphanedPin)).toThrow(
            'validation.yml job unit step Report shard failure must carry its pinned condition'
        );

        // Mutation-kill: widening the build condition runs the production
        // build where it proves nothing — and dropping it retires the proof.
        const widenedBuild = cloneWorkflows('widened build condition');
        jobAt(widenedBuild.validation, 'build').if = CODE_CONDITION;
        expect(() => assertValidationScopeConditions(widenedBuild.validation)).toThrow(
            'the production build must answer to the web scope alone'
        );

        const droppedRustScope = cloneWorkflows('dropped rust scope condition');
        delete jobAt(droppedRustScope.validation, 'rust').if;
        expect(() => assertValidationScopeConditions(droppedRustScope.validation)).toThrow(
            'the Rust workspace leg must answer to the Rust and server scopes'
        );

        // Mutation-kill: `contents: write` hands a review-triggered workflow a
        // token that can push; dropping the SARIF write fails the upload.
        const widenedCodeQl = cloneWorkflows('widened codeql permissions');
        recordAt(jobAt(widenedCodeQl.heavy, 'codeql'), 'permissions').contents = 'write';
        expect(() => assertHeavyCodeQlPermissions(widenedCodeQl.heavy)).toThrow(
            'the heavy CodeQL job must grant exactly contents: read, security-events: write, and actions: read'
        );

        const narrowedCodeQl = cloneWorkflows('narrowed codeql permissions');
        delete recordAt(jobAt(narrowedCodeQl.heavy, 'codeql'), 'permissions')['security-events'];
        expect(() => assertHeavyCodeQlPermissions(narrowedCodeQl.heavy)).toThrow(
            'the heavy CodeQL job must grant exactly contents: read, security-events: write, and actions: read'
        );
    });

    it('pins the recorded workflow snapshot, the shard matrices, job-level permissions, and every step inventory', () => {
        expect(() =>
            assertWorkflowSnapshotMatch(
                readRecordedWorkflowSnapshot(repositoryRoot),
                parseHealthGateWorkflows(repositoryRoot)
            )
        ).not.toThrow();
        expect(() => assertShardMatrices(workflowSet())).not.toThrow();
        expect(() => assertNoJobLevelPermissions(workflowSet())).not.toThrow();
        expect(() => assertStepInventory(workflowSet())).not.toThrow();

        // Mutation-kill: an edit to a key no named pin reads — here the gate
        // timeout — still fails the harness, because the snapshot pins the
        // whole parsed file rather than the keys someone enumerated.
        const driftedTimeout = parseHealthGateWorkflows(repositoryRoot);
        jobAt(asRecord(driftedTimeout['health-gates.yml'], 'drifted health-gates'), 'gate')['timeout-minutes'] = 10;
        expect(() => assertWorkflowSnapshotMatch(readRecordedWorkflowSnapshot(repositoryRoot), driftedTimeout)).toThrow(
            'health-gates.yml drifted from the recorded workflow snapshot'
        );

        // Mutation-kill: a shrunk unit matrix reports green while a quarter of
        // the suite never runs — the review-found hole.
        const shrunkMatrix = cloneWorkflows('shrunk unit shard matrix');
        recordAt(recordAt(jobAt(shrunkMatrix.validation, 'unit'), 'strategy'), 'matrix').shard = [1, 2, 3];
        expect(() => assertShardMatrices(shrunkMatrix)).toThrow(
            'validation.yml job unit must shard across exactly 1, 2, 3, 4'
        );

        // Mutation-kill: a job-level permissions block widens one leg's token
        // away from the workflow-level pin — the second review-found hole.
        const widenedUnit = cloneWorkflows('widened unit job permissions');
        jobAt(widenedUnit.validation, 'unit').permissions = { contents: 'write' };
        expect(() => assertNoJobLevelPermissions(widenedUnit)).toThrow(
            'validation.yml job unit must inherit the workflow-level permissions'
        );

        // Mutation-kill: deleting the health-gate self-check step leaves the
        // static leg green while this harness never runs — the third
        // review-found hole.
        const deletedStep = cloneWorkflows('deleted infrastructure step');
        removeStepNamed(jobAt(deletedStep.validation, 'static'), 'Health gate infrastructure');
        expect(() => assertStepInventory(deletedStep)).toThrow(
            'validation.yml job static steps drifted from the pinned inventory'
        );
    });

    it('refuses a workflows directory that drifts from the recorded file inventory', () => {
        expect(() =>
            assertWorkflowFileInventory(readRecordedWorkflowSnapshot(repositoryRoot), repositoryRoot)
        ).not.toThrow();
        expect(withWorkflowFiles([...HEALTH_GATE_WORKFLOW_FILES])).not.toThrow();

        // Mutation-kill: a fifth workflow the four-file parse never reads can
        // still mint a passing Gate over a red head — the review-found hole —
        // so the directory listing itself is pinned.
        expect(withWorkflowFiles([...HEALTH_GATE_WORKFLOW_FILES, 'shadow.yml'])).toThrow(
            'shadow.yml is not in the recorded workflow file inventory'
        );

        // Mutation-kill: deleting a pinned workflow leaves the record pointing
        // at a gate that no longer exists.
        expect(withWorkflowFiles(HEALTH_GATE_WORKFLOW_FILES.slice(1))).toThrow(
            'health-gates.yml is pinned in the recorded workflow file inventory but missing from .github/workflows'
        );
    });

    it('requires Set up pnpm immediately before Set up Node on every pnpm-cached nightly and heavy-lane job', () => {
        expect(() => assertPnpmBeforeNodeOrder(nightly)).not.toThrow();
        expect(() => assertPnpmBeforeNodeOrder(heavyWorkflow)).not.toThrow();

        const missingPnpmSetup = asRecord(structuredClone(nightly), 'missing pnpm setup nightly');
        removeStepNamed(jobAt(missingPnpmSetup, 'unit'), PNPM_SETUP_STEP);
        expect(() => assertPnpmBeforeNodeOrder(missingPnpmSetup)).toThrow(
            `unit must run ${PNPM_SETUP_STEP} immediately before ${NODE_SETUP_STEP} when setup-node caches pnpm`
        );

        const reversedSetup = asRecord(structuredClone(nightly), 'reversed pnpm setup nightly');
        swapStepsNamed(jobAt(reversedSetup, 'unit'), PNPM_SETUP_STEP, NODE_SETUP_STEP);
        expect(() => assertPnpmBeforeNodeOrder(reversedSetup)).toThrow(
            `unit must run ${PNPM_SETUP_STEP} immediately before ${NODE_SETUP_STEP} when setup-node caches pnpm`
        );

        const reversedDeploySetup = asRecord(structuredClone(nightly), 'reversed deploy pnpm setup nightly');
        swapStepsNamed(jobAt(reversedDeploySetup, DEPLOY_WEB_JOB), PNPM_SETUP_STEP, NODE_SETUP_STEP);
        expect(() => assertPnpmBeforeNodeOrder(reversedDeploySetup)).toThrow(
            `${DEPLOY_WEB_JOB} must run ${PNPM_SETUP_STEP} immediately before ${NODE_SETUP_STEP} when setup-node caches pnpm`
        );

        const reversedHeavySetup = asRecord(structuredClone(heavyWorkflow), 'reversed pnpm setup heavyWorkflow');
        swapStepsNamed(jobAt(reversedHeavySetup, 'e2e'), PNPM_SETUP_STEP, NODE_SETUP_STEP);
        expect(() => assertPnpmBeforeNodeOrder(reversedHeavySetup)).toThrow(
            `e2e must run ${PNPM_SETUP_STEP} immediately before ${NODE_SETUP_STEP} when setup-node caches pnpm`
        );
    });

    it('builds the native addon and runs every spec that loads it, unsoftened', () => {
        expect(() => assertNativeParityJob(validationWorkflow)).not.toThrow();
        expect(addonLoadingSpecs(join(repositoryRoot, 'src'))).toContain(
            'src/modules/AudioEngine/useCases/livePlayback/__tests__/projectLiveGraphProgrammeParity.spec.ts'
        );

        const softenedJob = asRecord(structuredClone(validationWorkflow), 'softened native parity job');
        jobAt(softenedJob, NATIVE_PARITY_JOB)['continue-on-error'] = true;
        expect(() => assertNativeParityJob(softenedJob)).toThrow('native parity must not continue on error');

        const softenedRun = asRecord(structuredClone(validationWorkflow), 'softened native parity run');
        stepNamed(jobAt(softenedRun, NATIVE_PARITY_JOB), NATIVE_PARITY_RUN_STEP)['continue-on-error'] = true;
        expect(() => assertNativeParityJob(softenedRun)).toThrow('native parity must not continue on error');

        const forkedBuild = asRecord(structuredClone(validationWorkflow), 'forked native addon build');
        stepNamed(jobAt(forkedBuild, NATIVE_PARITY_JOB), NATIVE_PARITY_BUILD_STEP).run =
            'cargo build --release --package sourdaw-native --features napi-addon';
        expect(() => assertNativeParityJob(forkedBuild)).toThrow(
            'native parity must build the addon through the builder the desktop chain ships'
        );

        const narrowedScope = asRecord(structuredClone(validationWorkflow), 'narrowed native parity scope');
        jobAt(narrowedScope, NATIVE_PARITY_JOB).if = "needs.decide.outputs.rust == 'true'";
        expect(() => assertNativeParityJob(narrowedScope)).toThrow(
            'native parity must answer to both the Rust and the web scopes'
        );

        const droppedSpec = asRecord(structuredClone(validationWorkflow), 'dropped parity spec workflow');
        const runStep = stepNamed(jobAt(droppedSpec, NATIVE_PARITY_JOB), NATIVE_PARITY_RUN_STEP);
        const dropped = addonLoadingSpecs(join(repositoryRoot, 'src'))[0] ?? '';
        runStep.run = stringAt(runStep, 'run').replace(dropped, '');
        expect(() => assertNativeParityJob(droppedSpec)).toThrow(`native parity must run ${dropped}`);
    });

    it('refuses an addon presence guard that cannot fail', () => {
        // Executed, not read: each of these bodies names the artifact exactly as
        // the real step does, and each would let the parity specs skip on every
        // hosted run while a substring pin reported the leg intact.
        const namingGuard = asRecord(structuredClone(validationWorkflow), 'path-naming native parity guard');
        stepNamed(jobAt(namingGuard, NATIVE_PARITY_JOB), NATIVE_PARITY_ADDON_STEP).run =
            `echo ${NATIVE_ADDON_ARTIFACT}; true`;
        expect(() => assertNativeParityJob(namingGuard)).toThrow(
            'native parity must fail a run whose addon the parity specs would not find'
        );

        const misdirectedGuard = asRecord(structuredClone(validationWorkflow), 'misdirected native parity guard');
        stepNamed(jobAt(misdirectedGuard, NATIVE_PARITY_JOB), NATIVE_PARITY_ADDON_STEP).run =
            `test -f ${NATIVE_ADDON_ARTIFACT}.built`;
        expect(() => assertNativeParityJob(misdirectedGuard)).toThrow(
            'native parity must accept the addon its own builder produces'
        );
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
        expect(() => assertNightlyBrowserAiWebGpuJob(nightly)).not.toThrow();
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
        const gateScript = assertGateContract(workflow, 'gate', 'Gate', GATE_CONDITION);
        expect(runResultsGuard(gateScript, needsResults(workflow, 'gate', 'success'))).toBe(0);
        expect(runResultsGuard(gateScript, needsResults(workflow, 'gate', 'skipped'))).toBe(0);
        expect(runResultsGuard(gateScript, needsResults(workflow, 'gate', 'failure'))).not.toBe(0);
        expect(runResultsGuard(gateScript, needsResults(workflow, 'gate', 'cancelled'))).not.toBe(0);
        const renamedGate = asRecord(structuredClone(workflow), 'renamed gate workflow');
        jobAt(renamedGate, 'gate').name = 'Health summary';
        expect(() => assertGateContract(renamedGate, 'gate', 'Gate', GATE_CONDITION)).toThrow(
            'the Gate job must always report under its stable name'
        );

        // A job-level continue-on-error concludes the required check success
        // over red needs: GitHub reports the job successful whatever the
        // guard observed.
        const softenedGate = asRecord(structuredClone(workflow), 'softened gate workflow');
        jobAt(softenedGate, 'gate')['continue-on-error'] = true;
        expect(() => assertGateContract(softenedGate, 'gate', 'Gate', GATE_CONDITION)).toThrow(
            'the Gate job must not continue on error'
        );

        // A conditional guard step can skip, and a skipped step fails
        // nothing: the job then succeeds unconditionally.
        const conditionalGateGuard = asRecord(structuredClone(workflow), 'conditional-guard gate workflow');
        stepNamed(jobAt(conditionalGateGuard, 'gate'), 'Require every job to have succeeded or been skipped').if =
            'false';
        expect(() => assertGateContract(conditionalGateGuard, 'gate', 'Gate', GATE_CONDITION)).toThrow(
            'the gate guard step must stay unconditional'
        );

        const heavyGateScript = assertGateContract(heavyWorkflow, 'heavy-gate', 'HeavyGate', HEAVY_GATE_CONDITION);
        expect(runResultsGuard(heavyGateScript, needsResults(heavyWorkflow, 'heavy-gate', 'success'))).toBe(0);
        expect(runResultsGuard(heavyGateScript, needsResults(heavyWorkflow, 'heavy-gate', 'skipped'))).toBe(0);
        expect(runResultsGuard(heavyGateScript, needsResults(heavyWorkflow, 'heavy-gate', 'failure'))).not.toBe(0);
        expect(runResultsGuard(heavyGateScript, needsResults(heavyWorkflow, 'heavy-gate', 'cancelled'))).not.toBe(0);
        // The required Gate never sees the heavy jobs, so this filter is the
        // only thing that refuses their failures: a weakened one would report
        // a red heavy leg as a passing summary.
        const weakenedHeavyFilter = asRecord(structuredClone(heavyWorkflow), 'weakened heavy filter heavyWorkflow');
        const weakenedStep = stepNamed(
            jobAt(weakenedHeavyFilter, 'heavy-gate'),
            'Require every job to have succeeded or been skipped'
        );
        weakenedStep.run = stringAt(weakenedStep, 'run').replace(
            '.value.result != "success" and .value.result != "skipped"',
            '.value.result == "cancelled"'
        );
        expect(() => assertGateContract(weakenedHeavyFilter, 'heavy-gate', 'HeavyGate', HEAVY_GATE_CONDITION)).toThrow(
            'heavy-gate must reject every result other than success or skipped'
        );

        // The same two softenings on the heavy summary: HeavyGate is not
        // ruleset-required, but it is the only verdict an approving review
        // run mints for the heavy lane.
        const softenedHeavyGate = asRecord(structuredClone(heavyWorkflow), 'softened heavy gate heavyWorkflow');
        jobAt(softenedHeavyGate, 'heavy-gate')['continue-on-error'] = true;
        expect(() => assertGateContract(softenedHeavyGate, 'heavy-gate', 'HeavyGate', HEAVY_GATE_CONDITION)).toThrow(
            'the HeavyGate job must not continue on error'
        );

        const conditionalHeavyGateGuard = asRecord(
            structuredClone(heavyWorkflow),
            'conditional-guard heavy gate heavyWorkflow'
        );
        stepNamed(
            jobAt(conditionalHeavyGateGuard, 'heavy-gate'),
            'Require every job to have succeeded or been skipped'
        ).if = 'false';
        expect(() =>
            assertGateContract(conditionalHeavyGateGuard, 'heavy-gate', 'HeavyGate', HEAVY_GATE_CONDITION)
        ).toThrow('the heavy-gate guard step must stay unconditional');
    });

    it('runs a trusted, credentialless scanner over the untrusted target history', () => {
        expect(() => assertCredentiallessScanner(heavyWorkflow)).not.toThrow();
        expect(() => assertCredentiallessScanner(nightly)).not.toThrow();
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
        const validationGuard = assertDailyDeployTrain(nightly);
        expect(() => assertDeployOutsideSummaries(workflowSet())).not.toThrow();

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

        // The desktop shell ships nothing this deployment carries; adding its
        // native leg back must not freeze the web again behind a red native
        // build. (The Rust workspace leg belongs in `needs` — it is the only
        // test of the committed `public/wasm/*` packages this bundle ships —
        // so it stays in DEPLOY_WEB_NEEDS rather than being the mutation here.)
        const nativeWindowsReintroducedTrain = asRecord(
            structuredClone(nightly),
            'native-windows-reintroduced deploy train'
        );
        arrayAt(jobAt(nativeWindowsReintroducedTrain, DEPLOY_WEB_JOB), 'needs').push('native-windows');
        expect(() => assertDailyDeployTrain(nativeWindowsReintroducedTrain)).toThrow(
            'the daily deploy train must depend on exactly the scheduled validation legs'
        );

        const unscopedTrain = asRecord(structuredClone(nightly), 'unscoped deploy train');
        delete jobAt(unscopedTrain, DEPLOY_WEB_JOB).environment;
        expect(() => assertDailyDeployTrain(unscopedTrain)).toThrow(
            'the daily deploy train must draw its credential from the Production environment'
        );

        // The environment URL is what tells a real deployment apart from a
        // no-op on the GitHub deployments record; a fixed URL would report a
        // deployment even on a run that skipped every deploying step.
        const fixedUrlTrain = asRecord(structuredClone(nightly), 'fixed-url deploy train');
        recordAt(jobAt(fixedUrlTrain, DEPLOY_WEB_JOB), 'environment').url = 'https://sourdaw.vercel.app';
        expect(() => assertDailyDeployTrain(fixedUrlTrain)).toThrow(
            'the daily deploy train must draw its credential from the Production environment'
        );

        const ungatedTrain = asRecord(structuredClone(nightly), 'ungated deploy train');
        delete recordAt(jobAt(ungatedTrain, DEPLOY_WEB_JOB), 'env').DEPLOY_CREDENTIAL_PRESENT;
        expect(() => assertDailyDeployTrain(ungatedTrain)).toThrow(
            'the daily deploy train must resolve credential presence without exposing the token'
        );

        const credentiallessDeploy = asRecord(structuredClone(nightly), 'credentialless deploy train');
        stepNamed(jobAt(credentiallessDeploy, DEPLOY_WEB_JOB), DEPLOY_WEB_RESOLVE_STEP).if =
            "github.event_name == 'schedule'";
        expect(() => assertDailyDeployTrain(credentiallessDeploy)).toThrow(
            `${DEPLOY_WEB_RESOLVE_STEP} must not run without the deployment credential`
        );

        // Mutation-kill: dropping the token the ancestry comparison
        // authenticates with must fail this spec, not just leave the resolve
        // script unable to reach GitHub at runtime.
        const tokenlessResolver = asRecord(structuredClone(nightly), 'tokenless resolver deploy train');
        delete recordAt(stepNamed(jobAt(tokenlessResolver, DEPLOY_WEB_JOB), DEPLOY_WEB_RESOLVE_STEP), 'env')
            .GITHUB_TOKEN;
        expect(() => assertDailyDeployTrain(tokenlessResolver)).toThrow(
            'the production-revision step must authenticate its ancestry comparison with a GitHub token'
        );

        // Mutation-kill: a link step missing its org id must fail this spec,
        // not link the deploy to whatever project the token's default
        // resolves to at runtime.
        const orglessLink = asRecord(structuredClone(nightly), 'org-less link step deploy train');
        delete recordAt(stepNamed(jobAt(orglessLink, DEPLOY_WEB_JOB), VERCEL_LINK_STEP), 'env').VERCEL_ORG_ID;
        expect(() => assertDailyDeployTrain(orglessLink)).toThrow(
            `${VERCEL_LINK_STEP} must read VERCEL_ORG_ID from the environment`
        );

        const unidentifiedResolver = asRecord(structuredClone(nightly), 'unidentified resolver deploy train');
        stepNamed(jobAt(unidentifiedResolver, DEPLOY_WEB_JOB), DEPLOY_WEB_RESOLVE_STEP).id = 'resolve';
        expect(() => assertDailyDeployTrain(unidentifiedResolver)).toThrow(
            'the daily deploy train must publish its production-revision decision under a stable step id'
        );

        const uncandidatedResolver = asRecord(structuredClone(nightly), 'uncandidated resolver deploy train');
        delete recordAt(stepNamed(jobAt(uncandidatedResolver, DEPLOY_WEB_JOB), DEPLOY_WEB_RESOLVE_STEP), 'env')
            .CANDIDATE_REVISION;
        expect(() => assertDailyDeployTrain(uncandidatedResolver)).toThrow(
            'the production-revision step must read the revision this run is about to deploy'
        );

        const misauthenticatedResolver = asRecord(structuredClone(nightly), 'misauthenticated resolver deploy train');
        recordAt(
            stepNamed(jobAt(misauthenticatedResolver, DEPLOY_WEB_JOB), DEPLOY_WEB_RESOLVE_STEP),
            'env'
        ).VERCEL_ORG_ID = 'org_fixture';
        expect(() => assertDailyDeployTrain(misauthenticatedResolver)).toThrow(
            'the production-revision step must authenticate its Vercel query from the environment'
        );

        // Mutation-kill: a resolve step that writes its own outputs inline,
        // bypassing the ancestry decision the script makes, must fail this
        // spec rather than only being caught by reading the script's source.
        const inlinedResolver = asRecord(structuredClone(nightly), 'inlined resolver deploy train');
        stepNamed(jobAt(inlinedResolver, DEPLOY_WEB_JOB), DEPLOY_WEB_RESOLVE_STEP).run =
            'printf \'deploy=true\\nreason=deploy\\n\' >> "$GITHUB_OUTPUT"';
        expect(() => assertDailyDeployTrain(inlinedResolver)).toThrow(
            'the daily deploy train must decide through scripts/resolveVercelProductionDeployment.ts'
        );

        const unconditionalSkipReport = asRecord(structuredClone(nightly), 'unconditional skip-report deploy train');
        stepNamed(jobAt(unconditionalSkipReport, DEPLOY_WEB_JOB), DEPLOY_WEB_SKIP_REPORT_STEP).if =
            DEPLOY_CREDENTIAL_CONDITION;
        expect(() => assertDailyDeployTrain(unconditionalSkipReport)).toThrow(
            'the daily deploy train must report why nothing was deployed only when credentialed but not deploying'
        );

        const unreasonedSkipReport = asRecord(structuredClone(nightly), 'unreasoned skip-report deploy train');
        delete recordAt(stepNamed(jobAt(unreasonedSkipReport, DEPLOY_WEB_JOB), DEPLOY_WEB_SKIP_REPORT_STEP), 'env')
            .REASON;
        expect(() => assertDailyDeployTrain(unreasonedSkipReport)).toThrow(
            'the skip report must read the decision reason the production-revision step published'
        );

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

        const gatingTrain = cloneWorkflows('gating deploy train');
        arrayAt(jobAt(gatingTrain.heavy, 'heavy-gate'), 'needs').push(DEPLOY_WEB_JOB);
        expect(() => assertDeployOutsideSummaries(gatingTrain)).toThrow(
            'the daily deploy train must stay outside the heavy summary'
        );
    });
});
