import { createHash } from 'node:crypto';

import {
    GRAND_BOULE_MEASUREMENT_SOURCE_DIRECTORIES,
    GRAND_BOULE_MEASUREMENT_SOURCE_FILES,
} from '../crates/daw-dsp/benches/wasm/measurementCensus.mjs';

type UnknownRecord = Record<string, unknown>;

export const HOSTED_QUANTUM_MEASUREMENT_WORKFLOW_FILE = 'quantum-measurements.yml';

const HARNESS_PATHS = [
    'crates/daw-dsp/benches/quantum-cost-table.json',
    'crates/daw-dsp/benches/quantum-cost-table.md',
    'crates/daw-dsp/benches/wasm/index.html',
    'crates/daw-dsp/benches/wasm/measurementCensus.d.mts',
    'crates/daw-dsp/benches/wasm/measurementCensus.mjs',
    'crates/daw-dsp/benches/wasm/renderTable.d.mts',
    'crates/daw-dsp/benches/wasm/renderTable.mjs',
    'crates/daw-dsp/benches/wasm/run.mjs',
    'crates/daw-dsp/benches/wasm/server.mjs',
    'crates/daw-dsp/benches/wasm/tickClock.js',
] as const;

const RUNTIME_PATHS = [
    'public/wasm/daw-dsp/daw_dsp_bg.wasm',
    'public/wasm/proof-chamber/proof_chamber_bg.wasm',
    'public/wasm/scoring/scoring_bg.wasm',
    'public/wasm/manifest.json',
    'src/modules/AudioEngine/wasm/daw_dsp.js',
    'src/modules/AudioEngine/wasm/proof_chamber.js',
    'src/modules/AudioEngine/wasm/scoring.js',
] as const;

const WORKFLOW_CONTRACT_PATHS = [
    '.github/workflows/quantum-measurements.yml',
    'package.json',
    'pnpm-lock.yaml',
    'scripts/checkReleaseInventory.ts',
    'scripts/healthGateWorkflowContract.ts',
    'scripts/hostedQuantumMeasurementWorkflowContract.ts',
    'scripts/recordHealthGateWorkflowSnapshot.ts',
    'scripts/test-health-gate-scripts.sh',
    'scripts/__tests__/healthGatesWorkflow.spec.ts',
    'scripts/__tests__/hostedQuantumMeasurementWorkflowContract.spec.ts',
    'scripts/__tests__/fixtures/health-gate-workflows.snapshot.json',
] as const;

export const HOSTED_QUANTUM_MEASUREMENT_TRIGGER_PATHS = [
    ...GRAND_BOULE_MEASUREMENT_SOURCE_FILES,
    ...GRAND_BOULE_MEASUREMENT_SOURCE_DIRECTORIES.map((path) => `${path}/**`),
    ...HARNESS_PATHS,
    ...RUNTIME_PATHS,
    ...WORKFLOW_CONTRACT_PATHS,
].sort();

const EXPECTED_STEP_NAMES = [
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
] as const;

const COMMAND_DIGESTS = {
    sourceAdmission: '3c0c24939d839589f5baa9e4bf4a01c99d8d633b9d9d23f4f711b786cd76ba49',
    measurement: '913b063f795ccfafb4da32276097196fbc169c26ad71c712fd41e37efaf4fe92',
    admission: '2e5c672578933c10c3d17bf53c89bc33eb59d2a19726e9d0208812c240d532c2',
    assembly: '5bded47b1e78876ed27bd63d81a47a8a6576ca5f4658ef6ef82d32c069343ea3',
} as const;

function record(value: unknown, label: string): UnknownRecord {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label} must be a mapping`);
    }
    return value as UnknownRecord;
}

function array(value: unknown, label: string): unknown[] {
    if (!Array.isArray(value)) {
        throw new TypeError(`${label} must be an array`);
    }
    return value;
}

function requireEqual(actual: unknown, expected: unknown, label: string): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Hosted quantum measurement workflow must retain ${label}`);
    }
}

function requireRunDigest(step: UnknownRecord, digest: string, label: string): void {
    const run = step.run;
    if (typeof run !== 'string' || createHash('sha256').update(run).digest('hex') !== digest) {
        throw new Error(`Hosted quantum measurement workflow must retain ${label}`);
    }
}

function assertStepIsBlocking(step: UnknownRecord): void {
    for (const key of ['if', 'continue-on-error']) {
        if (step[key] !== undefined) {
            throw new Error(`Hosted quantum measurement step ${String(step.name)} must be unconditional and blocking`);
        }
    }
}

function assertCheckout(named: (name: string) => UnknownRecord): void {
    const checkout = named('Checkout source head');
    requireEqual(
        checkout.uses,
        'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
        'the pinned checkout action'
    );
    requireEqual(
        checkout.with,
        { ref: '${{ github.event.pull_request.head.sha }}', 'fetch-depth': 0, 'persist-credentials': false },
        'the credentialless exact PR head checkout with full history'
    );
}

function assertSetup(named: (name: string) => UnknownRecord): void {
    requireEqual(
        named('Set up pnpm').uses,
        'pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86',
        'the pinned pnpm action'
    );
    requireEqual(
        named('Set up Node').uses,
        'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
        'the pinned Node action'
    );
    requireEqual(record(named('Set up Node').with, 'Node setup')['node-version'], '24.19.0', 'Node 24.19.0');
    requireEqual(
        named('Install dependencies').run,
        'pnpm install --frozen-lockfile --ignore-scripts',
        'the frozen dependency installation without lifecycle scripts'
    );
    requireEqual(
        named('Install Google Chrome').run,
        'pnpm exec playwright install chrome',
        'the Google Chrome channel installation'
    );
}

function assertSourceAdmission(named: (name: string) => UnknownRecord): void {
    const source = named('Verify exact clean source');
    requireEqual(source.shell, 'bash', 'the bash source verifier');
    requireRunDigest(source, COMMAND_DIGESTS.sourceAdmission, 'canonical exact-head and clean-tree admission');
    requireEqual(named('Verify committed WASM artifacts').run, 'pnpm wasm:verify', 'WASM freshness admission');
}

function assertMeasurement(named: (name: string) => UnknownRecord): void {
    const measurement = named('Run full browser measurement');
    requireEqual(measurement.shell, 'bash', 'the bash measurement runner');
    requireRunDigest(
        measurement,
        COMMAND_DIGESTS.measurement,
        'the full default measurement with fail-fast raw logging'
    );
    requireEqual(
        named('Render measurement table').run,
        'node crates/daw-dsp/benches/wasm/renderTable.mjs',
        'the complete table renderer'
    );
    requireEqual(
        named('Verify generated table').run,
        'node crates/daw-dsp/benches/wasm/renderTable.mjs --check',
        'the rendered-table check'
    );
    requireRunDigest(
        named('Verify measurement admission'),
        COMMAND_DIGESTS.admission,
        'both exported measurement acceptance gates'
    );
}

function assertArtifact(named: (name: string) => UnknownRecord): void {
    const assembly = named('Assemble qualified artifact');
    requireEqual(
        assembly.env,
        { ARTIFACT_DIRECTORY: '${{ runner.temp }}/qualified-quantum-measurement' },
        'the runner-private artifact directory'
    );
    requireRunDigest(
        assembly,
        COMMAND_DIGESTS.assembly,
        'the exact bounded data members, identity receipt, and content hashes'
    );
    const upload = named('Upload qualified artifact');
    requireEqual(
        upload.uses,
        'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
        'the pinned artifact uploader'
    );
    requireEqual(
        upload.with,
        {
            name: 'quantum-measurement-${{ github.event.pull_request.head.sha }}-${{ github.run_id }}-${{ github.run_attempt }}',
            path: '${{ runner.temp }}/qualified-quantum-measurement',
            'if-no-files-found': 'error',
            'retention-days': 1,
        },
        'the exact-head, run-bound qualified artifact upload'
    );
}

export function assertHostedQuantumMeasurementWorkflow(value: unknown): void {
    const workflow = record(value, 'Hosted quantum measurement workflow');
    const trigger = {
        pull_request: {
            branches: ['main'],
            types: ['opened', 'synchronize', 'reopened'],
            paths: HOSTED_QUANTUM_MEASUREMENT_TRIGGER_PATHS,
        },
    };
    const actualTrigger = structuredClone(record(workflow.on, 'workflow trigger'));
    const pullRequest = record(actualTrigger.pull_request, 'pull-request trigger');
    pullRequest.paths = array(pullRequest.paths, 'pull-request paths').map(String).sort();
    requireEqual(actualTrigger, trigger, 'the automatic source-complete pull-request trigger');
    requireEqual(workflow.permissions, { contents: 'read' }, 'read-only contents permission');
    requireEqual(
        workflow.concurrency,
        { group: 'quantum-measurements-${{ github.event.pull_request.number }}', 'cancel-in-progress': true },
        'per-pull-request cancellation of superseded runs'
    );

    const jobs = record(workflow.jobs, 'workflow jobs');
    requireEqual(Object.keys(jobs), ['measure'], 'one standalone producer job');
    const job = record(jobs.measure, 'measurement job');
    requireEqual(job.name, 'Measure browser audio quanta', 'a distinct non-Gate check name');
    requireEqual(job['runs-on'], 'ubuntu-latest', 'the standard Ubuntu runner');
    requireEqual(job['timeout-minutes'], 60, 'the 60 minute timeout');
    for (const key of ['permissions', 'if', 'continue-on-error', 'environment', 'uses', 'secrets']) {
        requireEqual(job[key], undefined, `no job-level ${key}`);
    }
    requireEqual(
        job.env,
        {
            MEASUREMENT_REPOSITORY: '${{ github.repository }}',
            MEASUREMENT_PR: '${{ github.event.pull_request.number }}',
            MEASUREMENT_HEAD_SHA: '${{ github.event.pull_request.head.sha }}',
            MEASUREMENT_RUN_ID: '${{ github.run_id }}',
            MEASUREMENT_RUN_ATTEMPT: '${{ github.run_attempt }}',
        },
        'the repository, pull request, head, run, and attempt identity'
    );
    const steps = array(job.steps, 'measurement steps').map((step) => record(step, 'measurement step'));
    requireEqual(
        steps.map((step) => step.name),
        EXPECTED_STEP_NAMES,
        'the complete ordered measurement and qualification steps'
    );
    for (const step of steps) {
        assertStepIsBlocking(step);
    }
    const named = (name: string): UnknownRecord => {
        const step = steps.find((candidate) => candidate.name === name);
        if (step === undefined) {
            throw new Error(`Missing hosted quantum measurement step ${name}`);
        }
        return step;
    };
    assertCheckout(named);
    assertSetup(named);
    assertSourceAdmission(named);
    assertMeasurement(named);
    assertArtifact(named);
}
