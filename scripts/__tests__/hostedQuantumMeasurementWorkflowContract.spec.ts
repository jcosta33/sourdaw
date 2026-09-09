import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

import {
    assertHostedQuantumMeasurementWorkflow,
    HOSTED_QUANTUM_MEASUREMENT_TRIGGER_PATHS,
} from '../hostedQuantumMeasurementWorkflowContract';

type UnknownRecord = Record<string, unknown>;

const repositoryRoot = resolve(import.meta.dirname, '../..');
const document = parseDocument(
    readFileSync(resolve(repositoryRoot, '.github/workflows/quantum-measurements.yml'), 'utf8')
);
const workflow = document.toJS() as UnknownRecord;

function record(value: unknown): UnknownRecord {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Expected a mapping');
    }
    return value as UnknownRecord;
}

function measurementJob(candidate: UnknownRecord): UnknownRecord {
    return record(record(candidate.jobs).measure);
}

function namedStep(candidate: UnknownRecord, name: string): UnknownRecord {
    const steps = measurementJob(candidate).steps;
    if (!Array.isArray(steps)) {
        throw new TypeError('Expected workflow steps');
    }
    const step = steps.map(record).find((entry) => entry.name === name);
    if (step === undefined) {
        throw new Error(`Missing step ${name}`);
    }
    return step;
}

function removeStep(candidate: UnknownRecord, name: string): void {
    const job = measurementJob(candidate);
    const steps = job.steps;
    if (!Array.isArray(steps)) {
        throw new TypeError('Expected workflow steps');
    }
    job.steps = steps.filter((step) => record(step).name !== name);
}

describe('hosted quantum measurement workflow contract', () => {
    it('qualifies a complete exact-head browser measurement on an unprivileged standard runner', () => {
        expect(document.errors).toEqual([]);
        expect(() => assertHostedQuantumMeasurementWorkflow(workflow)).not.toThrow();
    });

    it('rejects a checkout that measures a merge commit instead of the pull-request head', () => {
        const mutant = structuredClone(workflow);
        record(namedStep(mutant, 'Checkout source head').with).ref = '${{ github.sha }}';

        expect(() => assertHostedQuantumMeasurementWorkflow(mutant)).toThrow('exact PR head');
    });

    it('rejects removal of the full browser measurement', () => {
        const mutant = structuredClone(workflow);
        removeStep(mutant, 'Run full browser measurement');

        expect(() => assertHostedQuantumMeasurementWorkflow(mutant)).toThrow('complete ordered measurement');
    });

    it('rejects removal of either independent acceptance gate', () => {
        for (const assertion of [
            'assertGrandBouleMeasurementAdmission(root);',
            'assertWholeEngineQuantumCapability(root);',
        ]) {
            const mutant = structuredClone(workflow);
            const admission = namedStep(mutant, 'Verify measurement admission');
            admission.run = String(admission.run).replace(assertion, '');

            expect(() => assertHostedQuantumMeasurementWorkflow(mutant)).toThrow('acceptance gates');
        }
    });

    it('rejects incomplete source admission and privileged trigger mutations', () => {
        const missingCensusPath = structuredClone(workflow);
        const trigger = record(record(missingCensusPath.on).pull_request);
        trigger.paths = (trigger.paths as unknown[]).filter((path) => path !== 'crates/daw-dsp/src/grand_boule/**');
        expect(() => assertHostedQuantumMeasurementWorkflow(missingCensusPath)).toThrow('source-complete');

        const privileged = structuredClone(workflow);
        privileged.on = { pull_request_target: {} };
        expect(() => assertHostedQuantumMeasurementWorkflow(privileged)).toThrow('pull-request trigger');
    });

    it('tracks the complete census, runtime, and producer contract inputs', () => {
        expect(HOSTED_QUANTUM_MEASUREMENT_TRIGGER_PATHS).toEqual(
            expect.arrayContaining([
                'crates/daw-dsp/benches/wasm/deviceRecipes.js',
                'crates/daw-dsp/src/grand_boule/**',
                'crates/daw-dsp/src/primitives/**',
                'public/wasm/daw-dsp/daw_dsp_bg.wasm',
                'public/wasm/proof-chamber/proof_chamber_bg.wasm',
                'public/wasm/scoring/scoring_bg.wasm',
                'src/modules/AudioEngine/wasm/daw_dsp.js',
                'src/modules/AudioEngine/wasm/proof_chamber.js',
                'src/modules/AudioEngine/wasm/scoring.js',
                '.github/workflows/quantum-measurements.yml',
                'scripts/hostedQuantumMeasurementWorkflowContract.ts',
            ])
        );
    });

    it('rejects Chromium substitution and an unbounded or incomplete artifact', () => {
        const chromium = structuredClone(workflow);
        namedStep(chromium, 'Install Google Chrome').run = 'pnpm exec playwright install chromium';
        expect(() => assertHostedQuantumMeasurementWorkflow(chromium)).toThrow('Google Chrome');

        const unbounded = structuredClone(workflow);
        namedStep(unbounded, 'Assemble qualified artifact').run = String(
            namedStep(unbounded, 'Assemble qualified artifact').run
        ).replace('10 * 1024 * 1024', 'Number.POSITIVE_INFINITY');
        expect(() => assertHostedQuantumMeasurementWorkflow(unbounded)).toThrow('bounded data members');

        const extraMember = structuredClone(workflow);
        const assembly = namedStep(extraMember, 'Assemble qualified artifact');
        assembly.run = String(assembly.run).replace(
            'const files = [',
            "const files = [\n    ['package.json', 'package.json'],"
        );
        expect(() => assertHostedQuantumMeasurementWorkflow(extraMember)).toThrow('exactly the three');

        const wrongUpload = structuredClone(workflow);
        record(namedStep(wrongUpload, 'Upload qualified artifact').with).path = '.';
        expect(() => assertHostedQuantumMeasurementWorkflow(wrongUpload)).toThrow('qualified artifact upload');
    });
});
