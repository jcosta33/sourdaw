/**
 * The hosted WASM artifact workflow's unprivileged, head-bound, complete build contract, shared by
 * both health-gate harnesses beside the registered workflows' structural pins.
 */

import { relative } from 'node:path';

import { STEP_INVENTORY } from './healthGateWorkflowContract.ts';
import { generators, sharedInputs } from './hostedWasmArtifacts.ts';
import { wasmArtifacts } from './wasm-artifacts.ts';

/**
 * Every path whose change can make the plan select or refuse a package: the shared generation
 * inputs, each generator, the committed manifest, the workspace manifest and lockfile the closure
 * hash reads, and every crate in a package's path-dependency closure. A pull request touching none
 * of them plans no work, so the workflow's `paths` filter keeps it from starting at all.
 */
export function hostedWasmTriggerPaths(): string[] {
    const crateDirs = new Set(wasmArtifacts.packages.flatMap((spec) => wasmArtifacts.pathDepClosure(spec.crateDir)));
    return [
        ...sharedInputs,
        ...Object.values(generators),
        relative(wasmArtifacts.repoRoot, wasmArtifacts.manifestPath),
        'Cargo.toml',
        'Cargo.lock',
        ...Array.from(crateDirs, (dir) => `${dir}/**`),
    ].sort();
}

function readHostedWasmWorkflowMapping(candidate: unknown): Record<string, unknown> {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
        throw new Error('Invalid hosted WASM workflow mapping');
    }
    return Object.fromEntries(Object.keys(candidate).map((key) => [key, Reflect.get(candidate, key)]));
}

function requireHostedWasmEqual(actual: unknown, expected: unknown, label: string): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Hosted WASM workflow must retain ${label}`);
    }
}

function assertHostedCheckout(
    named: (name: string) => Record<string, unknown>,
    name: string,
    ref: string,
    path: string,
    label: string
): void {
    requireHostedWasmEqual(
        named(name).with,
        { ref, 'fetch-depth': 0, 'persist-credentials': false, path },
        `${label} checkout without persisted credentials`
    );
}

function assertHostedArtifactUpload(named: (name: string) => Record<string, unknown>): void {
    requireHostedWasmEqual(
        named('Upload qualified artifact').uses,
        'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
        'the pinned artifact uploader'
    );
    requireHostedWasmEqual(
        named('Upload qualified artifact').with,
        {
            name: 'wasm-${{ github.event.pull_request.head.sha }}-${{ github.run_id }}-${{ github.run_attempt }}',
            path: '${{ runner.temp }}/qualified-wasm-artifacts',
            'if-no-files-found': 'error',
            'retention-days': 1,
        },
        'only qualified output with bounded retention'
    );
}

export function assertHostedWasmWorkflow(value: unknown): void {
    const workflow = readHostedWasmWorkflowMapping(value);
    requireHostedWasmEqual(
        workflow.on,
        {
            pull_request: {
                branches: ['main'],
                types: ['opened', 'synchronize', 'reopened'],
                paths: hostedWasmTriggerPaths(),
            },
        },
        'the unprivileged PR trigger filtered to the selection inputs'
    );
    requireHostedWasmEqual(workflow.permissions, { contents: 'read' }, 'read-only contents permission');
    requireHostedWasmEqual(
        workflow.concurrency,
        { group: 'wasm-artifacts-${{ github.event.pull_request.number }}', 'cancel-in-progress': true },
        'bounded PR concurrency'
    );
    const jobs = readHostedWasmWorkflowMapping(workflow.jobs);
    requireHostedWasmEqual(Object.keys(jobs), ['build-artifacts'], 'the standalone job');
    const job = readHostedWasmWorkflowMapping(jobs['build-artifacts']);
    requireHostedWasmEqual(job.name, 'Build WASM artifacts', 'its distinct check name');
    requireHostedWasmEqual(job['runs-on'], 'ubuntu-latest', 'a standard hosted runner');
    requireHostedWasmEqual(job['timeout-minutes'], 45, 'its timeout');
    for (const forbidden of ['permissions', 'if', 'continue-on-error', 'environment', 'uses', 'secrets']) {
        requireHostedWasmEqual(job[forbidden], undefined, `no job ${forbidden}`);
    }
    if (!Array.isArray(job.steps)) {
        throw new TypeError('Hosted WASM workflow has no steps');
    }
    const steps = job.steps.map(readHostedWasmWorkflowMapping);
    requireHostedWasmEqual(
        steps.map((step) => step.name),
        STEP_INVENTORY['wasm-artifacts.yml']?.['build-artifacts'],
        'complete ordered build steps'
    );
    const named = (name: string) => {
        const step = steps.find((candidate) => candidate.name === name);
        if (!step) {
            throw new Error(`Missing hosted WASM step ${name}`);
        }
        return step;
    };
    assertHostedCheckout(
        named,
        'Checkout workflow control',
        '${{ github.workflow_sha }}',
        'control',
        'workflow control'
    );
    assertHostedCheckout(
        named,
        'Checkout source head',
        '${{ github.event.pull_request.head.sha }}',
        'source',
        'exact head'
    );
    requireHostedWasmEqual(
        named('Select affected packages').run,
        'node control/scripts/hostedWasmArtifacts.ts plan "$GITHUB_WORKSPACE/source"',
        'the package selection helper'
    );
    requireHostedWasmEqual(
        named('Install helper dependencies')['working-directory'],
        'source',
        'source dependency installation'
    );
    requireHostedWasmEqual(named('Select affected packages').id, 'plan', 'the selection output ID');
    requireHostedWasmEqual(
        named('Build and qualify complete artifact').run,
        'node control/scripts/hostedWasmArtifacts.ts build "$GITHUB_WORKSPACE/source"',
        'complete build and provenance qualification'
    );
    requireHostedWasmEqual(
        named('Build and qualify complete artifact').env,
        { BUILD_OUTPUT_DIRECTORY: '${{ runner.temp }}/qualified-wasm-artifacts' },
        'the private qualified directory in the runner-bound build step'
    );
    assertHostedArtifactUpload(named);
    for (const step of steps) {
        requireHostedWasmEqual(step['continue-on-error'], undefined, 'failure propagation');
        const conditional = [
            'Install pinned generation toolchain',
            'Build and qualify complete artifact',
            'Upload qualified artifact',
        ].includes(String(step.name));
        requireHostedWasmEqual(
            step.if,
            conditional ? "steps.plan.outputs.selected == 'true'" : undefined,
            'selection-only build conditions'
        );
    }
    const env = readHostedWasmWorkflowMapping(job.env);
    requireHostedWasmEqual(env.BUILD_HEAD_SHA, '${{ github.event.pull_request.head.sha }}', 'head-bound provenance');
    requireHostedWasmEqual(env.BUILD_OUTPUT_DIRECTORY, undefined, 'no job-level output directory');
    if (JSON.stringify(workflow).includes('secrets.')) {
        throw new Error('Hosted WASM workflow must not consume secrets');
    }
}
