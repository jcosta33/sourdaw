/**
 * The structural pins of the four gate workflows, shared by both health-gate
 * harnesses — the vitest spec and the shell harness — so the two can never
 * drift apart, and by the record script that blesses a deliberate edit.
 *
 * Three review rounds each surfaced one new unpinned workflow-key dimension —
 * job and step `if`/`continue-on-error` at summary positions, then at every
 * position, then matrix shard lists, job-level permissions, and step presence
 * — because every pin enumerated the keys it read and read nothing else. The
 * recorded snapshot closes that class: it is the whole parsed file, so any
 * edit to any key — pinned or never yet named — fails the harness until the
 * record is regenerated and the diff reviewed. The named inventories beside
 * it give the headline vectors precise failure messages: the shard lists each
 * suite must fan out across, the files whose jobs must inherit workflow-level
 * permissions, and every job's ordered step names.
 *
 * The snapshot pins the four files' CONTENTS; GitHub runs whatever the
 * directory holds, and a required check is satisfied by the newest run of its
 * name — a `skipped` conclusion included. A fifth workflow the parse never
 * reads could therefore mint a passing `Gate` over a red head, so the sorted
 * *.yml/*.yaml directory listing is pinned beside the contents under
 * `workflowFileInventory`.
 *
 * The same parse feeds both harnesses and the record script, so the pin can
 * never diverge from the files by parser drift: a deliberate workflow edit is
 * recorded with `pnpm test:health-gates:record` and reviewed as a JSON diff.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseDocument } from 'yaml';

export const HEALTH_GATE_WORKFLOW_FILES = [
    'health-gates.yml',
    'heavy-gates.yml',
    'validation.yml',
    'nightly.yml',
] as const;

export const WORKFLOW_SNAPSHOT_PATH = 'scripts/__tests__/fixtures/health-gate-workflows.snapshot.json';

export const WORKFLOW_FILE_INVENTORY_KEY = 'workflowFileInventory';

// A matrix shard list no pin reads can shrink, and the unsharded portion of
// the suite simply never runs: every shard in the list reports green because
// each one ran. Both suites pin their full shard inventory.
export const UNIT_SHARDS = [1, 2, 3, 4] as const;
export const E2E_SHARDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export const SHARD_MATRIX_JOBS: ReadonlyArray<readonly [string, string, readonly number[]]> = [
    ['validation.yml', 'unit', UNIT_SHARDS],
    ['heavy-gates.yml', 'e2e', E2E_SHARDS],
    ['nightly.yml', 'unit', UNIT_SHARDS],
    ['nightly.yml', 'e2e', E2E_SHARDS],
];

// A job-level `permissions` block reshapes one leg's token away from the
// workflow-level pin, and no pin read it: `contents: write` on a validation
// leg would hand every pull request a token that can push. The heavy and
// nightly files keep their own exact job-level pins (CodeQL, the nightly
// reporter); these two files must grant nothing at job level.
export const JOB_LEVEL_PERMISSION_FREE_FILES = ['health-gates.yml', 'validation.yml'] as const;

// Every job in every gate workflow, pinned to its exact ordered step names —
// or `null` for a reusable-workflow caller that must never grow steps. A
// deleted proof step leaves its job green while the proof never runs, and an
// added one runs unpinned; both directions refuse the drift.
export const STEP_INVENTORY: Readonly<Record<string, Readonly<Record<string, readonly string[] | null>>>> = {
    'health-gates.yml': {
        validation: null,
        gate: ['Require every job to have succeeded or been skipped'],
    },
    'validation.yml': {
        decide: ['Checkout', 'Filter changed paths', 'Resolve scope'],
        static: [
            'Checkout',
            'Enable Corepack',
            'Set up Node',
            'Install dependencies',
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
        ],
        lint: ['Checkout', 'Enable Corepack', 'Set up Node', 'Install dependencies', 'Lint'],
        boundaries: [
            'Checkout',
            'Enable Corepack',
            'Set up Node',
            'Install dependencies',
            'Validate the dependency graph',
        ],
        unit: [
            'Checkout',
            'Enable Corepack',
            'Set up Node',
            'Install dependencies',
            'Run shard',
            'Report shard failure',
        ],
        smoke: [
            'Checkout',
            'Enable Corepack',
            'Set up Node',
            'Install dependencies',
            'Install Playwright browsers',
            'Run offline smoke set',
        ],
        build: ['Checkout', 'Enable Corepack', 'Set up Node', 'Install dependencies', 'Build'],
        rust: [
            'Checkout',
            'Enable Corepack',
            'Set up Node',
            'Install ALSA development headers',
            'Install the pinned Rust toolchain',
            'Cache cargo build',
            'Install server dependencies',
            'Server and Rust workspace health gates',
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
        'native-parity': [
            'Checkout',
            'Install the pinned Rust toolchain',
            'Cache cargo build',
            'Enable Corepack',
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
    },
    'heavy-gates.yml': {
        validation: null,
        e2e: [
            'Checkout',
            'Enable Corepack',
            'Set up pnpm',
            'Set up Node',
            'Install dependencies',
            'Install Playwright browsers',
            'Run shard',
            'Report shard failure',
            'Upload blob report',
        ],
        'e2e-report': [
            'Checkout',
            'Enable Corepack',
            'Set up pnpm',
            'Set up Node',
            'Install dependencies',
            'Download blob reports',
            'Merge into one report',
            'Upload report',
        ],
        'browser-ai-webgpu': [
            'Checkout',
            'Enable Corepack',
            'Set up pnpm',
            'Set up Node',
            'Install dependencies',
            'Install Chromium',
            'Run Browser AI WebGPU admission',
        ],
        codeql: ['Checkout', 'Initialise CodeQL', 'Analyse'],
        secrets: [
            'Checkout trusted scanner',
            'Checkout scan target',
            'Validate secret scanner positive control',
            'Scan history for secrets',
        ],
        'heavy-gate': ['Require every job to have succeeded or been skipped'],
    },
    'nightly.yml': {
        decide: ['Resolve scope'],
        static: [
            'Checkout',
            'Enable Corepack',
            'Set up pnpm',
            'Set up Node',
            'Install dependencies',
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
        ],
        lint: ['Checkout', 'Enable Corepack', 'Set up pnpm', 'Set up Node', 'Install dependencies', 'Lint'],
        boundaries: [
            'Checkout',
            'Enable Corepack',
            'Set up pnpm',
            'Set up Node',
            'Install dependencies',
            'Validate the dependency graph',
        ],
        unit: [
            'Checkout',
            'Enable Corepack',
            'Set up pnpm',
            'Set up Node',
            'Install dependencies',
            'Run shard',
            'Report shard failure',
        ],
        build: ['Checkout', 'Enable Corepack', 'Set up pnpm', 'Set up Node', 'Install dependencies', 'Build'],
        rust: [
            'Checkout',
            'Enable Corepack',
            'Set up Node',
            'Install ALSA development headers',
            'Install the pinned Rust toolchain',
            'Cache cargo build',
            'Install server dependencies',
            'Server and Rust workspace health gates',
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
        e2e: [
            'Checkout',
            'Enable Corepack',
            'Set up pnpm',
            'Set up Node',
            'Install dependencies',
            'Install Playwright browsers',
            'Run shard',
            'Report shard failure',
            'Upload blob report',
        ],
        'browser-ai-webgpu': [
            'Checkout',
            'Enable Corepack',
            'Set up pnpm',
            'Set up Node',
            'Install dependencies',
            'Install Chromium',
            'Run Browser AI WebGPU admission',
        ],
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
            'Upload the measurement record',
        ],
        'e2e-report': [
            'Checkout',
            'Enable Corepack',
            'Set up pnpm',
            'Set up Node',
            'Install dependencies',
            'Download blob reports',
            'Merge into one report',
            'Upload report',
        ],
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

export type WorkflowSnapshot = Record<string, unknown>;

export function parseHealthGateWorkflows(repositoryRoot: string): WorkflowSnapshot {
    const snapshot: WorkflowSnapshot = {};
    for (const file of HEALTH_GATE_WORKFLOW_FILES) {
        const document = parseDocument(readFileSync(join(repositoryRoot, '.github/workflows', file), 'utf8'));
        if (document.errors.length > 0) {
            throw new Error(`${file} is invalid YAML: ${document.errors.map((error) => error.message).join('; ')}`);
        }
        snapshot[file] = document.toJS();
    }
    return snapshot;
}

export function readRecordedWorkflowSnapshot(repositoryRoot: string): WorkflowSnapshot {
    const parsed: unknown = JSON.parse(readFileSync(join(repositoryRoot, WORKFLOW_SNAPSHOT_PATH), 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new TypeError(`${WORKFLOW_SNAPSHOT_PATH} must be a mapping of workflow file to parsed workflow`);
    }
    return parsed as WorkflowSnapshot;
}

// GitHub runs every *.yml/*.yaml file in the directory, so the file SET is a
// dimension the four-file parse never reads: an unpinned workflow can mint a
// Gate check no pin reads, and a deleted one leaves the record pointing at a
// gate that no longer exists. Both directions refuse the drift, naming the
// file.
export function listWorkflowFiles(repositoryRoot: string): string[] {
    return readdirSync(join(repositoryRoot, '.github/workflows'))
        .filter((entry) => entry.endsWith('.yml') || entry.endsWith('.yaml'))
        .sort();
}

export function assertWorkflowFileInventory(recorded: WorkflowSnapshot, repositoryRoot: string): void {
    const pinned: unknown = recorded[WORKFLOW_FILE_INVENTORY_KEY];
    if (!Array.isArray(pinned) || pinned.some((entry) => typeof entry !== 'string')) {
        throw new TypeError(
            `${WORKFLOW_SNAPSHOT_PATH} must record ${WORKFLOW_FILE_INVENTORY_KEY} as a list of workflow file names`
        );
    }
    const pinnedFiles = pinned as string[];
    const liveFiles = listWorkflowFiles(repositoryRoot);
    for (const file of liveFiles) {
        if (!pinnedFiles.includes(file)) {
            throw new Error(
                `${file} is not in the recorded workflow file inventory: an unpinned workflow can mint a Gate check no pin reads. ` +
                    'If it is deliberate, regenerate the pin with `pnpm test:health-gates:record` and review the snapshot diff'
            );
        }
    }
    for (const file of pinnedFiles) {
        if (!liveFiles.includes(file)) {
            throw new Error(
                `${file} is pinned in the recorded workflow file inventory but missing from .github/workflows. ` +
                    'If the removal is deliberate, regenerate the pin with `pnpm test:health-gates:record` and review the snapshot diff'
            );
        }
    }
}

function firstDifference(recorded: unknown, fresh: unknown, path: string): string | undefined {
    if (recorded === null || fresh === null || typeof recorded !== 'object' || typeof fresh !== 'object') {
        return Object.is(recorded, fresh) ? undefined : path;
    }
    if (Array.isArray(recorded) || Array.isArray(fresh)) {
        if (!Array.isArray(recorded) || !Array.isArray(fresh) || recorded.length !== fresh.length) {
            return path;
        }
        for (let index = 0; index < recorded.length; index += 1) {
            const difference = firstDifference(recorded[index], fresh[index], `${path}.${index}`);
            if (difference !== undefined) {
                return difference;
            }
        }
        return undefined;
    }
    const recordedRecord = recorded as Record<string, unknown>;
    const freshRecord = fresh as Record<string, unknown>;
    const recordedKeys = Object.keys(recordedRecord);
    const freshKeys = Object.keys(freshRecord);
    if (recordedKeys.length !== freshKeys.length || recordedKeys.some((key, index) => key !== freshKeys[index])) {
        return path;
    }
    for (const key of recordedKeys) {
        const difference = firstDifference(recordedRecord[key], freshRecord[key], `${path}.${key}`);
        if (difference !== undefined) {
            return difference;
        }
    }
    return undefined;
}

export function assertWorkflowSnapshotMatch(recorded: WorkflowSnapshot, fresh: WorkflowSnapshot): void {
    for (const file of HEALTH_GATE_WORKFLOW_FILES) {
        const difference = firstDifference(recorded[file], fresh[file], file);
        if (difference !== undefined) {
            throw new Error(
                `${file} drifted from the recorded workflow snapshot at ${difference}. ` +
                    'If this workflow edit is deliberate, regenerate the pin with `pnpm test:health-gates:record` ' +
                    'and review the snapshot diff'
            );
        }
    }
}
