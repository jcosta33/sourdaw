import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDocument } from 'yaml';

import {
    getBrowserAiWebGpuHardwareRequirement,
    probeBrowserWebGpuHardwareInPage,
    requireBrowserWebGpuHardware,
} from '../../tests/e2e/browserAiHardware';
import browserAiWebGpuAdmissionConfig from '../../tests/e2e/browserAiWebGpuAdmission.playwright.config';
import { ADMITTED_CONDITION, assertApprovalGatedRequiredCheck } from '../approvalGatedWorkflowContract';
import { assertDeployWebBuildRun, assertDeployWebJobNoVercelPull } from '../deployWebWorkflowContract';
import {
    assertWorkflowFileInventory,
    assertWorkflowSnapshotMatch,
    CONDITIONAL_STEP_ALLOWLIST,
    type ConditionalStepPin,
    HEALTH_GATE_WORKFLOW_FILES,
    parseHealthGateWorkflows,
    readRecordedWorkflowSnapshot,
    SHARD_MATRIX_JOBS,
    STEP_INVENTORY,
} from '../healthGateWorkflowContract';
import { assertHostedQuantumMeasurementWorkflow } from '../hostedQuantumMeasurementWorkflowContract';
import { assertHostedWasmWorkflow } from '../hostedWasmWorkflowContract';
import { assertJobLevelPermissions, assertWorkflowSecuritySurface } from '../workflowSecuritySurfaceContract';

type UnknownRecord = Record<string, unknown>;
type JobResult = 'cancelled' | 'failure' | 'skipped' | 'success';

const HEAVY_OUTPUT_REFERENCE = '${{ steps.scope.outputs.heavy }}';
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
    tooling: '${{ steps.scope.outputs.tooling }}',
};
const CODE_CONDITION = "needs.decide.outputs.code == 'true'";
// An approving review validates the same pull-request head under a different
// event, but it must wait behind any in-flight push run instead of cancelling
// it. Every Gate member reading a pull request keys off the payload instead.
const PULL_REQUEST_PAYLOAD_CONDITION = 'github.event.pull_request != null';
const SMOKE_CONDITION = `${PULL_REQUEST_PAYLOAD_CONDITION} && needs.decide.outputs.e2e == 'true'`;
const EVENT_GATED_SMOKE_CONDITION = "github.event_name == 'pull_request' && needs.decide.outputs.e2e == 'true'";
const SMOKE_COMMAND = 'pnpm test:e2e tests/e2e/smoke.spec.ts --retries=0';
const INSTALL_DRAIN_SECONDS = 15;
// Every remaining root apt route must retain the signed-source filter.
const APT_FEED_FILTER = 'bash scripts/aptWithoutMicrosoftFeed.sh';
const PLAYWRIGHT_IMAGE_DIGEST = 'sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27';
const BROWSER_RUNTIME_STEP = 'Verify preinstalled browser runtime';
// The ALSA headers are one small apt install, but `apt-get update` is the slow
// part on a slow mirror, so the single transaction carries the same 8 minute
// manager deadline as the browser dependency install.
const ALSA_ATTEMPT_CAP_MINUTES = 8;
const FILTERED_ALSA_INSTALL = `${APT_FEED_FILTER} --deadline 8m -- bash -c 'apt-get update && apt-get install -y libasound2-dev'`;
const ALSA_INSTALL_COMMAND = `sudo env "PATH=$PATH" ${FILTERED_ALSA_INSTALL}`;
const ALSA_INSTALL_WORST_CASE_SECONDS = ALSA_ATTEMPT_CAP_MINUTES * 60 + INSTALL_DRAIN_SECONDS;
const SMOKE_JOB_MINUTES = 45;
const E2E_JOB_MINUTES = 75;
const PULL_REQUEST_CONCURRENCY_GROUP = 'health-gates-${{ github.event.pull_request.number }}';
const PULL_REQUEST_CONCURRENCY_CANCELLATION = true;
// A cancelled upstream job must still reach the required assertion. GitHub
// accepts skipped required checks, so the summary and its sole step use always().
const GATE_CONDITION = '${{ always() }}';
const HEAVY_GATE_CONDITION = '${{ always() }}';
const HEALTH_GATES_TRIGGERS = ['pull_request'] as const;
const HEAVY_GATES_TRIGGERS = ['workflow_call'] as const;
const NIGHTLY_TRIGGERS = ['schedule', 'workflow_dispatch'] as const;
const VALIDATION_TRIGGERS = ['workflow_call'] as const;
const VALIDATION_CALL = './.github/workflows/validation.yml';
const REQUIRED_CHECK_NAME = 'Gate';
const HEAVY_SUMMARY_NAME = 'HeavyGate';
const NIGHTLY_CRON = '23 3 * * *';
const NIGHTLY_CONCURRENCY_GROUP = 'nightly-${{ github.run_id }}';
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
const NATIVE_PARITY_CONDITION =
    "inputs.mode == 'full' && (needs.decide.outputs.rust == 'true' || needs.decide.outputs.web == 'true')";
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
// The cargo registry index cache layer keys its archive per job: the two
// native macOS jobs consult different index entries, so a key shared across
// jobs lets whichever job's post-save ran first fix the archived index for
// both (#5094, #5136). The recorded snapshot re-records in lockstep with the
// workflow it pins, so this scoping is asserted against the parsed workflow
// itself, never against the fixture alone.
const CARGO_INDEX_KEY_PREFIX = 'cargo-index-';
const CACHE_ACTION_USES_PREFIX = 'actions/cache@';
const JOB_SCOPE_EXPRESSION = '${{ github.job }}';
const CARGO_DEPENDENCY_KEY =
    "cargo-deps-v1-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('Cargo.lock', '**/Cargo.toml', '.cargo/config.toml', 'rust-toolchain.toml') }}";
const CARGO_INDEX_KEY =
    "cargo-index-v2-${{ runner.os }}-${{ runner.arch }}-${{ github.job }}-${{ hashFiles('Cargo.lock', '**/Cargo.toml', '.cargo/config.toml', 'rust-toolchain.toml') }}";
const CARGO_INDEX_RESTORE = 'cargo-index-v2-${{ runner.os }}-${{ runner.arch }}-${{ github.job }}-\n';
const CARGO_DEPENDENCY_PATH = '~/.cargo/registry\n~/.cargo/git\n';
const CARGO_OFFLINE_EXACT = "${{ steps.cargo-deps.outputs.cache-hit == 'true' && 'true' || 'false' }}";
const NATIVE_OFFLINE_EXACT =
    "${{ steps.rust-cache.outputs.cache-hit == 'true' && steps.cargo-index.outputs.cache-hit == 'true' && 'true' || 'false' }}";
const PNPM_SETUP_STEP = 'Set up pnpm';
const NODE_SETUP_STEP = 'Set up Node';
const PULL_REQUEST_EXCLUDED_JOBS = [
    'e2e',
    'e2e-report',
    'browser-ai-webgpu',
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
const BROWSER_AI_WEBGPU_CONDITION = 'inputs.browser-ai';
const BROWSER_AI_WEBGPU_RUNNER = 'macos-14';
const BROWSER_AI_WEBGPU_SCRIPT_NAME = 'test:e2e:browser-ai-webgpu-admission';
const BROWSER_AI_WEBGPU_COMMAND = 'pnpm test:e2e:browser-ai-webgpu-admission';
const BROWSER_AI_WEBGPU_LOG = 'browser-ai-webgpu-admission.log';
const BROWSER_AI_WEBGPU_GLOBAL_TIMEOUT_MS = 17 * 60_000;
const BROWSER_AI_WEBGPU_STEP_TIMEOUT_MINUTES = 18;
const BROWSER_AI_WEBGPU_JOB_TIMEOUT_MINUTES = 40;
const BROWSER_AI_WEBGPU_DIAGNOSTIC_PATHS = [
    BROWSER_AI_WEBGPU_LOG,
    'test-results/**/trace.zip',
    'test-results/**/error-context.md',
    'test-results/.last-run.json',
];
const BROWSER_AI_WEBGPU_STEP_CAPS = new Map([
    // A slow merge-ref fetch timed out a 1-minute checkout (run 39588034702).
    ['Checkout', 3],
    ['Enable Corepack', 1],
    // The pnpm self-installer took about 5 minutes on macOS during a registry
    // slowdown that killed 1-minute admissions (run 39703602835).
    ['Set up pnpm', 7],
    ['Set up Node', 3],
    ['Install dependencies', 2],
    ['Install Chromium', 2],
    ['Run Browser AI WebGPU admission', 18],
    ['Upload Browser AI WebGPU diagnostics', 2],
]);
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
const GATE_MEMBERS = ['admission', 'scope', 'validation', 'affected', 'codeql'] as const;
// Exact and ordered. `Gate` is a required status check, so a leg dropped from
// this lane stops deciding merges while every check still reads green.
const VALIDATION_JOBS = [
    'decide',
    'static',
    'lint',
    'boundaries',
    'unit',
    'tooling-unit',
    'smoke',
    'build',
    'rust',
    'native-macos',
    'native-windows',
    'native-parity',
    'dependency-review',
    'pr-secrets',
    'validation-gate',
] as const;
const HEAVY_GATE_MEMBERS = ['e2e', 'e2e-report', 'browser-ai-webgpu'] as const;
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
// Standard Protection restricts every generated deployment URL behind Vercel
// Authentication, so the deployment URL redirects to the vercel.com login page
// and only the aliases the deployment took are public. The isolation
// assertion therefore reads the aliases, and the deployment URL is what the
// step that resolves them reads.
const DEPLOYMENT_ALIASES_REFERENCE = '${{ steps.aliases.outputs.aliases }}';
const DEPLOY_WEB_ALIAS_STEP = 'Resolve the aliases of the deployment';
const DEPLOY_WEB_ISOLATION_STEP = 'Assert cross-origin isolation on the deployment';
const DEPLOY_WEB_ISOLATION_SCRIPT = 'scripts/assert-deployment-isolation.sh';
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
// failures must not freeze it. The collaboration-server leg (#3516) stays
// out for the same reason: the bundle ships nothing from `server/`.
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
// deliberately does not wait for the native legs or the collaboration server
// (DEPLOY_WEB_NEEDS), but the reporter observes the whole train: a native or
// server failure must still file the issue.
const NIGHTLY_REPORT_NEEDS = [
    'static',
    'lint',
    'boundaries',
    'unit',
    'build',
    'rust',
    'collab-server',
    'native-macos',
    'native-windows',
    'desktop-measure',
    'e2e',
    'e2e-report',
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
    DEPLOY_WEB_ALIAS_STEP,
    DEPLOY_WEB_ISOLATION_STEP,
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
// Unit and selected E2E both reach the required Gate through reusable callers.
const SUITE_JOB_WIRING = {
    unit: {
        workflow: 'validation',
        needs: 'decide',
        if: "inputs.mode == 'full' && (needs.decide.outputs.web == 'true')",
    },
    e2e: {
        workflow: 'heavy',
        needs: undefined,
        if: 'fromJSON(inputs.matrix).include[0] != null',
    },
} satisfies Record<string, Readonly<{ workflow: 'validation' | 'heavy'; needs?: string; if: string }>>;
// The four scope conditions no other pin reads. Each is the whole definition
// of when its job may legitimately skip: widening one runs the leg where it
// proves nothing, and narrowing or dropping one retires the proof while every
// other pin stays green.
const BUILD_CONDITION = "inputs.mode == 'full' && (needs.decide.outputs.web == 'true')";
const RUST_CONDITION =
    "inputs.mode == 'full' && (needs.decide.outputs.rust == 'true' || needs.decide.outputs.server == 'true')";
const NATIVE_MACOS_CONDITION = "inputs.mode == 'full' && (needs.decide.outputs.rust == 'true')";
const NATIVE_WINDOWS_CONDITION = "inputs.mode == 'full' && (needs.decide.outputs.rust == 'true')";
// The nightly split its combined Rust job along the deploy seam (#3516): the
// crate leg keeps the `rust` scope alone because the crates it tests ship in
// the web bundle, and the collaboration-server leg answers to the `server`
// scope alone because the bundle ships nothing from `server/`. Each gate is
// its own script, so the legs can no longer fail for each other's reasons.
const NIGHTLY_RUST_JOB = 'rust';
const NIGHTLY_RUST_CONDITION = "needs.decide.outputs.rust == 'true'";
const NIGHTLY_RUST_GATE_STEP = 'Rust workspace health gates';
const NIGHTLY_RUST_GATE_COMMAND = 'sh scripts/health-gates-rust.sh';
const COLLAB_SERVER_JOB = 'collab-server';
const COLLAB_SERVER_JOB_NAME = 'Collaboration server';
const COLLAB_SERVER_CONDITION = "needs.decide.outputs.server == 'true'";
const COLLAB_SERVER_GATE_STEP = 'Collaboration server health gates';
const COLLAB_SERVER_GATE_COMMAND = 'sh scripts/health-gates-server.sh';
// The failed shard is already fatal, so these reporters are the one reason a
// step may carry a condition at all; `!cancelled()` replaces the implicit
// `success()` that would skip the annotation over the very failure it names.
const E2E_BLOB_UPLOAD_CONDITION = '${{ !cancelled() }}';
// The decide job's changed-paths filter lists a pull request's files through
// the GitHub REST API on its shallow checkout, and that API intermittently
// answers 500 (#3592). The first attempt may fail softly so the retry step can
// re-run the identical filter; `Resolve scope` coalesces the retry's verdicts
// first and refuses an empty one, so a persistent API failure fails the job
// instead of reading as an all-false scope that silently skips every lane.
const PATHS_FILTER_ACTION = 'dorny/paths-filter@ceb8a2b8f2d89434be7ff52d3de7ec3738c5cc9d';
const PATHS_FILTER_FIRST_ATTEMPT_STEP = 'Filter changed paths';
const PATHS_FILTER_RETRY_STEP = 'Retry changed-paths filter after a transient API failure';
const PATHS_FILTER_RETRY_CONDITION = "steps.filter.outcome == 'failure'";
// The split's two gate scripts must stay claimed by the decide scopes. The
// rust filter's claim of the server script dates from the combined gate; the
// split added the rust script beside it. A gate script no scope claims is
// invisible to the classifier — `unclassified` subtracts `scripts/**` — so a
// pull request touching only that script resolves rust=false and the changed
// crate gate first meets a real toolchain on the nightly, after merge.
const SERVER_GATE_SCRIPT = 'scripts/health-gates-server.sh';
const RUST_GATE_SCRIPT = 'scripts/health-gates-rust.sh';
const PATHS_FILTER_VERDICT_ENV: ReadonlyArray<readonly [string, string]> = [
    ['RUST', 'rust'],
    ['SERVER', 'server'],
    ['E2E', 'e2e'],
    ['WEB', 'web'],
    ['UNCLASSIFIED', 'unclassified'],
];
// The first filter attempt defers to the retry; Resolve scope fails when neither
// attempt produced verdicts, so the softened step does not hide a failure.
type SoftenedStepPin = Readonly<{ workflow: string; job: string; step: string }>;
const CONTINUE_ON_ERROR_STEP_PINS: readonly SoftenedStepPin[] = [
    { workflow: 'validation.yml', job: 'decide', step: PATHS_FILTER_FIRST_ATTEMPT_STEP },
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
const lockfile = asRecord(
    parseDocument(readFileSync(join(repositoryRoot, 'pnpm-lock.yaml'), 'utf8')).toJS(),
    'lockfile'
);
const browserAiWebGpuConfig = asRecord(browserAiWebGpuAdmissionConfig, 'Browser AI WebGPU config');
function loadWorkflow(fileName: string): { document: ReturnType<typeof parseDocument>; parsed: UnknownRecord } {
    const document = parseDocument(readFileSync(join(repositoryRoot, '.github/workflows', fileName), 'utf8'));
    if (document.errors.length > 0) {
        throw new Error(`${fileName} is invalid YAML: ${document.errors.map((error) => error.message).join('; ')}`);
    }
    return { document, parsed: asRecord(document.toJS(), fileName) };
}

const isolationScriptSource = readFileSync(join(repositoryRoot, DEPLOY_WEB_ISOLATION_SCRIPT), 'utf8');

const { document: workflowDocument, parsed: workflow } = loadWorkflow('health-gates.yml');
const { parsed: validationWorkflow } = loadWorkflow('validation.yml');
const { parsed: prChecksWorkflow } = loadWorkflow('pr-checks.yml');
const { parsed: cargoDependencySeed } = loadWorkflow('cargo-dependency-seed.yml');
const { parsed: heavyWorkflow } = loadWorkflow('heavy-gates.yml');
const { document: nightlyDocument, parsed: nightly } = loadWorkflow('nightly.yml');
const { parsed: nightlyEvidenceReporter } = loadWorkflow('nightly-evidence-report.yml');
const { parsed: hostedQuantumMeasurement } = loadWorkflow('quantum-measurements.yml');
const { parsed: hostedWasm } = loadWorkflow('wasm-artifacts.yml');
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

function assertRequiredScopePlan(candidate: UnknownRecord): void {
    const scope = jobAt(candidate, 'scope');
    const outputs = recordAt(scope, 'outputs');
    for (const name of ['profile', 'matrix', 'browser', 'browser-ai', 'codeql']) {
        if (outputs[name] !== `\${{ steps.plan.outputs.${name} }}`) {
            throw new Error(`required scope must export ${name} from its plan`);
        }
    }
    if (Object.keys(outputs).length !== 5) {
        throw new Error('required scope must export exactly the selected checks');
    }
    const checkout = recordAt(stepNamed(scope, 'Checkout'), 'with');
    if (checkout['fetch-depth'] !== 0 || checkout['persist-credentials'] !== false) {
        throw new Error('required scope must read complete history without persisted credentials');
    }
    if (stepNamed(scope, 'Enable Corepack').run !== 'corepack enable') {
        throw new Error('required scope must enable the pinned package manager');
    }
    const pnpm = stepNamed(scope, 'Set up pnpm');
    if (
        typeof pnpm.uses !== 'string' ||
        pnpm.uses !== './.github/actions/setup-pnpm' ||
        recordAt(pnpm, 'with').package_json_file !== 'package.json'
    ) {
        throw new Error('required scope must install the repository package manager');
    }
    const node = recordAt(stepNamed(scope, 'Set up Node'), 'with');
    if (node['node-version'] !== '24.19.0' || node.cache !== 'pnpm') {
        throw new Error('required scope must use the pinned Node version');
    }
    if (stepNamed(scope, 'Install dependencies').run !== 'pnpm install --frozen-lockfile --ignore-scripts') {
        throw new Error('required scope must install pinned parser dependencies before planning');
    }
    const steps = scope.steps;
    const setupOrder = [
        'Enable Corepack',
        'Set up pnpm',
        'Set up Node',
        'Install dependencies',
        'Plan affected checks',
    ];
    if (!Array.isArray(steps)) {
        throw new TypeError('required scope steps are missing');
    }
    const indexes = setupOrder.map((name) =>
        steps.findIndex((step: unknown) => asRecord(step, 'scope step').name === name)
    );
    let previous = -1;
    for (const index of indexes) {
        if (index <= previous) {
            throw new Error('required scope must install dependencies before planning');
        }
        previous = index;
    }
    const plan = stepNamed(scope, 'Plan affected checks');
    if (
        plan.id !== 'plan' ||
        plan.run !== 'node scripts/prValidationScope.ts plan' ||
        recordAt(plan, 'env').BASE_SHA !== '${{ github.event.pull_request.base.sha }}' ||
        recordAt(plan, 'env').HEAD_SHA !== '${{ github.event.pull_request.head.sha }}'
    ) {
        throw new Error('required scope must plan from immutable base and head revisions');
    }
    const upload = recordAt(stepNamed(scope, 'Upload scope manifest'), 'with');
    if (upload.path !== 'pr-validation-scope.json' || upload['if-no-files-found'] !== 'error') {
        throw new Error('required scope must publish its manifest or fail');
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
                BROWSER: 'false',
                PROFILE: 'broad',
                MODE: 'full',
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

function selectedPrValidationJobs(outputs: UnknownRecord, candidate: UnknownRecord = validationWorkflow): string[] {
    const code = outputs.code === 'true';
    const web = outputs.web === 'true';
    const rust = outputs.rust === 'true';
    const server = outputs.server === 'true';
    const e2e = outputs.e2e === 'true';
    const tooling = outputs.tooling === 'true';
    const selected: Record<string, boolean> = {
        [CODE_CONDITION]: code,
        [BUILD_CONDITION]: web,
        "needs.decide.outputs.tooling == 'true'": tooling,
        [SMOKE_CONDITION]: e2e,
        [RUST_CONDITION]: rust || server,
        [NATIVE_MACOS_CONDITION]: rust,
        [NATIVE_PARITY_CONDITION]: rust || web,
        [PULL_REQUEST_PAYLOAD_CONDITION]: true,
    };
    return Object.entries(recordAt(candidate, 'jobs'))
        .filter(([id, value]) => {
            if (id === 'validation-gate') {
                return false;
            }
            const condition = asRecord(value, `validation job ${id}`).if;
            if (condition === undefined) {
                return true;
            }
            if (typeof condition !== 'string' || !(condition in selected)) {
                throw new Error(`Unrecognized validation job condition: ${id}: ${JSON.stringify(condition)}`);
            }
            return selected[condition];
        })
        .map(([id]) => id);
}

function assertScopeContract(candidate: UnknownRecord): string {
    const callerInputs = recordAt(recordAt(recordAt(candidate, 'on'), 'workflow_call'), 'inputs');
    if (JSON.stringify(Object.keys(callerInputs).sort()) !== JSON.stringify(['browser', 'mode', 'profile'])) {
        throw new Error('shared validation must expose browser, mode and affected profile inputs');
    }
    const decide = jobAt(candidate, 'decide');
    if (decide.if !== undefined) {
        throw new Error('decide must run for every pull request');
    }
    const outputs = recordAt(decide, 'outputs');
    for (const [name, reference] of Object.entries(SCOPE_OUTPUT_REFERENCES)) {
        if (outputs[name] !== reference) {
            throw new Error(`decide ${name} output must expose steps.scope.outputs.${name}`);
        }
    }
    // The decide outputs reach callers only through the `workflow_call` export
    // list: deleting one leaves a reusable caller with an empty output while
    // every pin above stays green. Pin the exact export set and forwarding value.
    const callerOutputs = recordAt(recordAt(recordAt(candidate, 'on'), 'workflow_call'), 'outputs');
    const exportedNames = Object.keys(callerOutputs).sort();
    if (JSON.stringify(exportedNames) !== JSON.stringify(Object.keys(SCOPE_OUTPUT_REFERENCES).sort())) {
        throw new Error('validation.yml must export exactly the seven scope outputs to its callers');
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
    if (recordAt(scope, 'env').MODE !== '${{ inputs.mode }}') {
        throw new Error('scope must validate the requested mode');
    }
    if (recordAt(scope, 'env').BROWSER !== '${{ inputs.browser }}') {
        throw new Error('shared validation must receive the selected browser decision');
    }
    if (recordAt(scope, 'env').PROFILE !== '${{ inputs.profile }}') {
        throw new Error('shared validation must consume the affected profile input');
    }
    return stringAt(scope, 'run');
}

function scopeFilterPatterns(candidate: UnknownRecord, scope: string): string[] {
    const filterStep = stepNamed(jobAt(candidate, 'decide'), 'Filter changed paths');
    const options = recordAt(filterStep, 'with');
    if (options['predicate-quantifier'] !== 'some-with-excludes') {
        throw new Error('path filters must subtract negated patterns instead of matching on any one of them');
    }
    const filters = asRecord(parseDocument(stringAt(options, 'filters')).toJS(), 'path filters');
    return arrayAt(filters, scope).map(String);
}

function unclassifiedPatterns(candidate: UnknownRecord): string[] {
    return scopeFilterPatterns(candidate, 'unclassified');
}

// A gate script no decide scope claims is invisible to the classifier, so a
// pull request whose diff touches only the Rust gate resolves rust=false, the
// PR-side rust job skips, and the changed crate gate is first exercised by
// the nightly after merge. Both claims are exact literal paths, so the match
// needs no glob semantics to prove. The retry step duplicates the first
// attempt's filters verbatim (pinned in assertDecideFilterRetryContract), so
// one claim here covers both filter steps.
function assertGateScriptScopeClaims(candidate: UnknownRecord): void {
    const rustPatterns = scopeFilterPatterns(candidate, 'rust');
    if (!rustPatterns.includes(RUST_GATE_SCRIPT) || !rustPatterns.includes(SERVER_GATE_SCRIPT)) {
        throw new Error('the rust scope must claim the rust and collaboration server gate scripts');
    }
    if (!scopeFilterPatterns(candidate, 'server').includes(SERVER_GATE_SCRIPT)) {
        throw new Error('the server scope must claim the collaboration server gate script');
    }
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

// The decide filter runs twice by design: a transient changed-files API
// failure must not fail the job, yet a persistent one must. The first attempt
// may fail softly only because the retry re-runs the identical filter, and
// `Resolve scope` coalesces the retry's verdicts first and refuses one neither
// attempt produced — drop any of those legs and an API outage either blocks
// Gate again or reads as an all-false scope that silently skips every lane.
function assertDecideFilterRetryContract(candidate: UnknownRecord): void {
    const decide = jobAt(candidate, 'decide');
    const firstAttempt = stepNamed(decide, PATHS_FILTER_FIRST_ATTEMPT_STEP);
    if (firstAttempt.id !== 'filter') {
        throw new Error('the first paths-filter attempt must retain the filter step id its retry keys on');
    }
    if (firstAttempt['continue-on-error'] !== true) {
        throw new Error(
            'the first paths-filter attempt must continue on error so its retry can absorb a transient API failure'
        );
    }
    if (firstAttempt.uses !== PATHS_FILTER_ACTION) {
        throw new Error('the first paths-filter attempt must stay on its pinned action revision');
    }
    const retry = stepNamed(decide, PATHS_FILTER_RETRY_STEP);
    if (retry.id !== 'filter-retry') {
        throw new Error(
            'the retry paths-filter attempt must retain the filter-retry step id the scope coalescing reads'
        );
    }
    if (retry.if !== PATHS_FILTER_RETRY_CONDITION) {
        throw new Error('the retry must run exactly when the first paths-filter attempt failed');
    }
    if (retry.uses !== PATHS_FILTER_ACTION) {
        throw new Error('the retry must pin the same paths-filter action revision as the first attempt');
    }
    if (JSON.stringify(retry.with) !== JSON.stringify(firstAttempt.with)) {
        throw new Error("the retry must duplicate the first attempt's filter options verbatim");
    }
    const scopeEnv = recordAt(stepNamed(decide, 'Resolve scope'), 'env');
    for (const [name, output] of PATHS_FILTER_VERDICT_ENV) {
        if (scopeEnv[name] !== `\${{ steps.filter-retry.outputs.${output} || steps.filter.outputs.${output} }}`) {
            throw new Error(`the ${name} verdict must coalesce the retry attempt before the first attempt`);
        }
    }
}

function assertProseSkippingJobs(candidate: UnknownRecord): void {
    for (const jobName of ['lint', 'boundaries']) {
        if (jobAt(candidate, jobName).if !== CODE_CONDITION) {
            throw new Error(`${jobName} must skip a head that carries only prose`);
        }
    }
    if (jobAt(candidate, 'static').if !== undefined) {
        throw new Error(
            'wasm freshness and the script contracts answer to prose-classified changes, so static must stay unconditional'
        );
    }
}

function assertContainerBrowserRuntime(job: UnknownRecord, label: string, jobMinutes: number): void {
    const importer = recordAt(recordAt(lockfile, 'importers'), '.');
    const version = stringAt(recordAt(recordAt(importer, 'devDependencies'), 'playwright'), 'version');
    const image = `mcr.microsoft.com/playwright:v${version}-noble@${PLAYWRIGHT_IMAGE_DIGEST}`;
    if (JSON.stringify(job.container) !== JSON.stringify({ image, options: '--init --ipc=host' })) {
        throw new Error(`${label} must use the locked Playwright image and digest without extra container authority`);
    }
    if (JSON.stringify(job.defaults) !== JSON.stringify({ run: { shell: 'bash' } })) {
        throw new Error(`${label} must preserve bash in its container`);
    }
    if (job['timeout-minutes'] !== jobMinutes) {
        throw new Error(`${label} must keep its job limit at exactly ${jobMinutes} minutes`);
    }
    const proof = stepNamed(job, BROWSER_RUNTIME_STEP);
    if (proof.run !== `node scripts/verifyPlaywrightRuntime.ts ${version}` || proof['timeout-minutes'] !== 2) {
        throw new Error(`${label} must launch and check the resolved browser within two minutes`);
    }
    const steps = arrayAt(job, 'steps').map((step) => asRecord(step, `${label} step`));
    for (const step of steps) {
        if (
            typeof step.run === 'string' &&
            /\bapt(?:-get)?\b|playwright\s+install|aptWithoutMicrosoftFeed|hostedAptInstall/.test(step.run)
        ) {
            throw new Error(`${label} must not acquire browser packages or binaries at runtime`);
        }
        if (step.shell !== undefined && step.shell !== 'bash') {
            throw new Error(`${label} must preserve bash in its container`);
        }
    }
    const run = stepNamed(job, label === 'the offline smoke job' ? 'Run offline smoke set' : 'Run shard');
    if (
        steps.indexOf(proof) !== steps.findIndex((step) => step.name === 'Install dependencies') + 1 ||
        steps.indexOf(run) !== steps.indexOf(proof) + 1 ||
        run.if !== undefined ||
        run['continue-on-error'] !== undefined ||
        proof.if !== undefined ||
        proof['continue-on-error'] !== undefined
    ) {
        throw new Error(
            `${label} must prove the runtime before running its browser tests without conditional admission`
        );
    }
}

// A hung apt never exits, so a retry loop alone never retries (#5072): every
// attempt carries a root-side deadline, the step a limit that holds all
// attempts plus backoff below its job's limit, and the loop ends in the exit
// that fails the step.
function assertBoundedAlsaInstall(job: UnknownRecord, label: string): void {
    const step = stepNamed(job, 'Install ALSA development headers');
    const run = stringAt(step, 'run');
    if (!run.includes(FILTERED_ALSA_INSTALL)) {
        throw new Error(`${label} must run the ALSA header install through the Microsoft apt feed filter`);
    }
    if (run !== `set -euo pipefail\n${ALSA_INSTALL_COMMAND}\n`) {
        throw new Error(`${label} must run one bounded ALSA transaction and propagate its failure`);
    }
    const stepTimeoutMinutes = step['timeout-minutes'];
    if (typeof stepTimeoutMinutes !== 'number' || stepTimeoutMinutes * 60 <= ALSA_INSTALL_WORST_CASE_SECONDS) {
        throw new Error(`${label} must carry a step limit that holds one bounded ALSA transaction`);
    }
    const jobTimeoutMinutes = job['timeout-minutes'];
    if (typeof jobTimeoutMinutes !== 'number' || stepTimeoutMinutes >= jobTimeoutMinutes) {
        throw new Error(`${label} must keep the ALSA step limit below its job limit`);
    }
}

function assertLintTimeBudgets(candidate: UnknownRecord): void {
    const lint = jobAt(candidate, 'lint');
    if (stepNamed(lint, 'Checkout')['timeout-minutes'] !== 10) {
        throw new Error('lint checkout must have a ten-minute timeout');
    }
    const prep = ['Set up pnpm', 'Set up Node', 'Install dependencies'];
    for (const name of prep) {
        if (stepNamed(lint, name)['timeout-minutes'] !== 5) {
            throw new Error(`lint step ${name} must have a five-minute timeout`);
        }
    }
    if (stepNamed(lint, 'Lint')['timeout-minutes'] !== 20) {
        throw new Error('lint execution must have a twenty-minute timeout');
    }
    const jobTimeout = lint['timeout-minutes'];
    const stepTotal = 10 + prep.length * 5 + 20;
    if (typeof jobTimeout !== 'number' || jobTimeout < stepTotal + 5 || jobTimeout > 50) {
        throw new Error('lint job must include five minutes for cleanup after all step budgets');
    }
}

function assertOfflineSmokeJob(candidate: UnknownRecord): void {
    const smoke = jobAt(candidate, 'smoke');
    if (smoke.needs !== 'decide' || smoke.if !== SMOKE_CONDITION) {
        throw new Error('the offline smoke job must run on every pull-request run that touches the browser surface');
    }
    assertContainerBrowserRuntime(smoke, 'the offline smoke job', SMOKE_JOB_MINUTES);
    if (stringAt(stepNamed(smoke, 'Run offline smoke set'), 'run') !== SMOKE_COMMAND) {
        throw new Error('the offline smoke job must run the smoke spec without retries');
    }
}

function assertBoundedHeavyE2eInstall(candidate: UnknownRecord): void {
    assertContainerBrowserRuntime(jobAt(candidate, 'e2e'), 'the heavy E2E job', E2E_JOB_MINUTES);
}

function fixtureGit(directory: string, args: string[]): string {
    const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', directory, ...args], {
        encoding: 'utf8',
        env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    });
    if (result.error || result.status !== 0) {
        throw new Error(`Git fixture ${args[0]} failed: ${result.error?.message ?? result.stderr}`);
    }
    return result.stdout.trim();
}

function withPrSecretHistory(
    run: (fixture: { root: string; source: string; remote: string; base: string; head: string }) => void
): void {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-pr-secret-history-'));
    const source = join(root, 'source');
    mkdirSync(source);
    try {
        const git = (...args: string[]) => fixtureGit(source, args);
        const commit = (name: string) => {
            git('add', '.');
            git(
                '-c',
                'user.name=Fixture',
                '-c',
                'user.email=fixture@example.invalid',
                '-c',
                'commit.gpgsign=false',
                'commit',
                '-m',
                name
            );
            return git('rev-parse', 'HEAD');
        };
        const credential = ['AKIA', 'QAZ2WSX3', 'EDC4RFV5'].join('');
        git('init', '--initial-branch=main');
        writeFileSync(join(source, 'excluded-common.txt'), `aws_access_key_id = "${credential}"\n`);
        writeFileSync(join(source, 'conflict.txt'), 'common\n');
        commit('common ancestor excluded by base');
        git('checkout', '-b', 'pr');
        writeFileSync(join(source, 'intermediate.txt'), `aws_access_key_id = "${credential}"\n`);
        commit('intermediate credential');
        git('rm', 'intermediate.txt');
        commit('remove intermediate credential');
        git('checkout', '-b', 'side');
        writeFileSync(join(source, 'side.txt'), `aws_access_key_id = "${credential}"\n`);
        writeFileSync(join(source, 'conflict.txt'), 'side\n');
        commit('side parent credential');
        git('checkout', 'pr');
        writeFileSync(join(source, 'conflict.txt'), 'pr\n');
        commit('other merge parent');
        const merge = spawnSync(
            'git',
            [
                '-C',
                source,
                '-c',
                'user.name=Fixture',
                '-c',
                'user.email=fixture@example.invalid',
                'merge',
                '--no-ff',
                '--no-commit',
                'side',
            ],
            { encoding: 'utf8' }
        );
        expect(merge.status).toBe(1);
        writeFileSync(join(source, 'conflict.txt'), `aws_access_key_id = "${credential}"\n`);
        const head = commit('merge resolution credential');
        git('checkout', 'main');
        writeFileSync(join(source, 'base-only.txt'), 'newer divergent base\n');
        const base = commit('pinned newer base');
        writeFileSync(join(source, 'moved-base.txt'), 'not the pinned base\n');
        commit('base branch moved');
        git('checkout', 'pr');
        writeFileSync(join(source, 'moved-head.txt'), 'not the pinned head\n');
        commit('head branch moved');
        git('checkout', '-b', 'unrelated', 'main');
        writeFileSync(join(source, 'unrelated.txt'), 'outside both pinned histories\n');
        commit('unrelated branch');
        git('tag', 'unrelated-tag');
        const remote = join(root, 'remote.git');
        git('clone', '--bare', source, remote);
        run({ root, source, remote, base, head });
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

function acquirePrSecretHistory(
    fixture: { root: string; remote: string; base: string; head: string },
    candidate: UnknownRecord,
    overrides: { base?: string; head?: string; run?: string; depth?: number } = {}
) {
    const directory = mkdtempSync(join(fixture.root, 'target-'));
    const checkout = recordAt(stepNamed(jobAt(candidate, 'pr-secrets'), 'Checkout scan target'), 'with');
    const depth = overrides.depth ?? checkout['fetch-depth'];
    fixtureGit(directory, ['init', '--initial-branch=main']);
    fixtureGit(directory, ['remote', 'add', 'origin', pathToFileURL(fixture.remote).href]);
    // Mirror the pinned checkout action's depth-dependent refspec, using real Git transport.
    const refs =
        depth === 0
            ? ['+refs/heads/*:refs/remotes/origin/*', '+refs/tags/*:refs/tags/*']
            : [`--depth=${String(depth)}`, fixture.head];
    fixtureGit(directory, ['fetch', '--no-tags', 'origin', ...refs]);
    fixtureGit(directory, ['checkout', '--detach', fixture.head]);
    const script =
        overrides.run ?? stringAt(stepNamed(jobAt(candidate, 'pr-secrets'), 'Fetch immutable base SHA'), 'run');
    const result = spawnSync('bash', ['-c', script], {
        cwd: directory,
        encoding: 'utf8',
        env: { ...process.env, BASE_SHA: overrides.base ?? fixture.base, HEAD_SHA: overrides.head ?? fixture.head },
    });
    return { directory, result };
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
        trustedScanner['persist-credentials'] !== false ||
        trustedScanner['sparse-checkout'] !== '/.gitleaks.toml\n/.gitleaksignore\n' ||
        trustedScanner['sparse-checkout-cone-mode'] !== false
    ) {
        throw new Error('pull-request scanner config must come from the trusted base and retain no credentials');
    }
    // This job always carries a pull request, so its scan target pins the head
    // SHA outright rather than the history job's event-SHA fallback.
    const scanTarget = recordAt(stepNamed(prSecrets, 'Checkout scan target'), 'with');
    if (
        scanTarget.ref !== '${{ github.event.pull_request.head.sha }}' ||
        scanTarget.path !== 'scan-target' ||
        scanTarget['fetch-depth'] !== 1 ||
        scanTarget['persist-credentials'] !== false
    ) {
        throw new Error('pull-request scan target must bootstrap only the pinned head without credentials');
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
    for (const name of Object.keys(FORCED_SCOPE_OUTPUTS)) {
        const reference = `\${{ steps.scope.outputs.${name} }}`;
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

/**
 * Discovered once per run. The parity test reaches this through `assertNativeParityJob` several
 * times, and re-reading every spec file under `src` on each call put the test past Vitest's default
 * timeout on a loaded shared volume while the tree it reads cannot change during a run.
 */
const addonLoadingSpecCache = new Map<string, readonly string[]>();

function addonLoadingSpecs(directory: string): string[] {
    const cached = addonLoadingSpecCache.get(directory);
    if (cached !== undefined) {
        return [...cached];
    }
    const discovered = readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            return addonLoadingSpecs(path);
        }
        if (!/\.spec\.tsx?$/u.test(entry.name) || !readFileSync(path, 'utf8').includes(NATIVE_ADDON_IMPORT)) {
            return [];
        }
        return [relative(repositoryRoot, path).split(sep).join('/')];
    });
    addonLoadingSpecCache.set(directory, discovered);
    return [...discovered];
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

type CargoIndexCacheStep = { job: string; key: string; restorePrefixes: string[] };

// Substitutes the per-job expression with the value each job evaluates it to,
// so two templates that differ only by embedding `${{ github.job }}` compare
// as the distinct runtime keys they are, while two jobs sharing the unscoped
// form compare equal — the collision.
function runtimeKeyShape(key: string, job: string): string {
    return key.split(JOB_SCOPE_EXPRESSION).join(job);
}

function cargoIndexCacheSteps(candidate: UnknownRecord): CargoIndexCacheStep[] {
    const found: CargoIndexCacheStep[] = [];
    for (const [jobId, jobValue] of Object.entries(recordAt(candidate, 'jobs'))) {
        const job = asRecord(jobValue, `${jobId} job`);
        const steps = job.steps === undefined ? [] : arrayAt(job, 'steps');
        for (const step of steps) {
            const stepRecord = asRecord(step, 'step');
            if (typeof stepRecord.uses !== 'string' || !stepRecord.uses.startsWith(CACHE_ACTION_USES_PREFIX)) {
                continue;
            }
            if (stepRecord.with === null || typeof stepRecord.with !== 'object' || Array.isArray(stepRecord.with)) {
                continue;
            }
            const stepWith = asRecord(stepRecord.with, 'with');
            const key = stepWith.key;
            if (typeof key !== 'string' || !key.startsWith(CARGO_INDEX_KEY_PREFIX)) {
                continue;
            }
            const restoreKeys = stepWith['restore-keys'];
            found.push({
                job: jobId,
                key,
                restorePrefixes:
                    typeof restoreKeys === 'string'
                        ? restoreKeys.split('\n').filter((line) => line.trim().length > 0)
                        : [],
            });
        }
    }
    return found;
}

/**
 * The recorded snapshot re-records in lockstep with the workflow it pins, so a
 * cargo-index key reverted from the per-job form would re-bless itself green.
 * This reads the parsed workflow directly: no two jobs may share a runtime key
 * or restore prefix — the poisoning race the per-job scoping exists to end —
 * and every key and restore line must carry the per-job expression that keeps
 * them distinct at runtime. The equality clauses run before the expression
 * checks so each can be observed failing on its own mutation.
 */
function assertCargoIndexCacheKeysJobScoped(candidate: UnknownRecord): void {
    const cargoIndexSteps = cargoIndexCacheSteps(candidate);
    if (cargoIndexSteps.length === 0) {
        throw new Error('the cargo registry index cache layer must keep a keyed actions/cache step');
    }
    for (const [index, entry] of cargoIndexSteps.entries()) {
        const entryShape = runtimeKeyShape(entry.key, entry.job);
        const entryPrefixes = entry.restorePrefixes.map((prefix) => runtimeKeyShape(prefix, entry.job));
        for (const other of cargoIndexSteps.slice(index + 1)) {
            if (other.job === entry.job) {
                continue;
            }
            const otherShape = runtimeKeyShape(other.key, other.job);
            const otherPrefixes = other.restorePrefixes.map((prefix) => runtimeKeyShape(prefix, other.job));
            if (otherShape === entryShape) {
                throw new Error(`the ${entry.job} and ${other.job} cargo-index cache keys must differ per job`);
            }
            for (const prefix of entryPrefixes) {
                if (otherPrefixes.includes(prefix)) {
                    throw new Error(`the ${entry.job} and ${other.job} cargo-index restore keys must differ per job`);
                }
            }
        }
    }
    for (const entry of cargoIndexSteps) {
        if (!entry.key.includes(JOB_SCOPE_EXPRESSION)) {
            throw new Error(`the ${entry.job} cargo-index cache key must embed ${JOB_SCOPE_EXPRESSION}`);
        }
        for (const prefix of entry.restorePrefixes) {
            if (!prefix.includes(JOB_SCOPE_EXPRESSION)) {
                throw new Error(`the ${entry.job} cargo-index restore keys must embed ${JOB_SCOPE_EXPRESSION}`);
            }
        }
    }
}

function assertNativeTransportMutationProof(candidate: UnknownRecord): void {
    const job = jobAt(candidate, 'native-macos');
    expect(job['runs-on']).toBe('macos-latest');
    expect(recordAt(stepNamed(job, 'Checkout'), 'with')).toEqual({
        'fetch-depth': 0,
        'persist-credentials': false,
    });
    expect(recordAt(stepNamed(job, 'Cache cargo build'), 'with')).toEqual({ 'save-if': 'false' });
    const setup = stepNamed(job, 'Set up Node for native mutation proof');
    expect(setup.uses).toBe('actions/setup-node@820762786026740c76f36085b0efc47a31fe5020');
    expect(recordAt(setup, 'with')).toEqual({ 'node-version': '24.19.0' });
    const probe = stepNamed(job, 'Verify native transport mutation sensitivity');
    expect(probe.run).toBe('node scripts/verifyNativeTransportMutations.ts');
    expect(probe.id).toBe('native-mutations');
    expect(probe['timeout-minutes']).toBe(20);
    expect(probe.if).toBeUndefined();
    expect(probe['continue-on-error']).toBeUndefined();
    expect(probe['working-directory']).toBeUndefined();
    expect(recordAt(probe, 'env')).toEqual({
        HEAD_SHA: '${{ github.event.pull_request.head.sha }}',
        BASE_SHA: '${{ github.event.pull_request.base.sha }}',
    });
    const upload = stepNamed(job, 'Upload native transport mutation evidence');
    expect(upload.if).toBe('${{ always() }}');
    expect(upload['continue-on-error']).toBeUndefined();
    expect(upload.uses).toBe('actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a');
    expect(recordAt(upload, 'with')).toEqual({
        name: 'native-transport-mutations-${{ github.event.pull_request.head.sha }}',
        path: '.agents/artifacts/native-transport-mutations/',
        'if-no-files-found': 'error',
        'retention-days': 7,
    });
    const names = arrayAt(job, 'steps').map((step) => asRecord(step, 'step').name);
    expect(names.indexOf('Test the native crate')).toBeLessThan(names.indexOf('Set up Node for native mutation proof'));
    expect(names.indexOf('Set up Node for native mutation proof')).toBeLessThan(names.indexOf(probe.name));
    expect(names.indexOf(probe.name)).toBeLessThan(names.indexOf(upload.name));
}

function assertCargoDependencySeed(seed: UnknownRecord, consumer: UnknownRecord): void {
    expect(Object.keys(recordAt(seed, 'on'))).toEqual(['push']);
    const push = recordAt(recordAt(seed, 'on'), 'push');
    expect(push.branches).toEqual(['main']);
    expect(push.paths).toEqual([
        '.github/workflows/cargo-dependency-seed.yml',
        '.github/workflows/validation.yml',
        'scripts/ensurePinnedRustToolchain.sh',
        'Cargo.lock',
        '**/Cargo.toml',
        '.cargo/config.toml',
        'rust-toolchain.toml',
    ]);
    expect(seed.permissions).toEqual({ contents: 'read' });
    expect(Object.keys(recordAt(seed, 'jobs'))).toEqual(['rust', 'native-macos']);
    expect(JSON.stringify(seed)).not.toMatch(/secrets\.|"environment"|pnpm deliver|vercel/iu);

    const linuxSeed = jobAt(seed, 'rust');
    const linuxConsumer = jobAt(consumer, 'rust');
    const nativeSeed = jobAt(seed, 'native-macos');
    const nativeConsumer = jobAt(consumer, 'native-macos');
    for (const [job, runner] of [
        [linuxSeed, 'ubuntu-latest'],
        [nativeSeed, 'macos-latest'],
    ] as const) {
        expect(job['runs-on']).toBe(runner);
        expect(job.if).toBe("github.ref == 'refs/heads/main'");
        expect(job['timeout-minutes']).toBe(60);
        expect(stepNamed(job, 'Checkout').uses).toBe('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1');
        expect(stepNamed(job, 'Cache cargo build').uses).toBe(
            'Swatinem/rust-cache@6323deb102c322ba6fcbdcafc7e3dddab59af2b6'
        );
    }
    const linuxSeedNames = arrayAt(linuxSeed, 'steps').map((step) => asRecord(step, 'step').name);
    expect(linuxSeedNames).toEqual([
        'Checkout',
        'Install ALSA development headers',
        'Restore pinned Rust toolchain',
        'Install the pinned Rust toolchain',
        'Cache cargo build',
        'Cache Cargo dependencies',
        'Rust workspace health gates',
    ]);
    const nativeSeedNames = arrayAt(nativeSeed, 'steps').map((step) => asRecord(step, 'step').name);
    expect(nativeSeedNames).toEqual([
        'Checkout',
        'Install the pinned Rust toolchain',
        'Cache cargo build',
        'Cache the cargo registry index',
        'Test the audio crates',
        'Test the native crate',
    ]);
    expect(stepNamed(linuxSeed, 'Rust workspace health gates').run).toBe('sh scripts/health-gates-rust.sh');
    expect(stepNamed(nativeSeed, 'Test the audio crates').run).toBe(
        'cargo test --package daw-core --package daw-dsp --package daw-engine --all-features'
    );
    expect(stepNamed(nativeSeed, 'Test the native crate').run).toBe('cargo test --package sourdaw-native');

    for (const job of [linuxSeed, linuxConsumer]) {
        const cache = stepNamed(job, 'Cache Cargo dependencies');
        expect(cache.uses).toBe('actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830');
        const options = recordAt(cache, 'with');
        expect(options.path).toBe(CARGO_DEPENDENCY_PATH);
        expect(options.key).toBe(CARGO_DEPENDENCY_KEY);
    }
    expect(stepNamed(linuxConsumer, 'Cache Cargo dependencies').id).toBe('cargo-deps');
    const linuxConsumerNames = arrayAt(linuxConsumer, 'steps').map((step) => asRecord(step, 'step').name);
    expect(linuxConsumerNames.indexOf('Cache cargo build')).toBeLessThan(
        linuxConsumerNames.indexOf('Cache Cargo dependencies')
    );
    expect(linuxConsumerNames.indexOf('Cache Cargo dependencies')).toBeLessThan(
        linuxConsumerNames.indexOf('Server and Rust workspace health gates')
    );
    const linuxHealth = stepNamed(linuxConsumer, 'Server and Rust workspace health gates');
    expect(linuxHealth.run).toBe('pnpm health:server:full');
    expect(recordAt(linuxHealth, 'env')).toEqual({
        CARGO_HTTP_MULTIPLEXING: 'false',
        CARGO_NET_OFFLINE: CARGO_OFFLINE_EXACT,
    });

    for (const job of [nativeSeed, nativeConsumer]) {
        const cache = stepNamed(job, 'Cache the cargo registry index');
        expect(cache.id).toBe('cargo-index');
        expect(cache.uses).toBe('actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830');
        expect(recordAt(cache, 'with')).toEqual({
            path: '~/.cargo/registry/index',
            key: CARGO_INDEX_KEY,
            'restore-keys': CARGO_INDEX_RESTORE,
        });
    }
    for (const name of ['Test the audio crates', 'Test the native crate']) {
        expect(recordAt(stepNamed(nativeConsumer, name), 'env').CARGO_NET_OFFLINE).toBe(NATIVE_OFFLINE_EXACT);
    }
}

type WorkflowSet = {
    health: UnknownRecord;
    prChecks: UnknownRecord;
    validation: UnknownRecord;
    cargoDependencySeed: UnknownRecord;
    heavy: UnknownRecord;
    nightly: UnknownRecord;
    nightlyEvidenceReporter: UnknownRecord;
    hostedQuantumMeasurement: UnknownRecord;
    hostedWasm: UnknownRecord;
};

function workflowSet(): WorkflowSet {
    return {
        health: workflow,
        prChecks: prChecksWorkflow,
        validation: validationWorkflow,
        cargoDependencySeed,
        heavy: heavyWorkflow,
        nightly,
        nightlyEvidenceReporter,
        hostedQuantumMeasurement,
        hostedWasm,
    };
}

function cloneWorkflows(label: string): WorkflowSet {
    const clone = structuredClone(workflowSet());
    return {
        health: asRecord(clone.health, `${label} health`),
        prChecks: asRecord(clone.prChecks, `${label} PR checks`),
        validation: asRecord(clone.validation, `${label} validation`),
        cargoDependencySeed: asRecord(clone.cargoDependencySeed, `${label} cargo dependency seed`),
        heavy: asRecord(clone.heavy, `${label} heavy`),
        nightly: asRecord(clone.nightly, `${label} nightly`),
        nightlyEvidenceReporter: asRecord(clone.nightlyEvidenceReporter, `${label} nightly evidence reporter`),
        hostedQuantumMeasurement: asRecord(clone.hostedQuantumMeasurement, `${label} hosted quantum measurement`),
        hostedWasm: asRecord(clone.hostedWasm, `${label} hosted WASM`),
    };
}

// Both suites owe a scope condition that makes a skip legitimate and a run
// step that fails its job. Each reaches the required Gate through a caller.
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
        ['pr-checks.yml', set.prChecks],
        ['validation.yml', set.validation],
        ['cargo-dependency-seed.yml', set.cargoDependencySeed],
        ['heavy-gates.yml', set.heavy],
        ['nightly.yml', set.nightly],
        ['nightly-evidence-report.yml', set.nightlyEvidenceReporter],
        ['quantum-measurements.yml', set.hostedQuantumMeasurement],
        ['wasm-artifacts.yml', set.hostedWasm],
    ];
}

function jobSteps(file: string, jobId: string, job: UnknownRecord): UnknownRecord[] {
    return job.steps === undefined
        ? []
        : arrayAt(job, 'steps').map((step) => asRecord(step, `${file} job ${jobId} step`));
}

// Commands that run apt on a hosted runner: apt itself, Playwright's system
// dependency install, and its Chrome channel install script.
const APT_COMMAND =
    /\bapt-get\b|\bapt\s+(?:update|install)\b|playwright install-deps|--with-deps|playwright install --force chrome/;

// A new or edited apt route that skips the filter fails on the next Microsoft
// feed 403 (#5359), so every apt-invoking command line must carry it.
function assertAptRoutesFiltered(set: WorkflowSet): void {
    for (const [file, parsed] of workflowFiles(set)) {
        for (const [jobId, job] of Object.entries(recordAt(parsed, 'jobs'))) {
            for (const step of jobSteps(file, jobId, asRecord(job, `${file} job ${jobId}`))) {
                if (typeof step.run !== 'string') {
                    continue;
                }
                for (const line of step.run.split('\n')) {
                    if (APT_COMMAND.test(line) && !line.includes(APT_FEED_FILTER)) {
                        throw new Error(
                            `${file} job ${jobId} step ${String(step.name)} must run apt through the Microsoft apt feed filter`
                        );
                    }
                }
            }
        }
    }
}

function stepLabel(file: string, jobId: string, step: UnknownRecord): string {
    const name = typeof step.name === 'string' ? step.name : '<unnamed>';
    return `${file} job ${jobId} step ${name}`;
}

// A `continue-on-error` on any job concludes it success whatever its steps
// proved, and one on any step reports that step green whatever it ran. The
// position-enumerated pins above each cover one named job or step; the sweep
// covers every job in every file, because a softened leg reports a failing
// proof as a passing summary wherever it lands. The single pinned exception is
// the first paths-filter attempt, whose softening only hands the question to
// its retry and the Resolve scope verdict guard.
function assertNoContinueOnError(set: WorkflowSet): void {
    const pins = new Map(
        CONTINUE_ON_ERROR_STEP_PINS.map((entry) => [`${entry.workflow}${entry.job}${entry.step}`, entry] as const)
    );
    for (const [file, candidate] of workflowFiles(set)) {
        for (const [jobId, jobValue] of Object.entries(recordAt(candidate, 'jobs'))) {
            const job = asRecord(jobValue, `${file} job ${jobId}`);
            if (job['continue-on-error'] !== undefined) {
                throw new Error(`${file} job ${jobId} must not continue on error`);
            }
            for (const step of jobSteps(file, jobId, job)) {
                if (step['continue-on-error'] === undefined) {
                    continue;
                }
                const label = stepLabel(file, jobId, step);
                const pin = pins.get(`${file}${jobId}${typeof step.name === 'string' ? step.name : ''}`);
                if (pin === undefined || step['continue-on-error'] !== true) {
                    throw new Error(`${label} must not continue on error`);
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
    const pinned = new Map<string, ConditionalStepPin>(
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
// workflow-level pin: `contents: write` on a validation leg would hand every
// pull request a token that can push.
function assertNoJobLevelPermissions(set: WorkflowSet): void {
    assertJobLevelPermissions(Object.fromEntries(workflowFiles(set)));
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
// hand the pull-request workflow a token that can push,
// and dropping `security-events: write` would fail the upload on the head.
function assertRequiredCodeQlPermissions(candidate: UnknownRecord): void {
    for (const [jobId, value] of Object.entries(recordAt(candidate, 'jobs'))) {
        if (jobId !== 'codeql' && asRecord(value, jobId).permissions !== undefined) {
            throw new Error(`the ${jobId} job must inherit read-only workflow permissions`);
        }
    }
    const permissions = recordAt(jobAt(candidate, 'codeql'), 'permissions');
    if (
        permissions.contents !== 'read' ||
        permissions['security-events'] !== 'write' ||
        permissions.actions !== 'read' ||
        Object.keys(permissions).length !== 3
    ) {
        throw new Error(
            'the required CodeQL job must grant exactly contents: read, security-events: write, and actions: read'
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
// and it prefers the newest run of that name. So only a labeled `pull_request`
// run of `health-gates.yml` may mint that name, `gate` must be unable to skip,
// and it must fail unless the reviewer App approved the exact head.
function assertRequiredCheckIsolation(set: WorkflowSet): void {
    assertApprovalGatedRequiredCheck(Object.fromEntries(workflowFiles(set)));
    if (JSON.stringify(Object.keys(recordAt(set.heavy, 'on')).sort()) !== JSON.stringify([...HEAVY_GATES_TRIGGERS])) {
        throw new Error('heavy-gates.yml must be reusable-only');
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
    assertRequiredScopePlan(set.health);
    const dependencyReview = jobAt(set.validation, 'dependency-review');
    if (dependencyReview.needs !== 'decide' || dependencyReview.if !== PULL_REQUEST_PAYLOAD_CONDITION) {
        throw new Error('dependency review must gate on the pull request payload rather than the triggering event');
    }
    if (stepNamed(dependencyReview, 'Review dependency changes').uses !== DEPENDENCY_REVIEW_ACTION) {
        throw new Error('dependency review action must remain pinned');
    }
    const health = set.health;
    if (jobAt(health, 'validation').uses !== VALIDATION_CALL || jobAt(health, 'validation').needs !== 'scope') {
        throw new Error('required validation must consume the affected scope');
    }
    if (jobAt(health, 'validation').if !== undefined) {
        throw new Error('required validation must run on every pull request');
    }
    if (
        recordAt(jobAt(health, 'validation'), 'with').browser !== "${{ needs.scope.outputs.browser == 'true' }}" ||
        recordAt(jobAt(health, 'validation'), 'with').profile !== '${{ needs.scope.outputs.profile }}' ||
        recordAt(jobAt(health, 'validation'), 'with').mode !== 'full'
    ) {
        throw new Error('required browser smoke must consume the affected scope');
    }
    const browserInput = recordAt(recordAt(recordAt(set.validation, 'on'), 'workflow_call'), 'inputs');
    if (
        JSON.stringify(browserInput.browser) !==
        JSON.stringify({
            description: 'Whether the affected plan requires browser smoke.',
            required: true,
            type: 'boolean',
        })
    ) {
        throw new Error('shared validation must require the affected browser decision');
    }
    if (
        JSON.stringify(browserInput.mode) !==
        JSON.stringify({
            description: 'Full required validation or preliminary push validation.',
            required: false,
            default: 'full',
            type: 'string',
        })
    ) {
        throw new Error('shared validation must default to full');
    }
    const affected = jobAt(health, 'affected');
    if (
        affected.uses !== './.github/workflows/heavy-gates.yml' ||
        JSON.stringify(affected.needs) !== JSON.stringify(['scope', 'validation'])
    ) {
        throw new Error('required affected E2E must wait for scope and successful validation');
    }
    if (
        recordAt(affected, 'with').matrix !== '${{ needs.scope.outputs.matrix }}' ||
        recordAt(affected, 'with')['browser-ai'] !== "${{ needs.scope.outputs.browser-ai == 'true' }}"
    ) {
        throw new Error('required affected E2E must consume the selected matrix and hardware scope');
    }
    const codeql = jobAt(health, 'codeql');
    if (codeql.needs !== 'scope' || codeql.if !== "needs.scope.outputs.codeql == 'true'") {
        throw new Error('required CodeQL must answer to the selected security scope');
    }
    if (Object.keys(recordAt(set.heavy, 'jobs')).some((job) => ['validation', 'codeql', 'secrets'].includes(job))) {
        throw new Error('reusable browser checks must not repeat validation or security scans');
    }
    if (JSON.stringify(Object.keys(recordAt(set.validation, 'jobs'))) !== JSON.stringify([...VALIDATION_JOBS])) {
        throw new Error('validation.yml must hold exactly the pinned job list, in order');
    }
    assertBlockingSuites(set);
    assertNightlySecurityGraph(set.nightly);
    assertNightlyReportCoverage(set);
    assertDeviceWriteBoundaryCensus(set);
    assertSummaryMembership(set);
    assertRequiredScopePlan(set.prChecks);
    if (JSON.stringify(Object.keys(recordAt(set.prChecks, 'jobs'))) !== JSON.stringify(['scope', 'validation'])) {
        throw new Error('pr-checks.yml must run only the scope plan and the validation lane');
    }
    const pushValidation = jobAt(set.prChecks, 'validation');
    if (
        pushValidation.uses !== VALIDATION_CALL ||
        pushValidation.needs !== 'scope' ||
        JSON.stringify(pushValidation.with) !==
            JSON.stringify({ ...recordAt(jobAt(set.health, 'validation'), 'with'), mode: 'preliminary' })
    ) {
        throw new Error('push validation must consume the affected scope exactly as the required lane does');
    }
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
        const expectedCondition = label.startsWith('validation.yml')
            ? "needs.decide.outputs.tooling != 'true'"
            : undefined;
        if (step.if !== expectedCondition) {
            throw new Error(`${label} device write boundary census must retain its scope condition`);
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

// The nightly's split of the combined Rust job (#3516): each leg answers to
// exactly one scope and runs exactly its own gate script. The seam matters
// because the deploy waits on the crate leg and not the server leg — a job
// that straddles it, or a gate command that silently recombines the two, puts
// the old cross-coupled failure back behind green-looking pins.
function assertNightlyRustServerSplit(candidate: UnknownRecord): void {
    const rust = jobAt(candidate, NIGHTLY_RUST_JOB);
    if (rust.needs !== 'decide' || rust.if !== NIGHTLY_RUST_CONDITION) {
        throw new Error('the nightly Rust workspace leg must answer to the Rust scope alone');
    }
    if (stringAt(stepNamed(rust, NIGHTLY_RUST_GATE_STEP), 'run') !== NIGHTLY_RUST_GATE_COMMAND) {
        throw new Error('the nightly Rust workspace leg must run the split Rust gate script');
    }
    const collabServer = jobAt(candidate, COLLAB_SERVER_JOB);
    if (collabServer.name !== COLLAB_SERVER_JOB_NAME) {
        throw new Error('the collaboration server leg must retain its stable name');
    }
    if (collabServer.needs !== 'decide' || collabServer.if !== COLLAB_SERVER_CONDITION) {
        throw new Error('the collaboration server leg must answer to the server scope alone');
    }
    if (stringAt(stepNamed(collabServer, COLLAB_SERVER_GATE_STEP), 'run') !== COLLAB_SERVER_GATE_COMMAND) {
        throw new Error('the collaboration server leg must run the server gate script');
    }
}

function assertSummaryMembership(set: WorkflowSet): void {
    const gateNeeds = arrayAt(jobAt(set.health, 'gate'), 'needs');
    for (const job of GATE_MEMBERS) {
        if (!gateNeeds.includes(job)) {
            throw new Error(`gate must depend on ${job}`);
        }
    }
    if (gateNeeds.length !== GATE_MEMBERS.length) {
        throw new Error('gate must depend on exactly the pinned member list');
    }
    const heavyGate = jobAt(set.heavy, 'heavy-gate');
    if (heavyGate.name !== HEAVY_SUMMARY_NAME || heavyGate.if !== HEAVY_GATE_CONDITION) {
        throw new Error('the reusable browser summary must retain its non-skipping condition');
    }
    if (JSON.stringify(arrayAt(heavyGate, 'needs')) !== JSON.stringify([...HEAVY_GATE_MEMBERS])) {
        throw new Error('HeavyGate must depend on exactly the pinned member list');
    }
}

function assertUnitProvenanceHistory(candidate: UnknownRecord): void {
    const staticCheckout = stepNamed(jobAt(candidate, 'static'), 'Checkout');
    const staticOptions = recordAt(staticCheckout, 'with');
    if (staticOptions['fetch-depth'] !== 0) {
        throw new Error('static must retain complete history for release inventory provenance');
    }
    if (staticOptions.ref !== '${{ github.sha }}') {
        throw new Error('static release inventory must inspect the current workflow revision');
    }
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

function assertReleaseInventoryCommand(job: UnknownRecord): void {
    if (stepNamed(job, 'Release inventory').run !== 'pnpm test:release-inventory') {
        throw new Error('release inventory must run its exact validation command');
    }
}

function assertCampaignFixtureCommand(job: UnknownRecord): void {
    if (
        stepNamed(job, 'Campaign fixture freshness').run !==
        "pnpm test:run scripts/__tests__/agentCampaignHarness.spec.ts -t 'records each fixture as the tree actually holds it' --maxWorkers=2"
    ) {
        throw new Error('campaign fixture freshness must run its exact validation case');
    }
}

function assertBrowserAiChromiumInstallBounded(job: UnknownRecord): void {
    if (stepNamed(job, 'Install Chromium')['timeout-minutes'] !== 5) {
        throw new Error('Browser AI WebGPU job must bound its Chromium install so a stalled download fails fast');
    }
}

function assertBrowserAiWebGpuStepBudget(job: UnknownRecord): void {
    const steps = arrayAt(job, 'steps');
    let declaredMinutes = 0;
    for (const rawStep of steps) {
        const step = asRecord(rawStep, 'Browser AI WebGPU step');
        const minutes = step['timeout-minutes'];
        if (typeof minutes !== 'number' || !Number.isSafeInteger(minutes) || minutes < 1) {
            throw new Error('Browser AI WebGPU must bound every named step');
        }
        declaredMinutes += minutes;
    }
    if (declaredMinutes > BROWSER_AI_WEBGPU_JOB_TIMEOUT_MINUTES - 2) {
        throw new Error('Browser AI WebGPU step budgets must leave two minutes for runner overhead');
    }
    if (steps.length !== BROWSER_AI_WEBGPU_STEP_CAPS.size) {
        throw new Error('Browser AI WebGPU step budget must cover exactly the selected hardware job');
    }
    for (const [name, minutes] of BROWSER_AI_WEBGPU_STEP_CAPS) {
        if (stepNamed(job, name)['timeout-minutes'] !== minutes) {
            throw new Error(`Browser AI WebGPU ${name} must retain its ${minutes}-minute cap`);
        }
    }
}

function assertBrowserAiWebGpuJob(candidate: UnknownRecord): void {
    const job = jobAt(candidate, BROWSER_AI_WEBGPU_JOB);
    if (job.name !== BROWSER_AI_WEBGPU_JOB_NAME) {
        throw new Error('Browser AI WebGPU job must retain its stable name');
    }
    if (job.needs !== undefined || job.if !== BROWSER_AI_WEBGPU_CONDITION) {
        throw new Error('Browser AI WebGPU job must retain its selected hardware condition');
    }
    if (job['runs-on'] !== BROWSER_AI_WEBGPU_RUNNER) {
        throw new Error('Browser AI WebGPU job must use the standard macos-14 runner');
    }
    if (job['timeout-minutes'] !== BROWSER_AI_WEBGPU_JOB_TIMEOUT_MINUTES) {
        throw new Error(
            `Browser AI WebGPU job must retain its ${BROWSER_AI_WEBGPU_JOB_TIMEOUT_MINUTES}-minute failure limit`
        );
    }
    if (stringAt(stepNamed(job, 'Install Chromium'), 'run') !== 'pnpm exec playwright install chromium') {
        throw new Error('Browser AI WebGPU job must install Chromium directly');
    }
    const admission = stepNamed(job, 'Run Browser AI WebGPU admission');
    if (!stringAt(admission, 'run').includes(BROWSER_AI_WEBGPU_COMMAND)) {
        throw new Error('Browser AI WebGPU job must run the dedicated hardware command');
    }
    if (
        admission['timeout-minutes'] !== BROWSER_AI_WEBGPU_STEP_TIMEOUT_MINUTES ||
        admission.shell !== 'bash' ||
        recordAt(admission, 'env').DEBUG !== 'pw:api,pw:browser'
    ) {
        throw new Error('Browser AI WebGPU admission must fail before the job limit with Playwright diagnostics');
    }
    const upload = stepNamed(job, 'Upload Browser AI WebGPU diagnostics');
    const uploadOptions = recordAt(upload, 'with');
    const uploadPaths = stringAt(uploadOptions, 'path')
        .trim()
        .split('\n')
        .map((path) => path.trim());
    if (
        upload.if !== '${{ always() }}' ||
        uploadOptions.name !== 'browser-ai-webgpu-diagnostics' ||
        uploadOptions['retention-days'] !== 7 ||
        uploadOptions['if-no-files-found'] !== 'warn' ||
        JSON.stringify(uploadPaths) !== JSON.stringify(BROWSER_AI_WEBGPU_DIAGNOSTIC_PATHS)
    ) {
        throw new Error(
            'Browser AI WebGPU diagnostics must retain only the log and failure traces after a failed step'
        );
    }
    assertBrowserAiWebGpuStepBudget(job);
    // The browser summary observes this job, then reaches the required Gate
    // through the pull-request workflow's affected caller.
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
    assertBrowserAiChromiumInstallBounded(job);
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
    if (config.globalTimeout !== BROWSER_AI_WEBGPU_GLOBAL_TIMEOUT_MS || config.retries !== 0 || config.workers !== 1) {
        throw new Error(
            'Browser AI WebGPU config must bound the whole dedicated proof without retries or parallel tests'
        );
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
    const aliasStep = stepNamed(job, DEPLOY_WEB_ALIAS_STEP);
    if (aliasStep.id !== 'aliases') {
        throw new Error('the daily deploy train must publish the deployment aliases under a stable step id');
    }
    const aliasEnv = recordAt(aliasStep, 'env');
    if (aliasEnv.DEPLOYMENT_URL !== DEPLOYMENT_URL_REFERENCE) {
        throw new Error('the alias step must read the aliases off the deployment this run just created');
    }
    if (aliasEnv.VERCEL_TOKEN !== VERCEL_TOKEN_REFERENCE || aliasEnv.VERCEL_ORG_ID !== VERCEL_ORG_ID_REFERENCE) {
        throw new Error('the alias step must authenticate its Vercel query from the environment');
    }
    if (stringAt(aliasStep, 'run') !== 'node scripts/resolveVercelDeploymentAliases.ts') {
        throw new Error(
            'the daily deploy train must resolve its aliases through scripts/resolveVercelDeploymentAliases.ts'
        );
    }
    const isolationStep = stepNamed(job, DEPLOY_WEB_ISOLATION_STEP);
    if (recordAt(isolationStep, 'env').ALIASES !== DEPLOYMENT_ALIASES_REFERENCE) {
        throw new Error('the daily deploy train must read its headers back off the public aliases it just resolved');
    }
    if (stringAt(isolationStep, 'run') !== `sh ${DEPLOY_WEB_ISOLATION_SCRIPT}`) {
        throw new Error(`the daily deploy train must grade isolation through ${DEPLOY_WEB_ISOLATION_SCRIPT}`);
    }
    // The grading itself is executed against a fake curl by
    // `scripts/test-health-gate-scripts.sh`; what belongs here is that the
    // script the workflow reaches for still names both headers and still
    // refuses to follow the redirect a restricted deployment URL answers.
    if (
        !isolationScriptSource.includes('cross-origin-opener-policy') ||
        !isolationScriptSource.includes('same-origin') ||
        !isolationScriptSource.includes('cross-origin-embedder-policy') ||
        !isolationScriptSource.includes('require-corp')
    ) {
        throw new Error('the daily deploy train must read the isolation headers back off the deployment');
    }
    if (isolationScriptSource.includes('--location')) {
        throw new Error('the isolation assertion must not follow a redirect off the domain it is grading');
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
    const stepName =
        jobId === 'gate' ? 'Require selected checks to succeed' : 'Require selected browser jobs to succeed';
    const step = stepNamed(gate, stepName);
    if (step.if !== '${{ always() }}') {
        throw new Error(`the ${jobId} guard step must run after cancellation`);
    }
    if (recordAt(step, 'env').RESULTS !== '${{ toJSON(needs) }}') {
        throw new Error(`${jobId} must receive all dependency results through its environment`);
    }
    const script = stringAt(step, 'run');
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
    it('registers the hosted quantum producer contract in the global workflow set', () => {
        expect(() => assertHostedQuantumMeasurementWorkflow(hostedQuantumMeasurement)).not.toThrow();
    });

    it('resolves the hosted WASM output directory only after a runner is assigned', () => {
        const job = jobAt(hostedWasm, 'build-artifacts');
        expect(recordAt(job, 'env').BUILD_OUTPUT_DIRECTORY).toBeUndefined();
        expect(recordAt(stepNamed(job, 'Build and qualify complete artifact'), 'env')).toEqual({
            BUILD_OUTPUT_DIRECTORY: '${{ runner.temp }}/qualified-wasm-artifacts',
        });

        const invalidJobEnvironment = structuredClone(hostedWasm);
        recordAt(jobAt(invalidJobEnvironment, 'build-artifacts'), 'env').BUILD_OUTPUT_DIRECTORY =
            '${{ runner.temp }}/qualified-wasm-artifacts';
        expect(() => assertHostedWasmWorkflow(invalidJobEnvironment)).toThrow('no job-level output directory');
    });

    it('keeps hosted WASM generation unprivileged, head-bound and complete', () => {
        expect(() => assertHostedWasmWorkflow(hostedWasm)).not.toThrow();
        const gate = structuredClone(hostedWasm);
        jobAt(gate, 'build-artifacts').name = 'Gate';
        expect(() => assertHostedWasmWorkflow(gate)).toThrow('distinct check name');
        jobAt(gate, 'build-artifacts').name = 'HeavyGate';
        expect(() => assertHostedWasmWorkflow(gate)).toThrow('distinct check name');
        const permissions = structuredClone(hostedWasm);
        recordAt(permissions, 'permissions').contents = 'write';
        expect(() => assertHostedWasmWorkflow(permissions)).toThrow('read-only');
        const wrongHead = structuredClone(hostedWasm);
        recordAt(stepNamed(jobAt(wrongHead, 'build-artifacts'), 'Checkout source head'), 'with').ref =
            '${{ github.sha }}';
        expect(() => assertHostedWasmWorkflow(wrongHead)).toThrow('exact head');
        const wrongControl = structuredClone(hostedWasm);
        recordAt(stepNamed(jobAt(wrongControl, 'build-artifacts'), 'Checkout workflow control'), 'with').ref =
            '${{ github.sha }}';
        expect(() => assertHostedWasmWorkflow(wrongControl)).toThrow('workflow control');
        const sourceBootstrap = structuredClone(hostedWasm);
        stepNamed(jobAt(sourceBootstrap, 'build-artifacts'), 'Set up pnpm').uses =
            './source/.github/actions/setup-pnpm';
        expect(() => assertHostedWasmWorkflow(sourceBootstrap)).toThrow('pnpm setup from workflow control');
        const controlTarget = structuredClone(hostedWasm);
        recordAt(stepNamed(jobAt(controlTarget, 'build-artifacts'), 'Set up pnpm'), 'with').package_json_file =
            'control/package.json';
        expect(() => assertHostedWasmWorkflow(controlTarget)).toThrow('pnpm target from the source manifest');
        const privileged = structuredClone(hostedWasm);
        privileged.on = { pull_request_target: {} };
        expect(() => assertHostedWasmWorkflow(privileged)).toThrow('unprivileged PR trigger');
        // The paths filter must stay exactly the plan's selection inputs: a
        // dropped crate would stop a stale package from ever being rebuilt.
        const narrowed = structuredClone(hostedWasm);
        const narrowedTrigger = recordAt(recordAt(narrowed, 'on'), 'pull_request');
        narrowedTrigger.paths = arrayAt(narrowedTrigger, 'paths').filter((path) => path !== 'crates/daw-io/**');
        expect(() => assertHostedWasmWorkflow(narrowed)).toThrow('filtered to the selection inputs');
        const unfiltered = structuredClone(hostedWasm);
        delete recordAt(recordAt(unfiltered, 'on'), 'pull_request').paths;
        expect(() => assertHostedWasmWorkflow(unfiltered)).toThrow('filtered to the selection inputs');
        const omitted = structuredClone(hostedWasm);
        removeStepNamed(jobAt(omitted, 'build-artifacts'), 'Build and qualify complete artifact');
        expect(() => assertHostedWasmWorkflow(omitted)).toThrow('complete ordered build steps');
        const unqualified = structuredClone(hostedWasm);
        recordAt(stepNamed(jobAt(unqualified, 'build-artifacts'), 'Upload qualified artifact'), 'with').path = '.';
        expect(() => assertHostedWasmWorkflow(unqualified)).toThrow('only qualified output');
    });

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
        expect(recordAt(recordAt(heavyWorkflow, 'on'), 'workflow_call').inputs).toMatchObject({
            matrix: { required: true, type: 'string' },
            'browser-ai': { required: true, type: 'boolean' },
        });
        expect(nightly.name).toBe('Nightly');
        expect(() => assertRequiredCheckIsolation(workflowSet())).not.toThrow();
        expect(() => assertPullRequestWorkflowIsolation(workflow)).not.toThrow();
        expect(() => assertNightlyWorkflowIsolation(nightly)).not.toThrow();
        expect(() => assertNightlyPermissions(nightly)).not.toThrow();
        expect(() => assertNightlyConcurrencyContract(nightly)).not.toThrow();

        const reviewTriggered = cloneWorkflows('review-triggered');
        recordAt(reviewTriggered.health, 'on').pull_request_review = { types: ['submitted'] };
        expect(() => assertRequiredCheckIsolation(reviewTriggered)).toThrow(
            'health-gates.yml must answer to labeled pull_request events alone'
        );

        // A second event type reaches Gate on every push again, and a run-completion
        // trigger runs outside the pull_request event entirely.
        for (const events of [
            { pull_request: { types: ['labeled', 'synchronize'] } },
            { pull_request: { types: ['labeled'] }, workflow_run: { workflows: ['PR checks'] } },
            { pull_request_target: { types: ['labeled'] } },
        ]) {
            const widenedTrigger = cloneWorkflows('widened trigger');
            widenedTrigger.health.on = events;
            expect(() => assertRequiredCheckIsolation(widenedTrigger)).toThrow(
                'health-gates.yml must answer to labeled pull_request events alone'
            );
        }

        const skippableGate = cloneWorkflows('skippable gate');
        jobAt(skippableGate.health, 'gate').if = '${{ !cancelled() }}';
        expect(() => assertRequiredCheckIsolation(skippableGate)).toThrow('Gate must run after cancellation');

        // Gating the Gate itself on admission would skip it on every unadmitted
        // label event, and a skipped Gate satisfies the required check.
        const admissionSkippedGate = cloneWorkflows('admission-skipped gate');
        jobAt(admissionSkippedGate.health, 'gate').if = ADMITTED_CONDITION;
        expect(() => assertRequiredCheckIsolation(admissionSkippedGate)).toThrow('Gate must run after cancellation');

        const skippableGateStep = cloneWorkflows('skippable gate step');
        stepNamed(jobAt(skippableGateStep.health, 'gate'), 'Require selected checks to succeed').if =
            ADMITTED_CONDITION;
        expect(() => assertRequiredCheckIsolation(skippableGateStep)).toThrow('Gate must run after cancellation');

        const unadmittedGate = cloneWorkflows('unadmitted gate');
        const unadmittedNeeds = arrayAt(jobAt(unadmittedGate.health, 'gate'), 'needs');
        unadmittedNeeds.splice(unadmittedNeeds.indexOf('admission'), 1);
        expect(() => assertRequiredCheckIsolation(unadmittedGate)).toThrow(
            'Gate must fail unless approval admission admitted the head'
        );

        const ungatedHeavyRun = cloneWorkflows('ungated heavy run');
        delete jobAt(ungatedHeavyRun.health, 'scope').if;
        expect(() => assertRequiredCheckIsolation(ungatedHeavyRun)).toThrow(
            'the heavy checks must start only after approval admission admits the head'
        );

        const bypassingCodeql = cloneWorkflows('bypassing CodeQL');
        jobAt(bypassingCodeql.health, 'codeql').needs = 'admission';
        expect(() => assertRequiredCheckIsolation(bypassingCodeql)).toThrow(
            'health-gates.yml job codeql must wait for approval admission through scope'
        );

        // Candidate code deciding its own admission: the head could admit itself.
        const candidateAdmission = cloneWorkflows('candidate admission');
        recordAt(stepNamed(jobAt(candidateAdmission.health, 'admission'), 'Checkout trusted admission'), 'with').ref =
            '${{ github.event.pull_request.head.sha }}';
        expect(() => assertRequiredCheckIsolation(candidateAdmission)).toThrow(
            'approval admission must decide from the default branch, never the candidate head'
        );

        // An older head's approval admits when the decision reads any SHA but the event head.
        const olderHeadAdmission = cloneWorkflows('older-head admission');
        recordAt(stepNamed(jobAt(olderHeadAdmission.health, 'admission'), 'Decide admission'), 'env').HEAD_SHA =
            '${{ github.event.pull_request.base.sha }}';
        expect(() => assertRequiredCheckIsolation(olderHeadAdmission)).toThrow(
            'approval admission must decide on the event head, label and sender with the trusted script'
        );

        // Any approval admits when the decision no longer runs the reviewer-identity check.
        const anyApproverAdmission = cloneWorkflows('any-approver admission');
        stepNamed(jobAt(anyApproverAdmission.health, 'admission'), 'Decide admission').run =
            'echo admitted=true >> "$GITHUB_OUTPUT"';
        expect(() => assertRequiredCheckIsolation(anyApproverAdmission)).toThrow(
            'approval admission must decide on the event head, label and sender with the trusted script'
        );

        const softenedAdmission = cloneWorkflows('softened admission');
        jobAt(softenedAdmission.health, 'admission')['continue-on-error'] = true;
        expect(() => assertRequiredCheckIsolation(softenedAdmission)).toThrow(
            'approval admission must not declare continue-on-error'
        );

        const mintingPushChecks = cloneWorkflows('minting push checks');
        recordAt(mintingPushChecks.prChecks, 'jobs').gate = jobAt(workflow, 'gate');
        expect(() => assertRequiredCheckIsolation(mintingPushChecks)).toThrow('pr-checks.yml must not name a job Gate');

        const renamedPushValidation = cloneWorkflows('renamed push validation');
        jobAt(renamedPushValidation.prChecks, 'validation').name = REQUIRED_CHECK_NAME;
        expect(() => assertRequiredCheckIsolation(renamedPushValidation)).toThrow(
            'pr-checks.yml must not name a job Gate'
        );

        const labeledPushChecks = cloneWorkflows('labeled push checks');
        labeledPushChecks.prChecks.on = { pull_request: { types: ['opened', 'synchronize', 'labeled'] } };
        expect(() => assertRequiredCheckIsolation(labeledPushChecks)).toThrow(
            'pr-checks.yml must answer to pull-request pushes alone'
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
        expect(() => assertRequiredCheckIsolation(scheduleInHeavy)).toThrow('heavy-gates.yml must be reusable-only');

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
        expect(() => assertWorkflowPermissions(prChecksWorkflow)).not.toThrow();
        expect(prChecksWorkflow.concurrency).toEqual({
            group: 'pr-checks-${{ github.event.pull_request.number }}',
            'cancel-in-progress': true,
        });
        expect(() => assertNoJobLevelConcurrency(prChecksWorkflow, 'pr-checks.yml')).not.toThrow();
        expect(() => assertWorkflowPermissions(validationWorkflow)).not.toThrow();
        expect(() => assertWorkflowPermissions(heavyWorkflow)).not.toThrow();
        expect(() => assertConcurrencyContract(workflow)).not.toThrow();
        expect(heavyWorkflow.concurrency).toBeUndefined();
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

    it('uses HTTP/1.1 for the Rust and server health gate step', () => {
        const rustHealthStep = stepNamed(jobAt(validationWorkflow, 'rust'), 'Server and Rust workspace health gates');
        expect(stringAt(rustHealthStep, 'run')).toBe('pnpm health:server:full');
        expect(recordAt(rustHealthStep, 'env').CARGO_HTTP_MULTIPLEXING).toBe('false');
    });

    it('keeps the pull-request grouping key and forbids cancelling matrix shards', () => {
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

    it('keeps the required scope and full nightly train separate', () => {
        const scopeScript = assertScopeContract(validationWorkflow);
        expect(runScopeScript(scopeScript, 'pull_request')).toEqual({
            heavy: 'false',
            rust: 'false',
            server: 'false',
            e2e: 'false',
            web: 'false',
            code: 'false',
            tooling: 'false',
        });
        const nightlyScope = assertNightlyScopeContract(nightly);
        expect(runScopeScript(nightlyScope, 'schedule')).toEqual(FORCED_SCOPE_OUTPUTS);
        expect(runScopeScript(nightlyScope, 'workflow_dispatch')).toEqual(FORCED_SCOPE_OUTPUTS);
        const gatedNightly = asRecord(structuredClone(nightly), 'gated nightly decide');
        jobAt(gatedNightly, 'decide').if = "github.event_name == 'schedule'";
        expect(() => assertNightlyScopeContract(gatedNightly)).toThrow(
            'nightly decide must run on every scheduled and dispatched run'
        );
        const skippableDecide = asRecord(structuredClone(validationWorkflow), 'skippable decide');
        jobAt(skippableDecide, 'decide').if = 'false';
        expect(() => assertScopeContract(skippableDecide)).toThrow('decide must run for every pull request');
        const undisclosedWebScope = asRecord(
            structuredClone(validationWorkflow),
            'undisclosed web scope validationWorkflow'
        );
        recordAt(jobAt(undisclosedWebScope, 'decide'), 'outputs').web = HEAVY_OUTPUT_REFERENCE;
        expect(() => assertScopeContract(undisclosedWebScope)).toThrow(
            'decide web output must expose steps.scope.outputs.web'
        );
        // Caller outputs are pinned even when the heavy flag is false on PRs.
        const unexportedHeavy = asRecord(structuredClone(validationWorkflow), 'unexported heavy validationWorkflow');
        delete recordAt(recordAt(recordAt(unexportedHeavy, 'on'), 'workflow_call'), 'outputs').heavy;
        expect(() => assertScopeContract(unexportedHeavy)).toThrow(
            'validation.yml must export exactly the seven scope outputs to its callers'
        );
    });

    it('treats an unclassified path as code-bearing and prose as nothing to check', () => {
        const scopeScript = assertScopeContract(validationWorkflow);
        expect(() => assertUnclassifiedFallback(validationWorkflow)).not.toThrow();
        expect(() => assertProseSkippingJobs(validationWorkflow)).not.toThrow();
        expect(() => assertGateScriptScopeClaims(validationWorkflow)).not.toThrow();

        expect(runScopeScript(scopeScript, 'pull_request', { UNCLASSIFIED: 'true', BROWSER: 'true' })).toEqual({
            heavy: 'false',
            rust: 'true',
            server: 'true',
            e2e: 'true',
            web: 'true',
            code: 'true',
            tooling: 'false',
        });
        expect(runScopeScript(scopeScript, 'pull_request', { WEB: 'true' })).toMatchObject({
            rust: 'false',
            code: 'true',
        });
        expect(runScopeScript(scopeScript, 'pull_request', { UNCLASSIFIED: 'true' }).e2e).toBe('false');

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
            'wasm freshness and the script contracts answer to prose-classified changes, so static must stay unconditional'
        );

        const alwaysLinting = asRecord(structuredClone(validationWorkflow), 'unconditional lint validationWorkflow');
        delete jobAt(alwaysLinting, 'lint').if;
        expect(() => assertProseSkippingJobs(alwaysLinting)).toThrow('lint must skip a head that carries only prose');

        // Mutation-kill: the split's rust gate script dropping out of the rust
        // scope re-opens the unclaimed-script hole — a pull request touching
        // only that script resolves rust=false, because `unclassified`
        // subtracts `scripts/**`, and skips every cargo leg.
        const unclaimedRustGate = asRecord(structuredClone(validationWorkflow), 'unclaimed rust gate script');
        const unclaimedFilterStep = stepNamed(jobAt(unclaimedRustGate, 'decide'), PATHS_FILTER_FIRST_ATTEMPT_STEP);
        recordAt(unclaimedFilterStep, 'with').filters = stringAt(
            recordAt(unclaimedFilterStep, 'with'),
            'filters'
        ).replace(`  - '${RUST_GATE_SCRIPT}'\n`, '');
        expect(() => assertGateScriptScopeClaims(unclaimedRustGate)).toThrow(
            'the rust scope must claim the rust and collaboration server gate scripts'
        );
    });

    it('uses the affected profile to skip app jobs for known tooling and agent documentation', () => {
        const scopeScript = assertScopeContract(validationWorkflow);
        const tooling = runScopeScript(scopeScript, 'pull_request', {
            PROFILE: 'tooling',
            WEB: 'true',
            UNCLASSIFIED: 'true',
            BROWSER: 'false',
        });
        expect(tooling).toEqual({
            heavy: 'false',
            rust: 'false',
            server: 'false',
            e2e: 'false',
            web: 'false',
            code: 'true',
            tooling: 'true',
        });
        expect(selectedPrValidationJobs(tooling)).toEqual([
            'decide',
            'static',
            'lint',
            'boundaries',
            'tooling-unit',
            'dependency-review',
            'pr-secrets',
        ]);
        const docs = runScopeScript(scopeScript, 'pull_request', {
            PROFILE: 'docs',
            UNCLASSIFIED: 'true',
            BROWSER: 'false',
        });
        expect(docs).toEqual({
            heavy: 'false',
            rust: 'false',
            server: 'false',
            e2e: 'false',
            web: 'false',
            code: 'false',
            tooling: 'false',
        });
        expect(selectedPrValidationJobs(docs)).toEqual(['decide', 'static', 'dependency-review', 'pr-secrets']);
        expect(() =>
            runScopeScript(scopeScript, 'pull_request', {
                PROFILE: 'tooling',
                WEB: 'true',
                BROWSER: 'true',
            })
        ).toThrow('Narrow profile conflicts with browser selection');
        const review = runScopeScript(scopeScript, 'pull_request_review', {
            PROFILE: 'tooling',
            WEB: 'true',
            UNCLASSIFIED: 'true',
            BROWSER: 'true',
        });
        expect(review).toMatchObject({
            heavy: 'true',
            rust: 'true',
            server: 'true',
            e2e: 'true',
            web: 'true',
            code: 'true',
            tooling: 'false',
        });
        expect(selectedPrValidationJobs(review)).toContain('build');
        const staticSteps = jobSteps('validation.yml', 'static', jobAt(validationWorkflow, 'static'));
        for (const name of [
            'Script types',
            'Format',
            'Release proof',
            'Agent delivery scripts',
            'Health gate infrastructure',
        ]) {
            expect(stepNamed(jobAt(validationWorkflow, 'static'), name).if).toBeUndefined();
        }
        for (const name of [
            'App types',
            'Test types',
            'End-to-end types',
            'Desktop shell types',
            'Command argument schemas',
            'Test collection scope',
            'Barrel mock coverage',
            'Device write boundary census',
        ]) {
            expect(stepNamed(jobAt(validationWorkflow, 'static'), name).if).toBe(
                "needs.decide.outputs.tooling != 'true'"
            );
        }
        expect(staticSteps).toHaveLength(STEP_INVENTORY['validation.yml']!.static!.length);
        expect(jobAt(validationWorkflow, 'tooling-unit').if).toBe("needs.decide.outputs.tooling == 'true'");
        // The runner account holds uninspectable same-UID processes, so the guard
        // storage specs run only in the isolated unit account.
        expect(stringAt(stepNamed(jobAt(validationWorkflow, 'tooling-unit'), 'Run script suite'), 'run')).toBe(
            "pnpm test:run scripts --exclude='**/releaseProof.spec.ts' --exclude='**/agentDeliveryScripts.spec.ts'" +
                " --exclude='**/resourceGuardStorage.spec.ts' --exclude='**/resourceGuard.spec.ts'" +
                " --exclude='**/resourceGuardShowOutput.spec.ts'"
        );
    });

    it('retries a transient changed-paths API failure and refuses to resolve an empty verdict', () => {
        expect(() => assertDecideFilterRetryContract(validationWorkflow)).not.toThrow();

        // A real verdict resolves the scope whatever produced it; an empty
        // verdict — both attempts failed or never ran — must fail the script
        // rather than read as false and skip every lane under a green job.
        const scopeScript = assertScopeContract(validationWorkflow);
        expect(runScopeScript(scopeScript, 'pull_request')).toEqual({
            heavy: 'false',
            rust: 'false',
            server: 'false',
            e2e: 'false',
            web: 'false',
            code: 'false',
            tooling: 'false',
        });
        for (const [name] of PATHS_FILTER_VERDICT_ENV) {
            expect(() => runScopeScript(scopeScript, 'pull_request', { [name]: '' })).toThrow('No scope verdict');
        }
        expect(() => runScopeScript(scopeScript, 'pull_request', { BROWSER: '' })).toThrow('No scope verdict');

        // Mutation-kill: a first attempt that fails the job on a transient 500
        // blocks Gate again, and a retry carrying its own softening would
        // report green whatever it ran.
        const hardenedFirstAttempt = asRecord(structuredClone(validationWorkflow), 'hardened first filter attempt');
        delete stepNamed(jobAt(hardenedFirstAttempt, 'decide'), PATHS_FILTER_FIRST_ATTEMPT_STEP)['continue-on-error'];
        expect(() => assertDecideFilterRetryContract(hardenedFirstAttempt)).toThrow(
            'the first paths-filter attempt must continue on error so its retry can absorb a transient API failure'
        );
        const softenedRetry = cloneWorkflows('softened retry filter attempt');
        stepNamed(jobAt(softenedRetry.validation, 'decide'), PATHS_FILTER_RETRY_STEP)['continue-on-error'] = true;
        expect(() => assertNoContinueOnError(softenedRetry)).toThrow(
            `validation.yml job decide step ${PATHS_FILTER_RETRY_STEP} must not continue on error`
        );

        // Mutation-kill: a retry gated on anything but the first attempt's
        // failure either never runs or runs on every outcome.
        const widenedRetry = asRecord(structuredClone(validationWorkflow), 'widened retry condition');
        stepNamed(jobAt(widenedRetry, 'decide'), PATHS_FILTER_RETRY_STEP).if = '${{ !cancelled() }}';
        expect(() => assertDecideFilterRetryContract(widenedRetry)).toThrow(
            'the retry must run exactly when the first paths-filter attempt failed'
        );

        // Mutation-kill: a retry from a different action revision is an
        // unpinned action in the required lane.
        const driftingRetry = asRecord(structuredClone(validationWorkflow), 'drifting retry action');
        stepNamed(jobAt(driftingRetry, 'decide'), PATHS_FILTER_RETRY_STEP).uses = 'dorny/paths-filter@main';
        expect(() => assertDecideFilterRetryContract(driftingRetry)).toThrow(
            'the retry must pin the same paths-filter action revision as the first attempt'
        );

        // Mutation-kill: a retry that filters differently resolves the scope
        // from rules no pin reads.
        const divergingRetry = asRecord(structuredClone(validationWorkflow), 'diverging retry filters');
        recordAt(stepNamed(jobAt(divergingRetry, 'decide'), PATHS_FILTER_RETRY_STEP), 'with')['predicate-quantifier'] =
            'some';
        expect(() => assertDecideFilterRetryContract(divergingRetry)).toThrow(
            "the retry must duplicate the first attempt's filter options verbatim"
        );

        // Mutation-kill: reading the first attempt alone reverts to failing
        // the job on the transient API failure this retry exists to absorb.
        const firstAttemptOnlyEnv = asRecord(structuredClone(validationWorkflow), 'first-attempt-only verdict env');
        recordAt(stepNamed(jobAt(firstAttemptOnlyEnv, 'decide'), 'Resolve scope'), 'env').RUST =
            '${{ steps.filter.outputs.rust }}';
        expect(() => assertDecideFilterRetryContract(firstAttemptOnlyEnv)).toThrow(
            'the RUST verdict must coalesce the retry attempt before the first attempt'
        );
    });

    it('uses the locked preinstalled runtime and rejects browser acquisition in every Linux browser job', () => {
        for (const [label, workflow, job] of [
            ['the offline smoke job', validationWorkflow, 'smoke'],
            ['the affected end-to-end job', heavyWorkflow, 'e2e'],
            ['the nightly end-to-end job', nightly, 'e2e'],
        ] as const) {
            const minutes = job === 'smoke' ? SMOKE_JOB_MINUTES : E2E_JOB_MINUTES;
            const check = (candidate: UnknownRecord) =>
                assertContainerBrowserRuntime(jobAt(candidate, job), label, minutes);
            expect(() => check(workflow)).not.toThrow();
            for (const image of [
                `mcr.microsoft.com/playwright:v1.62.0-noble@${PLAYWRIGHT_IMAGE_DIGEST}`,
                'mcr.microsoft.com/playwright:v1.63.0-noble',
                `mcr.microsoft.com/playwright:v1.63.0-noble@sha256:${'0'.repeat(64)}`,
            ]) {
                const mismatch = structuredClone(workflow);
                recordAt(jobAt(mismatch, job), 'container').image = image;
                expect(() => check(mismatch)).toThrow('must use the locked Playwright image and digest');
            }
            for (const command of [
                'sudo env "PATH=$PATH" bash scripts/aptWithoutMicrosoftFeed.sh --deadline 8m -- node_modules/.bin/playwright install-deps chromium',
                'pnpm exec playwright install chromium',
                'apt-get install -y libnss3',
            ]) {
                const acquisition = structuredClone(workflow);
                const install = stepNamed(jobAt(acquisition, job), 'Install dependencies');
                install.run = `${stringAt(install, 'run')}\n${command}`;
                expect(() => check(acquisition)).toThrow('must not acquire browser packages or binaries at runtime');
            }
            const privileged = structuredClone(workflow);
            const container = recordAt(jobAt(privileged, job), 'container');
            container.options = `${stringAt(container, 'options')} --privileged`;
            expect(() => check(privileged)).toThrow('without extra container authority');
            const wrongShell = structuredClone(workflow);
            jobAt(wrongShell, job).defaults = { run: { shell: 'sh' } };
            expect(() => check(wrongShell)).toThrow('must preserve bash');
            const noLaunch = structuredClone(workflow);
            stepNamed(jobAt(noLaunch, job), BROWSER_RUNTIME_STEP).run = 'pnpm exec playwright --version';
            expect(() => check(noLaunch)).toThrow('must launch and check the resolved browser');
            const conditional = structuredClone(workflow);
            stepNamed(jobAt(conditional, job), BROWSER_RUNTIME_STEP).if = 'false';
            expect(() => check(conditional)).toThrow('without conditional admission');
        }
    });

    it('runs one bounded ALSA transaction with fatal failure in each Rust route', () => {
        for (const [label, workflow] of [
            ['the validation Rust job', validationWorkflow],
            ['the nightly Rust job', nightly],
        ] as const) {
            const check = (candidate: UnknownRecord) => assertBoundedAlsaInstall(jobAt(candidate, 'rust'), label);
            expect(() => check(workflow)).not.toThrow();
            const duplicate = asRecord(structuredClone(workflow), `duplicate ${label}`);
            const step = stepNamed(jobAt(duplicate, 'rust'), 'Install ALSA development headers');
            step.run = `${stringAt(step, 'run')}${ALSA_INSTALL_COMMAND}\n`;
            expect(() => check(duplicate)).toThrow('must run one bounded ALSA transaction and propagate its failure');
            const missingDeadline = asRecord(structuredClone(workflow), `missing deadline ${label}`);
            const missingStep = stepNamed(jobAt(missingDeadline, 'rust'), 'Install ALSA development headers');
            missingStep.run = stringAt(missingStep, 'run').replace('--deadline 8m --', '--');
            expect(() => check(missingDeadline)).toThrow(
                'must run the ALSA header install through the Microsoft apt feed filter'
            );
        }
    });

    it('runs every hosted apt route through the Microsoft apt feed filter', () => {
        expect(() => assertAptRoutesFiltered(workflowSet())).not.toThrow();

        const routes: ReadonlyArray<readonly [keyof WorkflowSet, string, string, string]> = [
            ['validation', 'validation.yml', 'rust', 'Install ALSA development headers'],
            ['nightly', 'nightly.yml', 'rust', 'Install ALSA development headers'],
            ['cargoDependencySeed', 'cargo-dependency-seed.yml', 'rust', 'Install ALSA development headers'],
            ['hostedQuantumMeasurement', 'quantum-measurements.yml', 'measure', 'Install Google Chrome'],
        ];
        for (const [key, file, jobId, stepName] of routes) {
            const unfiltered = cloneWorkflows(`unfiltered ${file} ${jobId}`);
            const step = stepNamed(jobAt(unfiltered[key], jobId), stepName);
            const run = stringAt(step, 'run');
            expect(run).toContain(APT_FEED_FILTER);
            step.run = run.replace(`${APT_FEED_FILTER} `, '');
            expect(() => assertAptRoutesFiltered(unfiltered)).toThrow(
                `${file} job ${jobId} step ${stepName} must run apt through the Microsoft apt feed filter`
            );
        }

        const addedRoute = cloneWorkflows('added unfiltered apt route');
        arrayAt(jobAt(addedRoute.validation, 'lint'), 'steps').push({
            name: 'Install a package',
            run: 'sudo apt-get install -y jq',
        });
        expect(() => assertAptRoutesFiltered(addedRoute)).toThrow(
            'validation.yml job lint step Install a package must run apt through the Microsoft apt feed filter'
        );
    });

    it('acquires only trusted scanner files and starts from the pinned target instead of every ref', () => {
        const job = jobAt(validationWorkflow, 'pr-secrets');
        const trusted = recordAt(stepNamed(job, 'Checkout trusted scanner'), 'with');
        expect(trusted['sparse-checkout']).toBe('/.gitleaks.toml\n/.gitleaksignore\n');
        expect(trusted['sparse-checkout-cone-mode']).toBe(false);
        expect(recordAt(stepNamed(job, 'Checkout scan target'), 'with')['fetch-depth']).toBe(1);
        expect(job['timeout-minutes']).toBe(10);
    });

    it('acquires the exact complete pinned commit and merge-parent patch set despite moved and unrelated refs', () => {
        withPrSecretHistory((fixture) => {
            const { directory, result } = acquirePrSecretHistory(fixture, validationWorkflow);
            expect(result.error).toBeUndefined();
            expect(result.status, result.stderr).toBe(0);
            expect(fixtureGit(directory, ['rev-parse', '--is-shallow-repository'])).toBe('false');
            const range = `${fixture.base}..${fixture.head}`;
            const args = ['log', '--format=%H:%P', '-p', '-U0', range, '-m'];
            const expected = fixtureGit(fixture.source, args);
            expect(expected).toContain('intermediate.txt');
            expect(expected).toContain('side.txt');
            expect(expected).toContain('+aws_access_key_id');
            expect(expected).not.toContain('excluded-common.txt');
            expect(expected).not.toContain('moved-head.txt');
            expect(fixtureGit(directory, args)).toBe(expected);
            expect(fixtureGit(directory, ['for-each-ref', '--format=%(refname)'])).toBe('');
            expect(fixtureGit(directory, ['rev-parse', 'HEAD'])).toBe(fixture.head);
        });
    });

    it.each(['base', 'head'] as const)('refuses a missing pinned %s before the scan', (endpoint) => {
        withPrSecretHistory((fixture) => {
            const { result } = acquirePrSecretHistory(fixture, validationWorkflow, { [endpoint]: 'f'.repeat(40) });
            expect(result.error).toBeUndefined();
            expect(result.status).not.toBe(0);
        });
    });

    it('refuses a remaining shallow boundary if history acquisition is omitted', () => {
        withPrSecretHistory((fixture) => {
            const script = stringAt(
                stepNamed(jobAt(validationWorkflow, 'pr-secrets'), 'Fetch immutable base SHA'),
                'run'
            );
            const { result } = acquirePrSecretHistory(fixture, validationWorkflow, {
                depth: 1,
                run: script.replaceAll(/git fetch[^\n]+/g, ':'),
            });
            expect(result.error).toBeUndefined();
            expect(result.status).not.toBe(0);
        });
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

    it('requires the heavy browser runtime proof before its unchanged shard command', () => {
        expect(() => assertBoundedHeavyE2eInstall(heavyWorkflow)).not.toThrow();
        const bypassed = cloneWorkflows('bypassed heavy runtime proof');
        stepNamed(jobAt(bypassed.heavy, 'e2e'), 'Run shard').if = 'always()';
        expect(() => assertBoundedHeavyE2eInstall(bypassed.heavy)).toThrow('without conditional admission');
    });

    it('makes selected validation, E2E and CodeQL decisive for the required Gate', () => {
        expect(() => assertJobGraph(workflowSet())).not.toThrow();

        const eventGatedDependencyReview = cloneWorkflows('event-gated dependency review');
        jobAt(eventGatedDependencyReview.validation, 'dependency-review').if = "github.event_name == 'pull_request'";
        expect(() => assertJobGraph(eventGatedDependencyReview)).toThrow(
            'dependency review must gate on the pull request payload rather than the triggering event'
        );

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
            'validation.yml static device write boundary census must retain its scope condition'
        );

        const widenedSummary = cloneWorkflows('widened summary');
        arrayAt(jobAt(widenedSummary.health, 'gate'), 'needs').push('nightly-report');
        expect(() => assertJobGraph(widenedSummary)).toThrow('gate must depend on exactly the pinned member list');

        const ungatedValidation = cloneWorkflows('ungated validation');
        const ungatedNeeds = arrayAt(jobAt(ungatedValidation.health, 'gate'), 'needs');
        ungatedNeeds.splice(ungatedNeeds.indexOf('validation'), 1);
        expect(() => assertJobGraph(ungatedValidation)).toThrow('gate must depend on validation');

        const disconnectedAffected = cloneWorkflows('disconnected affected E2E');
        jobAt(disconnectedAffected.health, 'affected').needs = 'validation';
        expect(() => assertJobGraph(disconnectedAffected)).toThrow(
            'required affected E2E must wait for scope and successful validation'
        );

        const unselectedCodeql = cloneWorkflows('unselected CodeQL');
        jobAt(unselectedCodeql.health, 'codeql').if = 'false';
        expect(() => assertJobGraph(unselectedCodeql)).toThrow(
            'required CodeQL must answer to the selected security scope'
        );

        const gatedPushLane = cloneWorkflows('gated push lane');
        jobAt(gatedPushLane.health, 'validation').if = 'false';
        expect(() => assertJobGraph(gatedPushLane)).toThrow('required validation must run on every pull request');

        // A leg dropped out of the shared lane leaves the required Gate without
        // failing anything: the summary still passes, on less evidence.
        const strippedLane = cloneWorkflows('stripped validation lane');
        delete recordAt(strippedLane.validation, 'jobs').unit;
        expect(() => assertJobGraph(strippedLane)).toThrow('validation.yml must hold exactly the pinned job list');

        const inlinedLane = cloneWorkflows('inlined lane');
        delete jobAt(inlinedLane.health, 'validation').uses;
        expect(() => assertJobGraph(inlinedLane)).toThrow('required validation must consume the affected scope');

        const wrongBrowserScope = cloneWorkflows('wrong browser scope');
        recordAt(jobAt(wrongBrowserScope.health, 'validation'), 'with').browser = false;
        expect(() => assertJobGraph(wrongBrowserScope)).toThrow(
            'required browser smoke must consume the affected scope'
        );

        const renamedHeavySummary = cloneWorkflows('renamed heavy summary');
        jobAt(renamedHeavySummary.heavy, 'heavy-gate').name = 'Heavy summary';
        expect(() => assertJobGraph(renamedHeavySummary)).toThrow(
            'the reusable browser summary must retain its non-skipping condition'
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

    it('requires the real hosted installer systemd proof for tooling changes', () => {
        const staticJob = jobAt(validationWorkflow, 'static');
        const proof = stepNamed(staticJob, 'Hosted installer systemd proof');
        expect(proof.run).toBe('pnpm test:run scripts/__tests__/hostedAptInstall.spec.ts --maxWorkers=2');
        expect(recordAt(proof, 'env')).toEqual({ SOURDAW_SYSTEMD_TESTS: '1' });
        expect(staticJob['runs-on']).toBe('ubuntu-latest');
        const steps = jobSteps('validation.yml', 'static', staticJob);
        expect(steps.findIndex((step) => step.name === 'Install dependencies')).toBeLessThan(
            steps.findIndex((step) => step.name === 'Hosted installer systemd proof')
        );
        const scope = runScopeScript(assertScopeContract(validationWorkflow), 'pull_request', {
            PROFILE: 'tooling',
            WEB: 'true',
            BROWSER: 'false',
        });
        expect(scope.tooling).toBe('true');
        expect(selectedPrValidationJobs(scope)).toContain('static');
        expect(arrayAt(jobAt(validationWorkflow, 'validation-gate'), 'needs')).toContain('static');

        const missing = cloneWorkflows('missing hosted installer proof');
        removeStepNamed(jobAt(missing.validation, 'static'), 'Hosted installer systemd proof');
        expect(() => assertStepInventory(missing)).toThrow('validation.yml job static steps drifted');
        const conditional = cloneWorkflows('conditional hosted installer proof');
        stepNamed(jobAt(conditional.validation, 'static'), 'Hosted installer systemd proof').if = 'false';
        expect(() => assertUnconditionalSteps(conditional)).toThrow();
        const softened = cloneWorkflows('softened hosted installer proof');
        stepNamed(jobAt(softened.validation, 'static'), 'Hosted installer systemd proof')['continue-on-error'] = true;
        expect(() => assertNoContinueOnError(softened)).toThrow();
    });

    it('requires campaign fixture freshness for Rust-only changes', () => {
        const staticJob = jobAt(validationWorkflow, 'static');
        expect(() => assertCampaignFixtureCommand(staticJob)).not.toThrow();
        const steps = jobSteps('validation.yml', 'static', staticJob);
        expect(steps.findIndex((step) => step.name === 'Install dependencies')).toBeLessThan(
            steps.findIndex((step) => step.name === 'Campaign fixture freshness')
        );
        const scope = runScopeScript(assertScopeContract(validationWorkflow), 'pull_request', {
            RUST: 'true',
            BROWSER: 'false',
        });
        expect(scope.web).toBe('false');
        expect(scope.e2e).toBe('false');
        expect(selectedPrValidationJobs(scope)).toContain('static');
        expect(arrayAt(jobAt(validationWorkflow, 'validation-gate'), 'needs')).toContain('static');

        const missing = cloneWorkflows('missing campaign fixture freshness');
        removeStepNamed(jobAt(missing.validation, 'static'), 'Campaign fixture freshness');
        expect(() => assertStepInventory(missing)).toThrow('validation.yml job static steps drifted');
        const conditional = cloneWorkflows('conditional campaign fixture freshness');
        stepNamed(jobAt(conditional.validation, 'static'), 'Campaign fixture freshness').if = 'false';
        expect(() => assertUnconditionalSteps(conditional)).toThrow();
        const softened = cloneWorkflows('softened campaign fixture freshness');
        stepNamed(jobAt(softened.validation, 'static'), 'Campaign fixture freshness')['continue-on-error'] = true;
        expect(() => assertNoContinueOnError(softened)).toThrow();
        const wrong = cloneWorkflows('wrong campaign fixture case');
        stepNamed(jobAt(wrong.validation, 'static'), 'Campaign fixture freshness').run = 'pnpm test:run';
        expect(() => assertCampaignFixtureCommand(jobAt(wrong.validation, 'static'))).toThrow();
    });

    it('runs release inventory on every pull request and nightly with full provenance history', () => {
        const validationStatic = jobSteps('validation.yml', 'static', jobAt(validationWorkflow, 'static'));
        const nightlyStatic = jobSteps('nightly.yml', 'static', jobAt(nightly, 'static'));
        for (const [workflowName, staticJob] of [
            ['validation.yml', jobAt(validationWorkflow, 'static')],
            ['nightly.yml', jobAt(nightly, 'static')],
        ] as const) {
            expect(jobSteps(workflowName, 'static', staticJob).map((step) => step.name)).toContain('Release inventory');
            const inventory = stepNamed(staticJob, 'Release inventory');
            expect(() => assertReleaseInventoryCommand(staticJob)).not.toThrow();
            expect(inventory.if).toBeUndefined();
            expect(inventory['continue-on-error']).toBeUndefined();
        }
        expect(validationStatic.map((step) => step.name)).toContain('Release inventory');
        expect(nightlyStatic.map((step) => step.name)).toContain('Release inventory');
        expect(() => assertUnitProvenanceHistory(validationWorkflow)).not.toThrow();

        const droppedPr = cloneWorkflows('release inventory dropped from validation');
        removeStepNamed(jobAt(droppedPr.validation, 'static'), 'Release inventory');
        expect(() => assertStepInventory(droppedPr)).toThrow('validation.yml job static steps drifted');

        const conditionalPr = cloneWorkflows('release inventory conditional in validation');
        stepNamed(jobAt(conditionalPr.validation, 'static'), 'Release inventory').if = false;
        expect(() => assertUnconditionalSteps(conditionalPr)).toThrow();

        const wrongCommand = cloneWorkflows('release inventory command changed');
        stepNamed(jobAt(wrongCommand.validation, 'static'), 'Release inventory').run = 'pnpm test:collection-scope';
        expect(() => assertReleaseInventoryCommand(jobAt(wrongCommand.validation, 'static'))).toThrow(
            'release inventory must run its exact validation command'
        );

        const softenedPr = cloneWorkflows('release inventory softened in validation');
        stepNamed(jobAt(softenedPr.validation, 'static'), 'Release inventory')['continue-on-error'] = true;
        expect(() => assertNoContinueOnError(softenedPr)).toThrow();

        const shallowPr = cloneWorkflows('release inventory shallow validation checkout');
        recordAt(stepNamed(jobAt(shallowPr.validation, 'static'), 'Checkout'), 'with')['fetch-depth'] = 1;
        expect(() => assertUnitProvenanceHistory(shallowPr.validation)).toThrow(
            'static must retain complete history for release inventory provenance'
        );

        const baseRevision = cloneWorkflows('release inventory on pull request base');
        recordAt(stepNamed(jobAt(baseRevision.validation, 'static'), 'Checkout'), 'with').ref =
            '${{ github.event.pull_request.base.sha }}';
        expect(() => assertUnitProvenanceHistory(baseRevision.validation)).toThrow(
            'static release inventory must inspect the current workflow revision'
        );

        const dropped = cloneWorkflows('release inventory dropped from nightly');
        removeStepNamed(jobAt(dropped.nightly, 'static'), 'Release inventory');
        expect(() => assertStepInventory(dropped)).toThrow('nightly.yml job static steps drifted');
    });

    it('admits the observed fetch plus full checkout while reserving lint and cleanup phases', () => {
        const lint = jobAt(validationWorkflow, 'lint');
        const checkout = stepNamed(lint, 'Checkout');
        const checkoutMinutes = checkout['timeout-minutes'];
        if (typeof checkoutMinutes !== 'number') {
            throw new TypeError('checkout must declare its phase budget');
        }
        // Run40743393214 fetched for 298.736s before its five-minute step expired in checkout.
        // Its parallel full checkout took 7.049s after fetching; neither phase may be omitted.
        const observedFetchMs = 298_736;
        const completedPeerCheckoutMs = 7_049;
        expect(checkoutMinutes * 60_000).toBeGreaterThanOrEqual(observedFetchMs + completedPeerCheckoutMs);
        expect(checkout.with).toBeUndefined();

        let reservedStepMinutes = 0;
        for (const name of ['Checkout', 'Set up pnpm', 'Set up Node', 'Install dependencies', 'Lint']) {
            const minutes = stepNamed(lint, name)['timeout-minutes'];
            if (typeof minutes !== 'number') {
                throw new TypeError(`lint phase ${name} must declare its budget`);
            }
            reservedStepMinutes += minutes;
        }
        const jobMinutes = lint['timeout-minutes'];
        if (typeof jobMinutes !== 'number') {
            throw new TypeError('lint must declare its outer budget');
        }
        expect(jobMinutes - reservedStepMinutes).toBeGreaterThanOrEqual(5);
        expect(stepNamed(lint, 'Lint')['timeout-minutes']).toBe(20);
        expect(stepNamed(lint, 'Lint').run).toBe('pnpm lint:full');
    });

    it('reserves bounded setup, full lint, and cleanup time in the lint job', () => {
        expect(() => assertLintTimeBudgets(validationWorkflow)).not.toThrow();
        const oldCheckout = structuredClone(validationWorkflow);
        stepNamed(jobAt(oldCheckout, 'lint'), 'Checkout')['timeout-minutes'] = 5;
        expect(() => assertLintTimeBudgets(oldCheckout)).toThrow('ten-minute timeout');
        const oldJob = structuredClone(validationWorkflow);
        jobAt(oldJob, 'lint')['timeout-minutes'] = 45;
        expect(() => assertLintTimeBudgets(oldJob)).toThrow('five minutes for cleanup');
        for (const name of ['Checkout', 'Set up pnpm', 'Set up Node', 'Install dependencies', 'Lint']) {
            const missing = structuredClone(validationWorkflow);
            delete stepNamed(jobAt(missing, 'lint'), name)['timeout-minutes'];
            expect(() => assertLintTimeBudgets(missing), name).toThrow();
        }
        const overlong = structuredClone(validationWorkflow);
        jobAt(overlong, 'lint')['timeout-minutes'] = 51;
        expect(() => assertLintTimeBudgets(overlong)).toThrow('five minutes for cleanup');
        const lint = jobAt(validationWorkflow, 'lint');
        expect(lint.if).toBe("needs.decide.outputs.code == 'true'");
        expect(stepNamed(lint, 'Lint').run).toBe('pnpm lint:full');
        expect(recordAt(stepNamed(lint, 'Lint'), 'env')).toEqual({
            SOURDAW_LINT_CONCURRENCY: 'auto',
            SOURDAW_LINT_THREADS: '0',
        });
    });

    it('sweeps every job and step for softening, with only the pinned conditional steps', () => {
        expect(() => assertNoContinueOnError(workflowSet())).not.toThrow();
        expect(() => assertUnconditionalSteps(workflowSet())).not.toThrow();
        expect(() => assertValidationScopeConditions(validationWorkflow)).not.toThrow();
        expect(() => assertRequiredCodeQlPermissions(workflow)).not.toThrow();

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

        // Mutation-kill: the retry's condition drifting from its pin decides
        // when the filter re-runs while every other pin stays green.
        const widenedRetryCondition = cloneWorkflows('widened retry filter condition');
        stepNamed(jobAt(widenedRetryCondition.validation, 'decide'), PATHS_FILTER_RETRY_STEP).if = 'false';
        expect(() => assertUnconditionalSteps(widenedRetryCondition)).toThrow(
            `validation.yml job decide step ${PATHS_FILTER_RETRY_STEP} must retain its pinned condition`
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

        // CodeQL alone receives SARIF upload permission. The caller and shared
        // validation workflow retain read-only permissions.
        const widenedCodeQl = cloneWorkflows('widened codeql permissions');
        recordAt(jobAt(widenedCodeQl.health, 'codeql'), 'permissions').contents = 'write';
        expect(() => assertRequiredCodeQlPermissions(widenedCodeQl.health)).toThrow(
            'the required CodeQL job must grant exactly contents: read, security-events: write, and actions: read'
        );

        const narrowedCodeQl = cloneWorkflows('narrowed codeql permissions');
        delete recordAt(jobAt(narrowedCodeQl.health, 'codeql'), 'permissions')['security-events'];
        expect(() => assertRequiredCodeQlPermissions(narrowedCodeQl.health)).toThrow(
            'the required CodeQL job must grant exactly contents: read, security-events: write, and actions: read'
        );

        const widenedScope = cloneWorkflows('widened scope permissions');
        jobAt(widenedScope.health, 'scope').permissions = { contents: 'write' };
        expect(() => assertRequiredCodeQlPermissions(widenedScope.health)).toThrow(
            'the scope job must inherit read-only workflow permissions'
        );
    });

    it('requires exact-head native sensitivity after the warm baseline and preserves failed evidence', () => {
        expect(() => assertNativeTransportMutationProof(validationWorkflow)).not.toThrow();
    });

    it.each([
        ['missing probe', (job: UnknownRecord) => removeStepNamed(job, 'Verify native transport mutation sensitivity')],
        [
            'wrong head',
            (job: UnknownRecord) => {
                recordAt(stepNamed(job, 'Verify native transport mutation sensitivity'), 'env').HEAD_SHA =
                    '${{ github.sha }}';
            },
        ],
        [
            'arbitrary input',
            (job: UnknownRecord) => {
                stepNamed(job, 'Verify native transport mutation sensitivity').run =
                    'node scripts/verifyNativeTransportMutations.ts "$MUTATION"';
            },
        ],
        [
            'softened failure',
            (job: UnknownRecord) => {
                stepNamed(job, 'Verify native transport mutation sensitivity')['continue-on-error'] = true;
            },
        ],
        [
            'conditional proof',
            (job: UnknownRecord) => {
                stepNamed(job, 'Verify native transport mutation sensitivity').if = 'false';
            },
        ],
        [
            'saved mutated target',
            (job: UnknownRecord) => {
                recordAt(stepNamed(job, 'Cache cargo build'), 'with')['save-if'] = 'true';
            },
        ],
        [
            'missing failed logs',
            (job: UnknownRecord) => {
                delete stepNamed(job, 'Upload native transport mutation evidence').if;
            },
        ],
        [
            'wrong artifact head',
            (job: UnknownRecord) => {
                recordAt(stepNamed(job, 'Upload native transport mutation evidence'), 'with').name =
                    'native-proof-latest';
            },
        ],
        [
            'unfetched head',
            (job: UnknownRecord) => {
                recordAt(stepNamed(job, 'Checkout'), 'with')['fetch-depth'] = 1;
            },
        ],
        [
            'unfetched event base after main advances',
            (job: UnknownRecord) => {
                recordAt(stepNamed(job, 'Checkout'), 'with')['fetch-depth'] = 2;
            },
        ],
        [
            'persistent credential',
            (job: UnknownRecord) => {
                recordAt(stepNamed(job, 'Checkout'), 'with')['persist-credentials'] = true;
            },
        ],
        [
            'probe before baseline',
            (job: UnknownRecord) => {
                const steps = arrayAt(job, 'steps');
                const index = steps.findIndex(
                    (step) => asRecord(step, 'step').name === 'Verify native transport mutation sensitivity'
                );
                const [probe] = steps.splice(index, 1);
                steps.unshift(probe);
            },
        ],
    ])('refuses disconnected native proof: %s', (_label, mutate) => {
        const candidate = structuredClone(validationWorkflow);
        mutate(jobAt(candidate, 'native-macos'));
        expect(() => assertNativeTransportMutationProof(candidate)).toThrow();
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

    it('pins every registered workflow security surface by name', () => {
        const surface = (set: WorkflowSet) => () =>
            assertWorkflowSecuritySurface(Object.fromEntries(workflowFiles(set)));
        expect(surface(workflowSet())).not.toThrow();

        // Each mutation below passed every other pin once the whole-file
        // snapshot was gone; each must fail here on its own.
        const widenedHeavyLeg = cloneWorkflows('widened heavy e2e permissions');
        jobAt(widenedHeavyLeg.heavy, 'e2e').permissions = { contents: 'write' };
        expect(surface(widenedHeavyLeg)).toThrow('heavy-gates.yml job e2e must inherit the workflow-level permissions');

        const widenedReporter = cloneWorkflows('widened nightly reporter permissions');
        recordAt(jobAt(widenedReporter.nightly, 'nightly-report'), 'permissions').contents = 'write';
        expect(surface(widenedReporter)).toThrow(
            'nightly.yml job nightly-report must keep exactly its pinned permissions'
        );

        const leakedStepSecret = cloneWorkflows('step secret on the scope job');
        stepNamed(jobAt(leakedStepSecret.health, 'scope'), 'Plan affected checks').env = {
            ...recordAt(stepNamed(jobAt(leakedStepSecret.health, 'scope'), 'Plan affected checks'), 'env'),
            TOKEN: '${{ secrets.VERCEL_TOKEN }}',
        };
        expect(surface(leakedStepSecret)).toThrow(
            'health-gates.yml job scope must read exactly its pinned secrets: none'
        );

        const jobToken = cloneWorkflows('job token on static');
        jobAt(jobToken.validation, 'static').env = { GH_TOKEN: '${{ github.token }}' };
        expect(surface(jobToken)).toThrow('validation.yml job static must read exactly its pinned secrets: none');

        const spacedJobToken = cloneWorkflows('spaced job token on static');
        jobAt(spacedJobToken.validation, 'static').env = { GH_TOKEN: '${{ GitHub . Token }}' };
        expect(surface(spacedJobToken)).toThrow('validation.yml job static must read exactly its pinned secrets: none');

        for (const wholeGithub of ['${{ github }}', "${{ join(github.*, ',') }}", "${{ format('{0}', github) }}"]) {
            const wholeContext = cloneWorkflows(`whole github context ${wholeGithub}`);
            jobAt(wholeContext.validation, 'static').env = { CONTEXT: wholeGithub };
            expect(surface(wholeContext), wholeGithub).toThrow(
                'validation.yml job static must read exactly its pinned secrets: none'
            );
        }
        const fieldRead = cloneWorkflows('github field read on static');
        jobAt(fieldRead.validation, 'static').env = {
            HEAD: '${{ github.event.pull_request.head.sha }}',
            REPOSITORY: '${{ github.repository }}',
        };
        expect(surface(fieldRead)).not.toThrow();

        const upperCaseContext = cloneWorkflows('upper-case secrets context on static');
        jobAt(upperCaseContext.validation, 'static').env = { TOKEN: '${{ SECRETS.VERCEL_TOKEN }}' };
        expect(surface(upperCaseContext)).toThrow(
            'validation.yml job static must read exactly its pinned secrets: none'
        );

        const leakedWorkflowSecret = cloneWorkflows('workflow-level secret');
        leakedWorkflowSecret.validation.env = { TOKEN: '${{ secrets.VERCEL_TOKEN }}' };
        expect(surface(leakedWorkflowSecret)).toThrow('validation.yml must not read a secret outside a pinned job');

        const wholeContext = cloneWorkflows('whole secrets context');
        jobAt(wholeContext.heavy, 'heavy-gate').if = 'always() && toJSON(secrets) != null';
        expect(surface(wholeContext)).toThrow(
            'heavy-gates.yml job heavy-gate must read exactly its pinned secrets: none'
        );

        const extraDeploySecret = cloneWorkflows('extra deploy secret');
        jobAt(extraDeploySecret.nightly, 'deploy-web').env = { EXTRA: '${{ secrets.JEV_KEY }}' };
        expect(surface(extraDeploySecret)).toThrow('nightly.yml job deploy-web must read exactly its pinned secrets');

        const inheritedSecrets = cloneWorkflows('secrets inherited by validation');
        jobAt(inheritedSecrets.prChecks, 'validation').secrets = 'inherit';
        expect(surface(inheritedSecrets)).toThrow(
            'pr-checks.yml job validation must not pass secrets to a reusable workflow'
        );

        const environment = cloneWorkflows('environment on a validation leg');
        jobAt(environment.validation, 'build').environment = 'Production';
        expect(surface(environment)).toThrow('validation.yml job build must not name a deployment environment');

        const credentialedDeploy = cloneWorkflows('credentialed deploy checkout');
        delete recordAt(
            stepNamed(jobAt(credentialedDeploy.nightly, 'deploy-web'), 'Checkout the validated revision'),
            'with'
        )['persist-credentials'];
        expect(surface(credentialedDeploy)).toThrow(
            'nightly.yml job deploy-web step Checkout the validated revision must check out with persist-credentials: false'
        );

        const floatingAction = cloneWorkflows('floating action ref on lint');
        stepNamed(jobAt(floatingAction.validation, 'lint'), 'Set up pnpm').uses = 'some-org/action-setup@main';
        expect(surface(floatingAction)).toThrow(
            'validation.yml job lint must pin "some-org/action-setup@main" to a full commit SHA or a ./ path inside the repository'
        );

        const escapingLocalAction = cloneWorkflows('local action escaping the repository');
        stepNamed(jobAt(escapingLocalAction.validation, 'lint'), 'Set up pnpm').uses = './../../evil';
        expect(surface(escapingLocalAction)).toThrow(
            'validation.yml job lint must pin "./../../evil" to a full commit SHA or a ./ path inside the repository'
        );

        const computedGate = cloneWorkflows('computed Gate name on push checks');
        jobAt(computedGate.prChecks, 'scope').name = "${{ 'Ga' }}te";
        expect(surface(computedGate)).toThrow(
            'pr-checks.yml job scope must not compute its check name from an expression'
        );

        const computedShardName = cloneWorkflows('matrix-driven name change');
        jobAt(computedShardName.validation, 'unit').name = '${{ matrix.shard }}';
        expect(surface(computedShardName)).toThrow(
            'validation.yml job unit must not compute its check name from an expression'
        );

        const emptyNamedGate = cloneWorkflows('empty-named Gate-keyed nightly job');
        recordAt(emptyNamedGate.nightly, 'jobs').Gate = {
            name: '',
            'runs-on': 'ubuntu-latest',
            steps: [{ name: 'Pass', run: 'true' }],
        };
        expect(surface(emptyNamedGate)).toThrow('nightly.yml job Gate must not be named Gate');

        const secondGate = cloneWorkflows('second Gate in health gates');
        jobAt(secondGate.health, 'admission').name = 'Gate';
        expect(surface(secondGate)).toThrow('health-gates.yml job admission must not be named Gate');
    });

    it('pins the trusted nightly evidence reporter before granting issue writes', () => {
        expect(HEALTH_GATE_WORKFLOW_FILES).toContain('nightly-evidence-report.yml');
        const surface = (set: WorkflowSet) => () =>
            assertWorkflowSecuritySurface(Object.fromEntries(workflowFiles(set)));
        expect(surface(workflowSet())).not.toThrow();

        for (const job of ['validate', 'publish']) {
            const widened = cloneWorkflows(`nightly evidence ${job} permissions`);
            recordAt(jobAt(widened.nightlyEvidenceReporter, job), 'permissions').contents = 'write';
            expect(surface(widened)).toThrow(
                `nightly-evidence-report.yml job ${job} must keep exactly its pinned permissions`
            );

            const extraSecret = cloneWorkflows(`nightly evidence ${job} secret`);
            jobAt(extraSecret.nightlyEvidenceReporter, job).env = { TOKEN: '${{ secrets.JEV_KEY }}' };
            expect(surface(extraSecret)).toThrow(
                `nightly-evidence-report.yml job ${job} must read exactly its pinned secrets: GITHUB_TOKEN`
            );
        }

        for (const [job, step] of [
            ['validate', 'Checkout trusted default-branch reporter'],
            ['publish', 'Checkout trusted default-branch repository context'],
        ] as const) {
            const persisted = cloneWorkflows(`nightly evidence ${job} persisted token`);
            delete recordAt(stepNamed(jobAt(persisted.nightlyEvidenceReporter, job), step), 'with')[
                'persist-credentials'
            ];
            expect(surface(persisted)).toThrow(
                `nightly-evidence-report.yml job ${job} step ${step} must check out with persist-credentials: false`
            );
        }

        const bypassedValidation = cloneWorkflows('nightly evidence validation removed');
        removeStepNamed(
            jobAt(bypassedValidation.nightlyEvidenceReporter, 'validate'),
            'Validate independent run, artifact, jobs and CodeQL analysis'
        );
        expect(() => assertStepInventory(bypassedValidation)).toThrow(
            'nightly-evidence-report.yml job validate steps drifted from the pinned inventory'
        );

        const counterfeitGate = cloneWorkflows('nightly evidence Gate name');
        jobAt(counterfeitGate.nightlyEvidenceReporter, 'publish').name = 'Gate';
        expect(surface(counterfeitGate)).toThrow('nightly-evidence-report.yml job publish must not be named Gate');
    });

    it('refuses a workflows directory that drifts from the recorded file inventory', () => {
        expect(() =>
            assertWorkflowFileInventory(readRecordedWorkflowSnapshot(repositoryRoot), repositoryRoot)
        ).not.toThrow();
        expect(withWorkflowFiles([...HEALTH_GATE_WORKFLOW_FILES])).not.toThrow();

        // Mutation-kill: an unregistered workflow the fixed-file parse never reads can
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
        removeStepNamed(jobAt(missingPnpmSetup, 'build'), PNPM_SETUP_STEP);
        expect(() => assertPnpmBeforeNodeOrder(missingPnpmSetup)).toThrow(
            `build must run ${PNPM_SETUP_STEP} immediately before ${NODE_SETUP_STEP} when setup-node caches pnpm`
        );

        const reversedSetup = asRecord(structuredClone(nightly), 'reversed pnpm setup nightly');
        swapStepsNamed(jobAt(reversedSetup, 'build'), PNPM_SETUP_STEP, NODE_SETUP_STEP);
        expect(() => assertPnpmBeforeNodeOrder(reversedSetup)).toThrow(
            `build must run ${PNPM_SETUP_STEP} immediately before ${NODE_SETUP_STEP} when setup-node caches pnpm`
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

    // Measured budget, not the 5 s default: discovering addon-loading specs
    // reads every spec under src once per process — 7.2 s on a cold external-SSD
    // file cache under load (#5106), 19 s on a loaded lane — and no narrower
    // scan exists, because any spec under src may import the addon.
    it('builds the native addon and runs every spec that loads it, unsoftened', { timeout: 60_000 }, () => {
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

    // Same measured budget: both assertions reach the addon discovery through
    // assertNativeParityJob, whose scan is cold whenever this row runs alone.
    it('refuses an addon presence guard that cannot fail', { timeout: 60_000 }, () => {
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

    it('scopes every cargo registry index cache key and restore key to its own job', () => {
        expect(() => assertCargoIndexCacheKeysJobScoped(validationWorkflow)).not.toThrow();

        // The pre-#5136 shared forms. The recorded escape: revert a native job
        // to these and re-record the snapshot — the snapshot leg greens in
        // lockstep, while this named pin reads the workflow and stays red.
        const sharedKey = "cargo-index-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('Cargo.lock') }}";
        const sharedRestoreKeys = 'cargo-index-${{ runner.os }}-${{ runner.arch }}-\n';

        const sharedKeyJob = asRecord(structuredClone(validationWorkflow), 'shared cargo-index key');
        const sharedKeyStep = stepNamed(jobAt(sharedKeyJob, 'native-macos'), 'Cache the cargo registry index');
        recordAt(sharedKeyStep, 'with').key = sharedKey;
        recordAt(sharedKeyStep, 'with')['restore-keys'] = sharedRestoreKeys;
        expect(() => assertCargoIndexCacheKeysJobScoped(sharedKeyJob)).toThrow(
            'the native-macos cargo-index cache key must embed ${{ github.job }}'
        );

        // A key that keeps its job scope but restores on the shared prefix
        // still hands the other macOS job's index over on a partial match.
        const sharedRestoreJob = asRecord(structuredClone(validationWorkflow), 'shared cargo-index restore keys');
        const sharedRestoreStep = stepNamed(jobAt(sharedRestoreJob, 'native-macos'), 'Cache the cargo registry index');
        recordAt(sharedRestoreStep, 'with')['restore-keys'] = sharedRestoreKeys;
        expect(() => assertCargoIndexCacheKeysJobScoped(sharedRestoreJob)).toThrow(
            'the native-macos cargo-index restore keys must embed ${{ github.job }}'
        );

        // Both macOS jobs on the shared key is the poisoning race itself: the
        // cross-job equality clauses refuse it before the expression checks run.
        const collidingJobs = asRecord(structuredClone(validationWorkflow), 'colliding cargo-index keys');
        for (const jobId of ['native-macos', 'native-parity'] as const) {
            const collidingStep = stepNamed(jobAt(collidingJobs, jobId), 'Cache the cargo registry index');
            recordAt(collidingStep, 'with').key = sharedKey;
            recordAt(collidingStep, 'with')['restore-keys'] = sharedRestoreKeys;
        }
        expect(() => assertCargoIndexCacheKeysJobScoped(collidingJobs)).toThrow(
            'the native-macos and native-parity cargo-index cache keys must differ per job'
        );

        // A removed layer must vacate this pin loudly rather than guard nothing.
        const emptiedJobs = asRecord(structuredClone(validationWorkflow), 'emptied cargo-index layer');
        for (const jobId of ['native-macos', 'native-windows', 'native-parity'] as const) {
            removeStepNamed(jobAt(emptiedJobs, jobId), 'Cache the cargo registry index');
        }
        expect(() => assertCargoIndexCacheKeysJobScoped(emptiedJobs)).toThrow(
            'the cargo registry index cache layer must keep a keyed actions/cache step'
        );
    });

    it('seeds complete Cargo dependencies on main and consumes only exact Linux and macOS hits offline', () => {
        const seed = loadWorkflow('cargo-dependency-seed.yml').parsed;
        expect(() => assertCargoDependencySeed(seed, validationWorkflow)).not.toThrow();

        const missingRegistry = asRecord(structuredClone(seed), 'seed missing registry');
        recordAt(stepNamed(jobAt(missingRegistry, 'rust'), 'Cache Cargo dependencies'), 'with').path =
            '~/.cargo/registry';
        expect(() => assertCargoDependencySeed(missingRegistry, validationWorkflow)).toThrow();

        const mismatchedKey = asRecord(structuredClone(validationWorkflow), 'mismatched key');
        recordAt(stepNamed(jobAt(mismatchedKey, 'rust'), 'Cache Cargo dependencies'), 'with').key =
            CARGO_DEPENDENCY_KEY.replace(", 'rust-toolchain.toml'", '');
        expect(() => assertCargoDependencySeed(seed, mismatchedKey)).toThrow();

        const targetCoupled = asRecord(structuredClone(validationWorkflow), 'target coupled');
        recordAt(
            stepNamed(jobAt(targetCoupled, 'rust'), 'Server and Rust workspace health gates'),
            'env'
        ).CARGO_NET_OFFLINE =
            "${{ steps.rust-cache.outputs.cache-hit == 'true' && steps.cargo-deps.outputs.cache-hit == 'true' && 'true' || 'false' }}";
        expect(() => assertCargoDependencySeed(seed, targetCoupled)).toThrow();

        const prefixAdmitted = asRecord(structuredClone(validationWorkflow), 'prefix admitted');
        recordAt(
            stepNamed(jobAt(prefixAdmitted, 'rust'), 'Server and Rust workspace health gates'),
            'env'
        ).CARGO_NET_OFFLINE = "${{ steps.cargo-deps.outputs.cache-matched-key && 'true' || 'false' }}";
        expect(() => assertCargoDependencySeed(seed, prefixAdmitted)).toThrow();

        const missingNativeTest = asRecord(structuredClone(seed), 'missing native test');
        removeStepNamed(jobAt(missingNativeTest, 'native-macos'), 'Test the native crate');
        expect(() => assertCargoDependencySeed(missingNativeTest, validationWorkflow)).toThrow();

        const unsafeTrigger = asRecord(structuredClone(seed), 'unsafe trigger');
        recordAt(unsafeTrigger, 'on').workflow_dispatch = {};
        expect(() => assertCargoDependencySeed(unsafeTrigger, validationWorkflow)).toThrow();

        const unsafePermissions = asRecord(structuredClone(seed), 'unsafe permissions');
        recordAt(unsafePermissions, 'permissions').contents = 'write';
        expect(() => assertCargoDependencySeed(unsafePermissions, validationWorkflow)).toThrow();

        const reorderedCache = asRecord(structuredClone(seed), 'reordered cache');
        arrayAt(jobAt(reorderedCache, 'rust'), 'steps').reverse();
        expect(() => assertCargoDependencySeed(reorderedCache, validationWorkflow)).toThrow();
    });

    it('restores only an exact installed Linux compiler before setup and health gates', () => {
        const seed = loadWorkflow('cargo-dependency-seed.yml').parsed;
        const expectedKey =
            "pinned-rust-v1-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('rust-toolchain.toml') }}";
        const expectedRun =
            'bash scripts/ensurePinnedRustToolchain.sh "${{ steps.pinned-toolchain.outputs.cache-hit }}"';
        for (const [workflow, jobName, cacheAction] of [
            [validationWorkflow, 'rust', 'actions/cache/restore@0057852bfaa89a56745cba8c7296529d2fc39830'],
            [seed, 'rust', 'actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830'],
        ] as const) {
            const job = jobAt(workflow, jobName);
            const steps = arrayAt(job, 'steps').map((step) => asRecord(step, 'step'));
            const cache = stepNamed(job, 'Restore pinned Rust toolchain');
            expect(cache.uses).toBe(cacheAction);
            expect(cache.id).toBe('pinned-toolchain');
            expect(recordAt(cache, 'with')).toEqual({ path: '~/.rustup/toolchains', key: expectedKey });
            expect(stepNamed(job, 'Install the pinned Rust toolchain').run).toBe(expectedRun);
            expect(steps.indexOf(cache)).toBeLessThan(
                steps.indexOf(stepNamed(job, 'Install the pinned Rust toolchain'))
            );
            expect(steps.indexOf(stepNamed(job, 'Install the pinned Rust toolchain'))).toBeLessThan(
                steps.indexOf(stepNamed(job, 'Cache cargo build'))
            );
        }
        expect(arrayAt(recordAt(recordAt(seed, 'on'), 'push'), 'paths')).toContain(
            'scripts/ensurePinnedRustToolchain.sh'
        );
        for (const path of [
            'scripts/ensurePinnedRustToolchain.sh',
            '.github/workflows/validation.yml',
            '.github/workflows/cargo-dependency-seed.yml',
        ]) {
            expect(scopeFilterPatterns(validationWorkflow, 'rust')).toContain(path);
        }
        expect(stepNamed(jobAt(validationWorkflow, 'rust'), 'Server and Rust workspace health gates').run).toBe(
            'pnpm health:server:full'
        );
        expect(stepNamed(jobAt(seed, 'rust'), 'Rust workspace health gates').run).toBe(
            'sh scripts/health-gates-rust.sh'
        );
    });

    it('invalidates both macOS index identities for every Cargo graph input', () => {
        const seed = loadWorkflow('cargo-dependency-seed.yml').parsed;
        const graphInputs = ['Cargo.lock', '**/Cargo.toml', '.cargo/config.toml', 'rust-toolchain.toml'];
        const expectedKey =
            "cargo-index-v2-${{ runner.os }}-${{ runner.arch }}-${{ github.job }}-${{ hashFiles('Cargo.lock', '**/Cargo.toml', '.cargo/config.toml', 'rust-toolchain.toml') }}";
        const expectedRestore = 'cargo-index-v2-${{ runner.os }}-${{ runner.arch }}-${{ github.job }}-\n';
        const assertGraphIdentity = (producer: UnknownRecord, consumer: UnknownRecord): void => {
            for (const job of [jobAt(producer, 'native-macos'), jobAt(consumer, 'native-macos')]) {
                const options = recordAt(stepNamed(job, 'Cache the cargo registry index'), 'with');
                expect(options.key).toBe(expectedKey);
                expect(options['restore-keys']).toBe(expectedRestore);
            }
        };

        expect(() => assertGraphIdentity(seed, validationWorkflow)).not.toThrow();
        for (const input of graphInputs.slice(1)) {
            for (const side of ['producer', 'consumer'] as const) {
                const producer = asRecord(structuredClone(seed), `${side} producer`);
                const consumer = asRecord(structuredClone(validationWorkflow), `${side} consumer`);
                const job = side === 'producer' ? jobAt(producer, 'native-macos') : jobAt(consumer, 'native-macos');
                const options = recordAt(stepNamed(job, 'Cache the cargo registry index'), 'with');
                options.key = expectedKey.replace(`, '${input}'`, '');
                expect(() => assertGraphIdentity(producer, consumer)).toThrow();
            }
        }
    });

    // The guard storage specs require an account with no uninspectable same-UID
    // process; the hosted runner account has them, so every unit shard route,
    // scheduled or required, enters the fresh unprivileged account.
    it.each([
        ['validation.yml', validationWorkflow],
        ['nightly.yml', nightly],
    ])('runs %s unit install and shards through a fresh unprivileged identity', (_file, workflow) => {
        const unit = jobAt(workflow, 'unit');
        const prepare = stepNamed(unit, 'Prepare isolated unit account');
        const install = stepNamed(unit, 'Install dependencies');
        const shard = stepNamed(unit, 'Run shard');
        const steps = arrayAt(unit, 'steps');
        const tools = stepNamed(unit, 'Prepare unit tool directory');
        expect(tools.id).toBe('unit_tools');
        expect(steps.indexOf(tools)).toBeLessThan(steps.indexOf(stepNamed(unit, 'Set up pnpm')));
        expect(recordAt(stepNamed(unit, 'Set up pnpm'), 'with').dest).toBe('${{ steps.unit_tools.outputs.root }}');
        expect(recordAt(prepare, 'env').SOURDAW_UNIT_TOOL_ROOT).toBe('${{ steps.unit_tools.outputs.root }}');
        expect(prepare.id).toBe('unit_isolation');
        expect(stringAt(prepare, 'run')).toBe('node scripts/runIsolatedUnitShard.ts prepare');
        expect(steps.indexOf(prepare)).toBeLessThan(steps.indexOf(install));
        expect(stringAt(install, 'run')).toBe(
            'node scripts/runIsolatedUnitShard.ts install --context "${{ steps.unit_isolation.outputs.context }}"'
        );
        expect(stringAt(shard, 'run')).toBe(
            'node scripts/runIsolatedUnitShard.ts shard --context "${{ steps.unit_isolation.outputs.context }}" --shard=${{ matrix.shard }}/4'
        );
        for (const step of [prepare, install, shard]) {
            expect(step.if).toBeUndefined();
            expect(step['continue-on-error']).toBeUndefined();
        }
        expect(recordAt(stepNamed(unit, 'Checkout'), 'with')).toMatchObject({
            'fetch-depth': 0,
            'persist-credentials': false,
        });
        expect(recordAt(shard, 'env').VITEST_MAX_WORKERS).toBe(4);
        // One shard's failure must not cancel the others' evidence.
        expect(recordAt(unit, 'strategy')['fail-fast']).toBe(false);
    });

    it('fetches provenance history in static validation and the unit matrix', () => {
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
        expect(BROWSER_AI_WEBGPU_GLOBAL_TIMEOUT_MS / 60_000).toBeLessThan(BROWSER_AI_WEBGPU_STEP_TIMEOUT_MINUTES);
        expect(BROWSER_AI_WEBGPU_STEP_TIMEOUT_MINUTES).toBeLessThan(BROWSER_AI_WEBGPU_JOB_TIMEOUT_MINUTES);

        const unboundedSetup = asRecord(structuredClone(heavyWorkflow), 'unbounded Browser AI setup');
        delete stepNamed(jobAt(unboundedSetup, BROWSER_AI_WEBGPU_JOB), 'Set up Node')['timeout-minutes'];
        expect(() => assertBrowserAiWebGpuJob(unboundedSetup)).toThrow('Browser AI WebGPU must bound every named step');

        const exhaustedBudget = asRecord(structuredClone(heavyWorkflow), 'exhausted Browser AI budget');
        stepNamed(jobAt(exhaustedBudget, BROWSER_AI_WEBGPU_JOB), 'Install dependencies')['timeout-minutes'] = 10;
        expect(() => assertBrowserAiWebGpuJob(exhaustedBudget)).toThrow(
            'Browser AI WebGPU step budgets must leave two minutes for runner overhead'
        );

        // Execute the workflow's actual shell block with a fake pnpm. A
        // pipeline that reports tee's success instead of pnpm's failure would
        // turn a failed hardware proof into a passing required Gate.
        const admissionRun = stringAt(
            stepNamed(jobAt(heavyWorkflow, BROWSER_AI_WEBGPU_JOB), 'Run Browser AI WebGPU admission'),
            'run'
        );
        for (const exitCode of [0, 7]) {
            const directory = mkdtempSync(join(tmpdir(), 'sourdaw-browser-ai-webgpu-diagnostics-'));
            try {
                writeFileSync(
                    join(directory, 'pnpm'),
                    '#!/bin/sh\nprintf "pnpm called: %s; DEBUG=%s\\n" "$*" "$DEBUG"\nexit "$FAKE_PNPM_EXIT"\n',
                    { mode: 0o755 }
                );
                const result = spawnSync('bash', ['-c', admissionRun], {
                    cwd: directory,
                    encoding: 'utf8',
                    env: {
                        ...process.env,
                        DEBUG: 'pw:api,pw:browser',
                        FAKE_PNPM_EXIT: String(exitCode),
                        PATH: `${directory}${delimiter}${process.env.PATH ?? ''}`,
                    },
                    timeout: 10_000,
                });
                expect(result.error).toBeUndefined();
                expect(result.status).toBe(exitCode);
                const log = readFileSync(join(directory, BROWSER_AI_WEBGPU_LOG), 'utf8');
                expect(log).toContain('pnpm called: test:e2e:browser-ai-webgpu-admission; DEBUG=pw:api,pw:browser');
                expect(log).toMatch(/\[browser-ai-webgpu\] started \d{4}-\d{2}-\d{2}T/);
                expect(log).toContain(`command=${exitCode} log=0`);
            } finally {
                rmSync(directory, { recursive: true, force: true });
            }
        }

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
            'Browser AI WebGPU job must retain its selected hardware condition'
        );

        const defaultMatrix = asRecord(structuredClone(heavyWorkflow), 'default-matrix Browser AI heavyWorkflow');
        stepNamed(jobAt(defaultMatrix, BROWSER_AI_WEBGPU_JOB), 'Run Browser AI WebGPU admission').run =
            'pnpm test:e2e tests/e2e/browserAiWebGpuAdmission.spec.ts';
        expect(() => assertBrowserAiWebGpuJob(defaultMatrix)).toThrow(
            'Browser AI WebGPU job must run the dedicated hardware command'
        );

        const unboundedAdmission = asRecord(structuredClone(heavyWorkflow), 'unbounded Browser AI admission');
        delete stepNamed(jobAt(unboundedAdmission, BROWSER_AI_WEBGPU_JOB), 'Run Browser AI WebGPU admission')[
            'timeout-minutes'
        ];
        expect(() => assertBrowserAiWebGpuJob(unboundedAdmission)).toThrow(
            'Browser AI WebGPU admission must fail before the job limit with Playwright diagnostics'
        );

        const skippedDiagnostics = asRecord(structuredClone(heavyWorkflow), 'skipped Browser AI diagnostics');
        stepNamed(jobAt(skippedDiagnostics, BROWSER_AI_WEBGPU_JOB), 'Upload Browser AI WebGPU diagnostics').if =
            '${{ success() }}';
        expect(() => assertBrowserAiWebGpuJob(skippedDiagnostics)).toThrow(
            'Browser AI WebGPU diagnostics must retain only the log and failure traces after a failed step'
        );

        const unboundedHeavyInstall = asRecord(structuredClone(heavyWorkflow), 'unbounded Browser AI heavyWorkflow');
        delete stepNamed(jobAt(unboundedHeavyInstall, BROWSER_AI_WEBGPU_JOB), 'Install Chromium')['timeout-minutes'];
        expect(() => assertBrowserAiWebGpuJob(unboundedHeavyInstall)).toThrow(
            'Browser AI WebGPU must bound every named step'
        );

        const unboundedNightlyInstall = asRecord(structuredClone(nightly), 'unbounded Browser AI nightly');
        delete stepNamed(jobAt(unboundedNightlyInstall, BROWSER_AI_WEBGPU_JOB), 'Install Chromium')['timeout-minutes'];
        expect(() => assertNightlyBrowserAiWebGpuJob(unboundedNightlyInstall)).toThrow(
            'Browser AI WebGPU job must bound its Chromium install so a stalled download fails fast'
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

        const unboundedProof = asRecord(structuredClone(browserAiWebGpuConfig), 'unbounded Browser AI config');
        delete unboundedProof.globalTimeout;
        expect(() => assertBrowserAiWebGpuProofChain(packageManifest, unboundedProof)).toThrow(
            'Browser AI WebGPU config must bound the whole dedicated proof without retries or parallel tests'
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

    it('reports a sole nightly E2E report failure on scheduled runs', () => {
        const report = jobAt(nightly, 'nightly-report');
        expect.soft(arrayAt(report, 'needs')).toContain('e2e-report');
        expect(report.if).toBe("${{ failure() && github.event_name == 'schedule' }}");

        const reporter = stepNamed(report, 'Open or update the nightly failure issue');
        expect(recordAt(reporter, 'env').RESULTS).toBe('${{ toJSON(needs) }}');

        const runReporter = (existingIssue: '' | '37') => {
            const directory = mkdtempSync(join(tmpdir(), 'sourdaw-nightly-report-'));
            try {
                const bin = join(directory, 'bin');
                mkdirSync(bin);
                writeFileSync(
                    join(bin, 'gh'),
                    [
                        '#!/usr/bin/env node',
                        "const fs = require('node:fs');",
                        'const args = process.argv.slice(2);',
                        "const fail = () => { process.stderr.write('unsupported gh invocation\\n'); process.exit(97); };",
                        'const append = () => fs.appendFileSync(process.env.GH_CAPTURE, `${JSON.stringify(args)}\\n`);',
                        "if (JSON.stringify(args) === JSON.stringify(['issue', 'list', '--repo', 'owner/repository', '--state', 'open', '--search', '\"ci(nightly): health gates red on main\" in:title', '--json', 'number', '--jq', '.[0].number // empty'])) {",
                        '  append();',
                        "  if (process.env.GH_LOOKUP_RESULT === '37') process.stdout.write('37\\n');",
                        "  else if (process.env.GH_LOOKUP_RESULT !== '') fail();",
                        '  process.exit(0);',
                        '}',
                        "if (args[0] === 'issue' && args[1] === 'create' && process.env.GH_LOOKUP_RESULT === '') {",
                        "  if (args.length !== 14 || args[2] !== '--repo' || args[3] !== 'owner/repository' || args[4] !== '--title' || args[5] !== 'ci(nightly): health gates red on main' || args[6] !== '--body' || args[8] !== '--label' || args[9] !== 'bug' || args[10] !== '--label' || args[11] !== 'status:ready' || args[12] !== '--label' || args[13] !== 'priority:P1') fail();",
                        "  if (!args[7].includes('Failing jobs: e2e-report') || !args[7].includes('https://github.com/owner/repository/actions/runs/1')) fail();",
                        '  append();',
                        '  process.exit(0);',
                        '}',
                        "if (args[0] === 'issue' && args[1] === 'comment' && process.env.GH_LOOKUP_RESULT === '37') {",
                        "  if (args.length !== 7 || args[2] !== '37' || args[3] !== '--repo' || args[4] !== 'owner/repository' || args[5] !== '--body' || !args[6].includes('Failing jobs: e2e-report') || !args[6].includes('https://github.com/owner/repository/actions/runs/1')) fail();",
                        '  append();',
                        '  process.exit(0);',
                        '}',
                        'fail();',
                    ].join('\n'),
                    { mode: 0o755 }
                );
                const result = spawnSync('bash', ['-c', stringAt(reporter, 'run')], {
                    encoding: 'utf8',
                    env: {
                        ...process.env,
                        GH_CAPTURE: join(directory, 'gh-calls.txt'),
                        GH_TOKEN: 'unit-test',
                        GITHUB_REPOSITORY: 'owner/repository',
                        GH_LOOKUP_RESULT: existingIssue,
                        PATH: `${bin}:${process.env.PATH ?? ''}`,
                        RESULTS: JSON.stringify({ 'e2e-report': { result: 'failure' } }),
                        RUN_URL: 'https://github.com/owner/repository/actions/runs/1',
                    },
                });
                expect(result.status, result.stderr).toBe(0);
                return readFileSync(join(directory, 'gh-calls.txt'), 'utf8')
                    .trim()
                    .split('\n')
                    .map((line) => JSON.parse(line) as string[]);
            } finally {
                rmSync(directory, { recursive: true, force: true });
            }
        };

        const createCalls = runReporter('');
        expect(createCalls).toHaveLength(2);
        expect(createCalls[0]).toEqual(expect.arrayContaining(['issue', 'list']));
        const createCall = createCalls[1];
        if (createCall === undefined) {
            throw new Error('nightly issue create call was not captured');
        }
        expect(createCall.slice(0, 2)).toEqual(['issue', 'create']);
        const createdBody = createCall[7];
        expect(createdBody).toContain('Failing jobs: e2e-report');
        expect(createdBody).toContain('https://github.com/owner/repository/actions/runs/1');

        const updateCalls = runReporter('37');
        expect(updateCalls).toHaveLength(2);
        expect(updateCalls[0]).toEqual(expect.arrayContaining(['issue', 'list']));
        const updateCall = updateCalls[1];
        if (updateCall === undefined) {
            throw new Error('nightly issue comment call was not captured');
        }
        expect(updateCall.slice(0, 3)).toEqual(['issue', 'comment', '37']);
        expect(updateCall[6]).toContain('Failing jobs: e2e-report');
        expect(updateCall[6]).toContain('https://github.com/owner/repository/actions/runs/1');
    });

    it('requires selected PR and browser checks to succeed, including after cancellation', () => {
        const gateScript = assertGateContract(workflow, 'gate', 'Gate', GATE_CONDITION);
        const requiredResults = (
            codeql: 'true' | 'false',
            overrides: Record<string, JobResult> = {},
            admitted: 'true' | 'false' = 'true'
        ) =>
            JSON.stringify({
                admission: {
                    result: overrides.admission ?? 'success',
                    outputs: { admitted, reason: 'the reviewer App has not approved head abc' },
                },
                scope: {
                    result: overrides.scope ?? 'success',
                    outputs: { browser: 'true', 'browser-ai': 'false', codeql },
                },
                validation: { result: overrides.validation ?? 'success' },
                affected: { result: overrides.affected ?? 'success' },
                codeql: { result: overrides.codeql ?? (codeql === 'true' ? 'success' : 'skipped') },
            });
        expect(runResultsGuard(gateScript, requiredResults('true'))).toBe(0);
        expect(runResultsGuard(gateScript, requiredResults('false'))).toBe(0);
        for (const dependency of ['admission', 'scope', 'validation', 'affected', 'codeql']) {
            for (const result of ['failure', 'cancelled', 'skipped'] as const) {
                expect(runResultsGuard(gateScript, requiredResults('true', { [dependency]: result }))).not.toBe(0);
            }
        }
        // A refused admission skips every heavy job; Gate must fail, never pass on the skips, and say why.
        const refused = JSON.stringify({
            admission: {
                result: 'success',
                outputs: { admitted: 'false', reason: 'the reviewer App has not approved head abc' },
            },
            scope: { result: 'skipped', outputs: {} },
            validation: { result: 'skipped' },
            affected: { result: 'skipped' },
            codeql: { result: 'skipped' },
        });
        expect(runResultsGuard(gateScript, refused)).not.toBe(0);
        expect(
            spawnSync('bash', ['-c', gateScript], { encoding: 'utf8', env: { ...process.env, RESULTS: refused } })
                .stdout
        ).toMatch(/^::error title=Gate not admitted::the reviewer App has not approved head abc\n/u);
        expect(runResultsGuard(gateScript, requiredResults('true', {}, 'false'))).not.toBe(0);
        expect(runResultsGuard(gateScript, requiredResults('false', { codeql: 'success' }))).not.toBe(0);
        expect(
            runResultsGuard(gateScript, requiredResults('true').replace('"browser":"true"', '"browser":""'))
        ).not.toBe(0);
        expect(runResultsGuard(gateScript, '{}')).not.toBe(0);
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
        stepNamed(jobAt(conditionalGateGuard, 'gate'), 'Require selected checks to succeed').if = 'false';
        expect(() => assertGateContract(conditionalGateGuard, 'gate', 'Gate', GATE_CONDITION)).toThrow(
            'the gate guard step must run after cancellation'
        );

        const heavyGateScript = assertGateContract(heavyWorkflow, 'heavy-gate', 'HeavyGate', HEAVY_GATE_CONDITION);
        const browserResults = (e2e: JobResult, report: JobResult, hardware: JobResult) =>
            JSON.stringify({
                e2e: { result: e2e },
                'e2e-report': { result: report },
                'browser-ai-webgpu': { result: hardware },
            });
        const selectedMatrix = JSON.stringify({ include: [{ id: 1, specs: ['tests/e2e/export.spec.ts'] }] });
        const emptyMatrix = JSON.stringify({ include: [] });
        expect(
            runResultsGuard(heavyGateScript, browserResults('success', 'success', 'skipped'), {
                MATRIX: selectedMatrix,
                BROWSER_AI: 'false',
            })
        ).toBe(0);
        expect(
            runResultsGuard(heavyGateScript, browserResults('skipped', 'skipped', 'skipped'), {
                MATRIX: emptyMatrix,
                BROWSER_AI: 'false',
            })
        ).toBe(0);
        expect(
            runResultsGuard(heavyGateScript, browserResults('success', 'success', 'success'), {
                MATRIX: selectedMatrix,
                BROWSER_AI: 'true',
            })
        ).toBe(0);
        for (const result of ['failure', 'cancelled', 'skipped'] as const) {
            expect(
                runResultsGuard(heavyGateScript, browserResults(result, 'success', 'skipped'), {
                    MATRIX: selectedMatrix,
                    BROWSER_AI: 'false',
                })
            ).not.toBe(0);
        }
        expect(
            runResultsGuard(heavyGateScript, browserResults('success', 'skipped', 'skipped'), {
                MATRIX: selectedMatrix,
                BROWSER_AI: 'false',
            })
        ).not.toBe(0);
        expect(
            runResultsGuard(heavyGateScript, browserResults('success', 'success', 'skipped'), {
                MATRIX: selectedMatrix,
                BROWSER_AI: 'true',
            })
        ).not.toBe(0);
        expect(
            runResultsGuard(heavyGateScript, browserResults('skipped', 'skipped', 'skipped'), {
                MATRIX: '{"include":[{"id":1,"specs":[]}]}',
                BROWSER_AI: 'false',
            })
        ).not.toBe(0);

        const softenedHeavyGate = asRecord(structuredClone(heavyWorkflow), 'softened heavy gate heavyWorkflow');
        jobAt(softenedHeavyGate, 'heavy-gate')['continue-on-error'] = true;
        expect(() => assertGateContract(softenedHeavyGate, 'heavy-gate', 'HeavyGate', HEAVY_GATE_CONDITION)).toThrow(
            'the HeavyGate job must not continue on error'
        );

        const conditionalHeavyGateGuard = asRecord(
            structuredClone(heavyWorkflow),
            'conditional-guard heavy gate heavyWorkflow'
        );
        stepNamed(jobAt(conditionalHeavyGateGuard, 'heavy-gate'), 'Require selected browser jobs to succeed').if =
            'false';
        expect(() =>
            assertGateContract(conditionalHeavyGateGuard, 'heavy-gate', 'HeavyGate', HEAVY_GATE_CONDITION)
        ).toThrow('the heavy-gate guard step must run after cancellation');
    });

    it('makes the selected tooling unit job mandatory in the validation result', () => {
        const gate = jobAt(validationWorkflow, 'validation-gate');
        expect(gate.if).toBe(GATE_CONDITION);
        expect(arrayAt(gate, 'needs')).toEqual(VALIDATION_JOBS.filter((job) => job !== 'validation-gate'));
        expect(gate['continue-on-error']).toBeUndefined();
        const step = stepNamed(gate, 'Require selected validation jobs to succeed');
        expect(step.if).toBe(GATE_CONDITION);
        expect(recordAt(step, 'env').RESULTS).toBe('${{ toJSON(needs) }}');
        expect(recordAt(step, 'env').MODE).toBe('${{ inputs.mode }}');
        const script = stringAt(step, 'run');
        const scope = runScopeScript(assertScopeContract(validationWorkflow), 'pull_request', {
            PROFILE: 'tooling',
            WEB: 'true',
            UNCLASSIFIED: 'true',
            BROWSER: 'false',
        });
        const selected = new Set(selectedPrValidationJobs(scope));
        const results: Record<string, { result: string; outputs?: UnknownRecord }> = Object.fromEntries(
            VALIDATION_JOBS.filter((job) => job !== 'validation-gate').map((job) => [
                job,
                { result: selected.has(job) ? 'success' : 'skipped' },
            ])
        );
        results.decide = { result: 'success', outputs: scope };
        const run = (value: unknown) =>
            runResultsGuard(script, JSON.stringify(value), { PULL_REQUEST: 'true', MODE: 'full' });
        expect(run(results)).toBe(0);
        for (const outcome of ['failure', 'cancelled', 'skipped'] as const) {
            expect(run({ ...results, 'tooling-unit': { result: outcome } })).not.toBe(0);
        }
        const missing = { ...results };
        delete missing['tooling-unit'];
        expect(run(missing)).not.toBe(0);
        expect(run({ ...results, unit: { result: 'success' } })).not.toBe(0);
        const broadScope = runScopeScript(assertScopeContract(validationWorkflow), 'pull_request', {
            RUST: 'true',
            SERVER: 'true',
            WEB: 'true',
            BROWSER: 'true',
        });
        const broadSelected = new Set(selectedPrValidationJobs(broadScope));
        const full: Record<string, { result: string; outputs?: UnknownRecord }> = Object.fromEntries(
            VALIDATION_JOBS.filter((job) => job !== 'validation-gate').map((job) => [
                job,
                { result: broadSelected.has(job) ? 'success' : 'skipped' },
            ])
        );
        full.decide = { result: 'success', outputs: broadScope };
        expect(run(full)).toBe(0);
        const broadJobs = ['unit', 'build', 'rust', 'native-macos', 'native-windows', 'native-parity'];
        for (const job of broadJobs) {
            for (const outcome of ['failure', 'cancelled', 'skipped']) {
                expect(run({ ...full, [job]: { result: outcome } })).not.toBe(0);
            }
            const missingJob = { ...full };
            delete missingJob[job];
            expect(run(missingJob)).not.toBe(0);
        }
        const preliminary = { ...full, ...Object.fromEntries(broadJobs.map((job) => [job, { result: 'skipped' }])) };
        const runMode = (value: unknown, mode: string) =>
            runResultsGuard(script, JSON.stringify(value), { PULL_REQUEST: 'true', MODE: mode });
        expect(runMode(preliminary, 'preliminary')).toBe(0);
        expect(runMode({ ...preliminary, lint: { result: 'failure' } }, 'preliminary')).not.toBe(0);
        expect(runMode({ ...preliminary, unit: { result: 'success' } }, 'preliminary')).not.toBe(0);
        for (const mode of ['', 'invalid']) {
            expect(runMode(full, mode)).not.toBe(0);
            expect(() =>
                runScopeScript(assertScopeContract(validationWorkflow), 'pull_request', { MODE: mode })
            ).toThrow();
        }
        const wrongRequiredMode = cloneWorkflows('preliminary required validation');
        recordAt(jobAt(wrongRequiredMode.health, 'validation'), 'with').mode = 'preliminary';
        expect(() => assertJobGraph(wrongRequiredMode)).toThrow();
        const missingRequiredMode = cloneWorkflows('missing required validation mode');
        delete recordAt(jobAt(missingRequiredMode.health, 'validation'), 'with').mode;
        expect(() => assertJobGraph(missingRequiredMode)).toThrow();
    });

    it('runs a trusted, credentialless scanner over the untrusted target history', () => {
        expect(() => assertCredentiallessScanner(nightly)).not.toThrow();
        const targetControlledScanner = asRecord(structuredClone(nightly), 'target-controlled scanner nightly');
        recordAt(stepNamed(jobAt(targetControlledScanner, 'secrets'), 'Checkout trusted scanner'), 'with').ref =
            SCAN_TARGET_REF;
        expect(() => assertCredentiallessScanner(targetControlledScanner)).toThrow(
            'secret scanner must come from the trusted base and retain no credentials'
        );
        const tokenBearingScanner = asRecord(structuredClone(nightly), 'token-bearing scanner nightly');
        jobAt(tokenBearingScanner, 'secrets').env = { GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}' };
        expect(() => assertCredentiallessScanner(tokenBearingScanner)).toThrow(
            'secret scan job must not reference GitHub tokens or repository secrets'
        );
    });

    it('splits the nightly server gate from the crates the web deploy waits on', () => {
        expect(() => assertNightlyRustServerSplit(nightly)).not.toThrow();

        // The pre-split combined condition is the regression itself: it runs
        // the crate leg on a server-only change and reads the deploy-relevant
        // scope as covering the server. Each split leg answers to one scope.
        const combinedScopes = asRecord(structuredClone(nightly), 'combined-scope nightly rust');
        jobAt(combinedScopes, NIGHTLY_RUST_JOB).if = RUST_CONDITION;
        expect(() => assertNightlyRustServerSplit(combinedScopes)).toThrow(
            'the nightly Rust workspace leg must answer to the Rust scope alone'
        );

        // A server leg gated on nothing runs nowhere and proves nothing.
        const ungatedServerLeg = cloneWorkflows('ungated collaboration server leg');
        delete jobAt(ungatedServerLeg.nightly, COLLAB_SERVER_JOB).if;
        expect(() => assertNightlyRustServerSplit(ungatedServerLeg.nightly)).toThrow(
            'the collaboration server leg must answer to the server scope alone'
        );

        const renamedServerLeg = cloneWorkflows('renamed collaboration server leg');
        jobAt(renamedServerLeg.nightly, COLLAB_SERVER_JOB).name = 'Collaboration relay';
        expect(() => assertNightlyRustServerSplit(renamedServerLeg.nightly)).toThrow(
            'the collaboration server leg must retain its stable name'
        );

        // A gate command that recombines both concerns puts the coupled
        // failure back: the server leg would run the Rust workspace tests,
        // and either concern could fail the other's leg again.
        const recombinedServerGate = cloneWorkflows('recombined collaboration server gate');
        stepNamed(jobAt(recombinedServerGate.nightly, COLLAB_SERVER_JOB), COLLAB_SERVER_GATE_STEP).run =
            'pnpm health:server:full';
        expect(() => assertNightlyRustServerSplit(recombinedServerGate.nightly)).toThrow(
            'the collaboration server leg must run the server gate script'
        );

        const recombinedRustGate = cloneWorkflows('recombined nightly rust gate');
        stepNamed(jobAt(recombinedRustGate.nightly, NIGHTLY_RUST_JOB), NIGHTLY_RUST_GATE_STEP).run =
            'pnpm health:server:full';
        expect(() => assertNightlyRustServerSplit(recombinedRustGate.nightly)).toThrow(
            'the nightly Rust workspace leg must run the split Rust gate script'
        );

        // The freeze #3516 removes: a deploy train that waits on the server
        // leg holds production behind a relay failure the bundle never ships.
        // This is the server-side twin of the native-legs probe below.
        const collabServerReintroducedTrain = asRecord(
            structuredClone(nightly),
            'collab-server-reintroduced deploy train'
        );
        arrayAt(jobAt(collabServerReintroducedTrain, DEPLOY_WEB_JOB), 'needs').push(COLLAB_SERVER_JOB);
        expect(() => assertDailyDeployTrain(collabServerReintroducedTrain)).toThrow(
            'the daily deploy train must depend on exactly the scheduled validation legs'
        );

        // Not freezing the deploy must not mean failing invisibly: the
        // reporter observes every leg a scheduled run performs, server leg
        // included.
        const serverBlindReport = cloneWorkflows('server-blind nightly report');
        const reportNeeds = arrayAt(jobAt(serverBlindReport.nightly, 'nightly-report'), 'needs');
        reportNeeds.splice(reportNeeds.indexOf(COLLAB_SERVER_JOB), 1);
        expect(() => assertJobGraph(serverBlindReport)).toThrow(
            'the nightly reporter must depend on every leg a scheduled run performs'
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

        // A hardcoded alias grades a domain this deployment may never have
        // taken; the resolved list is what keeps the check on domains the
        // deployment record says it did.
        const reboundIsolation = asRecord(structuredClone(nightly), 'rebound-isolation deploy train');
        recordAt(stepNamed(jobAt(reboundIsolation, DEPLOY_WEB_JOB), DEPLOY_WEB_ISOLATION_STEP), 'env').ALIASES =
            'app.sourdaw.studio';
        expect(() => assertDailyDeployTrain(reboundIsolation)).toThrow(
            'the daily deploy train must read its headers back off the public aliases it just resolved'
        );

        // Mutation-kill: the generated deployment URL is exactly what run
        // 33850467688 graded, and Vercel Authentication restricts it, so
        // pointing the assertion back at it must fail this spec.
        const restrictedIsolation = asRecord(structuredClone(nightly), 'restricted-isolation deploy train');
        recordAt(stepNamed(jobAt(restrictedIsolation, DEPLOY_WEB_JOB), DEPLOY_WEB_ISOLATION_STEP), 'env').ALIASES =
            DEPLOYMENT_URL_REFERENCE;
        expect(() => assertDailyDeployTrain(restrictedIsolation)).toThrow(
            'the daily deploy train must read its headers back off the public aliases it just resolved'
        );

        const unidentifiedAliases = asRecord(structuredClone(nightly), 'unidentified-aliases deploy train');
        stepNamed(jobAt(unidentifiedAliases, DEPLOY_WEB_JOB), DEPLOY_WEB_ALIAS_STEP).id = 'domains';
        expect(() => assertDailyDeployTrain(unidentifiedAliases)).toThrow(
            'the daily deploy train must publish the deployment aliases under a stable step id'
        );

        const unboundAliases = asRecord(structuredClone(nightly), 'unbound-aliases deploy train');
        recordAt(stepNamed(jobAt(unboundAliases, DEPLOY_WEB_JOB), DEPLOY_WEB_ALIAS_STEP), 'env').DEPLOYMENT_URL =
            'https://sourdaw.vercel.app';
        expect(() => assertDailyDeployTrain(unboundAliases)).toThrow(
            'the alias step must read the aliases off the deployment this run just created'
        );

        const unauthenticatedAliases = asRecord(structuredClone(nightly), 'unauthenticated-aliases deploy train');
        delete recordAt(stepNamed(jobAt(unauthenticatedAliases, DEPLOY_WEB_JOB), DEPLOY_WEB_ALIAS_STEP), 'env')
            .VERCEL_ORG_ID;
        expect(() => assertDailyDeployTrain(unauthenticatedAliases)).toThrow(
            'the alias step must authenticate its Vercel query from the environment'
        );

        // Mutation-kill: an alias step that writes its own output inline,
        // bypassing the validation the script performs on every hostname it
        // publishes, must fail this spec rather than only at runtime.
        const inlinedAliases = asRecord(structuredClone(nightly), 'inlined-aliases deploy train');
        stepNamed(jobAt(inlinedAliases, DEPLOY_WEB_JOB), DEPLOY_WEB_ALIAS_STEP).run =
            'printf \'aliases=app.sourdaw.studio\\n\' >> "$GITHUB_OUTPUT"';
        expect(() => assertDailyDeployTrain(inlinedAliases)).toThrow(
            'the daily deploy train must resolve its aliases through scripts/resolveVercelDeploymentAliases.ts'
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

        // An inline curl is what this step used to be, and what nothing
        // executes: the grading has to stay in the script the shell witness
        // drives against a fake curl.
        const unassertedIsolation = asRecord(structuredClone(nightly), 'unasserted-isolation deploy train');
        stepNamed(jobAt(unassertedIsolation, DEPLOY_WEB_JOB), DEPLOY_WEB_ISOLATION_STEP).run =
            'curl --fail --silent --head "https://$ALIASES/"';
        expect(() => assertDailyDeployTrain(unassertedIsolation)).toThrow(
            `the daily deploy train must grade isolation through ${DEPLOY_WEB_ISOLATION_SCRIPT}`
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
