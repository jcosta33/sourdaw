/**
 * The structural pins of the registered workflows, shared by both health-gate
 * harnesses — the vitest spec and the shell harness — so the two can never
 * drift apart.
 *
 * Each pin names the property it protects: the registered file set, shard
 * lists, ordered step names, and the pinned step conditions here, and every
 * file's credential surface in `workflowSecuritySurfaceContract.ts`. A recorded
 * whole-file snapshot was regenerated with every deliberate edit, so it
 * blessed whatever it recorded and stood behind no property by itself.
 *
 * GitHub runs whatever the directory holds, and the newest run of a required
 * name satisfies it, `skipped` included, so the directory listing must equal
 * the registered file list.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export const HEALTH_GATE_WORKFLOW_FILES = [
    'health-gates.yml',
    'pr-checks.yml',
    'heavy-gates.yml',
    'validation.yml',
    'nightly.yml',
    'quantum-measurements.yml',
    'wasm-artifacts.yml',
    'semantic-review.yml',
    'cargo-dependency-seed.yml',
] as const;

// The full nightly train and required unit suite retain their fixed shards.
// The pull-request browser matrix is generated from a validated affected plan.
export const UNIT_SHARDS = [1, 2, 3, 4] as const;
export const E2E_SHARDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export const SHARD_MATRIX_JOBS: ReadonlyArray<readonly [string, string, readonly number[]]> = [
    ['validation.yml', 'unit', UNIT_SHARDS],
    ['nightly.yml', 'unit', UNIT_SHARDS],
    ['nightly.yml', 'e2e', E2E_SHARDS],
];

const NODE_SETUP_ACTIONS = ['Checkout', 'Set up pnpm', 'Set up Node'] as const;
const SETUP_NODE = [...NODE_SETUP_ACTIONS, 'Install dependencies'] as const;
const SETUP_PNPM_NODE = ['Checkout', 'Enable Corepack', 'Set up pnpm', 'Set up Node', 'Install dependencies'] as const;
const SHARDED_BROWSER_STEPS = [
    ...SETUP_PNPM_NODE,
    'Install Playwright browsers',
    'Run shard',
    'Report shard failure',
    'Upload blob report',
] as const;
// The required and nightly unit shards both run in a fresh unprivileged account.
const ISOLATED_UNIT_STEPS = [
    'Checkout',
    'Prepare unit tool directory',
    'Set up pnpm',
    'Set up Node',
    'Prepare isolated unit account',
    'Install dependencies',
    'Run shard',
    'Report shard failure',
] as const;
const WEBGPU_ADMISSION_STEPS = [...SETUP_PNPM_NODE, 'Install Chromium', 'Run Browser AI WebGPU admission'] as const;
const NATIVE_MACOS_STEPS = [
    'Checkout',
    'Install the pinned Rust toolchain',
    'Cache cargo build',
    'Cache the cargo registry index',
    'Test the audio crates',
    'Test the native crate',
] as const;
const STATIC_SUITE_STEPS = [
    'Artifact freshness',
    'App types',
    'Test types',
    'Script types',
    'End-to-end types',
    'Desktop shell types',
    'Format',
    'Command argument schemas',
    'Release inventory',
    'Test collection scope',
    'Barrel mock coverage',
    'Device write boundary census',
    'Release proof',
    'Agent delivery scripts',
    'Health gate infrastructure',
] as const;

// Every job in every gate workflow, pinned to its exact ordered step names —
// or `null` for a reusable-workflow caller that must never grow steps. A
// deleted proof step leaves its job green while the proof never runs, and an
// added one runs unpinned; both directions refuse the drift.
export const STEP_INVENTORY: Readonly<Record<string, Readonly<Record<string, readonly string[] | null>>>> = {
    'cargo-dependency-seed.yml': {
        rust: [
            'Checkout',
            'Install ALSA development headers',
            'Restore pinned Rust toolchain',
            'Install the pinned Rust toolchain',
            'Cache cargo build',
            'Cache Cargo dependencies',
            'Rust workspace health gates',
        ],
        'native-macos': NATIVE_MACOS_STEPS,
    },
    'quantum-measurements.yml': {
        measure: [
            'Checkout source head',
            'Set up pnpm',
            'Set up Node',
            'Install dependencies',
            'Install Google Chrome',
            'Verify committed WASM artifacts',
            'Verify exact clean source',
            'Run full browser measurement',
            'Render measurement table',
            'Verify generated table',
            'Verify measurement admission',
            'Assemble qualified artifact',
            'Upload qualified artifact',
        ],
    },
    'wasm-artifacts.yml': {
        'build-artifacts': [
            'Checkout workflow control',
            'Checkout source head',
            'Set up pnpm',
            'Set up Node',
            'Install helper dependencies',
            'Select affected packages',
            'Install pinned generation toolchain',
            'Build and qualify complete artifact',
            'Upload qualified artifact',
        ],
    },
    'health-gates.yml': {
        admission: ['Checkout trusted admission', 'Set up Node', 'Read reviews', 'Decide admission'],
        scope: [...SETUP_PNPM_NODE, 'Plan affected checks', 'Upload scope manifest'],
        validation: null,
        affected: null,
        codeql: ['Checkout', 'Initialise CodeQL', 'Analyse'],
        gate: ['Require selected checks to succeed'],
    },
    'pr-checks.yml': {
        scope: [...SETUP_PNPM_NODE, 'Plan affected checks', 'Upload scope manifest'],
        validation: null,
    },
    'validation.yml': {
        decide: [
            'Checkout',
            'Filter changed paths',
            'Retry changed-paths filter after a transient API failure',
            'Resolve scope',
        ],
        static: [...SETUP_NODE, ...STATIC_SUITE_STEPS],
        lint: [...SETUP_NODE, 'Lint'],
        boundaries: [...SETUP_NODE, 'Validate the dependency graph'],
        unit: ISOLATED_UNIT_STEPS,
        'tooling-unit': [...SETUP_NODE, 'Run script suite'],
        smoke: [...SETUP_NODE, 'Install Playwright browsers', 'Run offline smoke set'],
        build: [...SETUP_NODE, 'Build'],
        rust: [
            ...NODE_SETUP_ACTIONS,
            'Install ALSA development headers',
            'Restore pinned Rust toolchain',
            'Install the pinned Rust toolchain',
            'Cache cargo build',
            'Cache Cargo dependencies',
            'Install server dependencies',
            'Server and Rust workspace health gates',
        ],
        'native-macos': [
            ...NATIVE_MACOS_STEPS,
            'Set up Node for native mutation proof',
            'Verify native transport mutation sensitivity',
            'Upload native transport mutation evidence',
        ],
        'native-windows': [
            'Checkout',
            'Install the pinned Rust toolchain',
            'Cache cargo build',
            'Cache the cargo registry index',
            'Test the audio crates',
        ],
        'native-parity': [
            'Checkout',
            'Install the pinned Rust toolchain',
            'Cache cargo build',
            'Cache the cargo registry index',
            'Set up pnpm',
            'Set up Node',
            'Install dependencies',
            'Build the native addon',
            'Require the built addon the parity specs probe for',
            'Run the addon parity specs',
        ],
        'dependency-review': ['Review dependency changes'],
        'pr-secrets': [
            'Checkout trusted scanner',
            'Checkout scan target',
            'Fetch immutable base SHA',
            'Install trusted Gitleaks',
            'Validate PR merge diff secret scanner',
            'Scan pull request diff for secrets',
        ],
        'validation-gate': ['Require selected validation jobs to succeed'],
    },
    'heavy-gates.yml': {
        e2e: SHARDED_BROWSER_STEPS,
        'e2e-report': [...SETUP_PNPM_NODE, 'Download blob reports', 'Merge into one report', 'Upload report'],
        'browser-ai-webgpu': [...WEBGPU_ADMISSION_STEPS, 'Upload Browser AI WebGPU diagnostics'],
        'heavy-gate': ['Require selected browser jobs to succeed'],
    },
    'semantic-review.yml': {
        assess: [
            'Checkout the trusted revision',
            'Fetch the reviewed head as Git objects',
            'Set up pnpm',
            'Set up Node',
            'Install dependencies',
            'Assess the change',
            'Report the assessment',
            'Upload the advisory report',
            'Compute the coverage line',
        ],
        coverage: ['Download the advisory report', 'Publish the withheld paths'],
    },
    'nightly.yml': {
        decide: ['Resolve scope'],
        static: [...SETUP_PNPM_NODE, ...STATIC_SUITE_STEPS],
        lint: [...SETUP_PNPM_NODE, 'Lint'],
        boundaries: [...SETUP_PNPM_NODE, 'Validate the dependency graph'],
        unit: ISOLATED_UNIT_STEPS,
        build: [...SETUP_PNPM_NODE, 'Build'],
        rust: [
            'Checkout',
            'Install ALSA development headers',
            'Install the pinned Rust toolchain',
            'Cache cargo build',
            'Rust workspace health gates',
        ],
        'collab-server': [
            'Checkout',
            'Set up Node',
            'Install server dependencies',
            'Collaboration server health gates',
        ],
        'native-macos': [
            'Checkout',
            'Install the pinned Rust toolchain',
            'Cache cargo build',
            'Test the audio crates',
            'Test the native crate',
        ],
        'native-windows': [
            'Checkout',
            'Install the pinned Rust toolchain',
            'Cache cargo build',
            'Test the audio crates',
        ],
        e2e: SHARDED_BROWSER_STEPS,
        'browser-ai-webgpu': [...SETUP_PNPM_NODE, 'Install Chromium', 'Run Browser AI WebGPU admission'],
        'desktop-measure': [
            'Checkout',
            'Enable Corepack',
            'Set up pnpm',
            'Set up Node',
            'Install the pinned Rust toolchain',
            'Cache cargo build',
            'Install dependencies',
            'Install a virtual audio output device',
            'Select the virtual device as the output',
            'Install the harness plugin',
            'Build the packaged desktop app',
            'Measure the packaged app',
            'Prove the agent workspace in the packaged app',
            'Upload the measurement record',
            'Upload the agent workspace proof record',
        ],
        'e2e-report': [...SETUP_PNPM_NODE, 'Download blob reports', 'Merge into one report', 'Upload report'],
        codeql: ['Checkout', 'Initialise CodeQL', 'Analyse'],
        secrets: [
            'Checkout trusted scanner',
            'Checkout scan target',
            'Validate secret scanner positive control',
            'Scan history for secrets',
        ],
        'deploy-web': [
            'Require a validated revision of main',
            'Report the missing deployment credential',
            'Checkout the validated revision',
            'Enable Corepack',
            'Set up pnpm',
            'Set up Node',
            'Resolve the current production revision',
            'Report why nothing was deployed',
            'Install dependencies',
            'Link the Vercel CLI to the production project',
            'Build the validated revision',
            'Deploy the prebuilt revision',
            'Resolve the aliases of the deployment',
            'Assert cross-origin isolation on the deployment',
        ],
        'nightly-report': ['Checkout', 'Open or update the nightly failure issue'],
    },
};

// Every step condition in the registered workflows, keyed by file, job, and step
// name. A step condition is legitimate only when it is one of these exact,
// individually pinned exceptions — the shard-failure reporters, the blob
// uploads that must outlive their shard, and the deploy legs already pinned
// beside the job that owns them. An `if` anywhere else retires a proof by
// flipping the condition while every other pin stays green.
export type ConditionalStepPin = Readonly<{
    workflow: string;
    job: string;
    step: string;
    condition: string;
}>;

const SHARD_FAIL = "${{ !cancelled() && steps.run_shard.outcome == 'failure' }}";
const BLOB_UPLOAD = '${{ !cancelled() }}';
const ALWAYS = 'always()';
const ALWAYS_EXPRESSION = '${{ always() }}';
const WASM_SELECT = "steps.plan.outputs.selected == 'true'";
const DEPLOY_CRED = "env.DEPLOY_CREDENTIAL_PRESENT == 'true'";
const DEPLOY_RUN = `${DEPLOY_CRED} && steps.production.outputs.deploy == 'true'`;
const DEPLOY_SKIP = `${DEPLOY_CRED} && steps.production.outputs.deploy != 'true'`;
const DEPLOY_NO_CRED = "env.DEPLOY_CREDENTIAL_PRESENT != 'true'";
const PRODUCT_SCOPE = "needs.decide.outputs.tooling != 'true'";

function pin(workflow: string, job: string, step: string, condition: string): ConditionalStepPin {
    return { workflow, job, step, condition };
}

export const CONDITIONAL_STEP_ALLOWLIST: readonly ConditionalStepPin[] = [
    pin('validation.yml', 'native-macos', 'Upload native transport mutation evidence', ALWAYS_EXPRESSION),
    pin('health-gates.yml', 'gate', 'Require selected checks to succeed', ALWAYS_EXPRESSION),
    pin('validation.yml', 'validation-gate', 'Require selected validation jobs to succeed', ALWAYS_EXPRESSION),
    pin('heavy-gates.yml', 'heavy-gate', 'Require selected browser jobs to succeed', ALWAYS_EXPRESSION),
    ...['Install pinned generation toolchain', 'Build and qualify complete artifact', 'Upload qualified artifact'].map(
        (step) => pin('wasm-artifacts.yml', 'build-artifacts', step, WASM_SELECT)
    ),
    pin(
        'validation.yml',
        'decide',
        'Retry changed-paths filter after a transient API failure',
        "steps.filter.outcome == 'failure'"
    ),
    pin('validation.yml', 'unit', 'Report shard failure', SHARD_FAIL),
    ...[
        'App types',
        'Test types',
        'End-to-end types',
        'Desktop shell types',
        'Command argument schemas',
        'Test collection scope',
        'Barrel mock coverage',
        'Device write boundary census',
    ].map((step) => pin('validation.yml', 'static', step, PRODUCT_SCOPE)),
    pin('heavy-gates.yml', 'e2e', 'Report shard failure', SHARD_FAIL),
    pin('heavy-gates.yml', 'e2e', 'Upload blob report', BLOB_UPLOAD),
    pin('heavy-gates.yml', 'browser-ai-webgpu', 'Upload Browser AI WebGPU diagnostics', ALWAYS_EXPRESSION),
    pin('nightly.yml', 'unit', 'Report shard failure', SHARD_FAIL),
    pin('nightly.yml', 'desktop-measure', 'Upload the measurement record', ALWAYS),
    pin(
        'nightly.yml',
        'desktop-measure',
        'Prove the agent workspace in the packaged app',
        "always() && steps.build-packaged-app.outcome == 'success'"
    ),
    pin('nightly.yml', 'desktop-measure', 'Upload the agent workspace proof record', ALWAYS),
    pin('nightly.yml', 'e2e', 'Report shard failure', SHARD_FAIL),
    pin('nightly.yml', 'e2e', 'Upload blob report', BLOB_UPLOAD),
    pin('nightly.yml', 'deploy-web', 'Report the missing deployment credential', DEPLOY_NO_CRED),
    ...[
        'Checkout the validated revision',
        'Enable Corepack',
        'Set up pnpm',
        'Set up Node',
        'Resolve the current production revision',
    ].map((step) => pin('nightly.yml', 'deploy-web', step, DEPLOY_CRED)),
    pin('nightly.yml', 'deploy-web', 'Report why nothing was deployed', DEPLOY_SKIP),
    ...[
        'Install dependencies',
        'Link the Vercel CLI to the production project',
        'Build the validated revision',
        'Deploy the prebuilt revision',
        'Resolve the aliases of the deployment',
        'Assert cross-origin isolation on the deployment',
    ].map((step) => pin('nightly.yml', 'deploy-web', step, DEPLOY_RUN)),
];

// GitHub runs every *.yml/*.yaml file in the directory, so the file SET is a
// dimension a fixed-file parse never reads: an unregistered workflow can mint a
// Gate check no pin reads, and a deleted one leaves the registry pointing at a
// gate that no longer exists. Both directions refuse the drift, naming the
// file.
export function listWorkflowFiles(repositoryRoot: string): string[] {
    return readdirSync(join(repositoryRoot, '.github/workflows'))
        .filter((entry) => entry.endsWith('.yml') || entry.endsWith('.yaml'))
        .sort();
}

export function assertWorkflowFileInventory(repositoryRoot: string): void {
    const registered: readonly string[] = HEALTH_GATE_WORKFLOW_FILES;
    const liveFiles = listWorkflowFiles(repositoryRoot);
    for (const file of liveFiles) {
        if (!registered.includes(file)) {
            throw new Error(
                `${file} is not a registered gate workflow: an unregistered workflow can mint a Gate check no pin reads. ` +
                    'If it is deliberate, add it to HEALTH_GATE_WORKFLOW_FILES and pin its triggers, permissions, and secrets'
            );
        }
    }
    for (const file of registered) {
        if (!liveFiles.includes(file)) {
            throw new Error(`${file} is a registered gate workflow but missing from .github/workflows`);
        }
    }
}
