import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
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
const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

function record(value: unknown): UnknownRecord {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Expected a mapping');
    }
    return value as UnknownRecord;
}

function createTemporaryDirectory(label: string): string {
    const directory = mkdtempSync(join(tmpdir(), `sourdaw-${label}-`));
    temporaryDirectories.push(directory);
    return directory;
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

function runStep(
    candidate: UnknownRecord,
    name: string,
    cwd: string,
    environment: Readonly<Record<string, string>> = {}
) {
    return spawnSync('bash', ['-c', String(namedStep(candidate, name).run)], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, ...environment },
    });
}

function runGit(directory: string, ...arguments_: string[]): string {
    const result = spawnSync('git', arguments_, { cwd: directory, encoding: 'utf8' });
    if (result.status !== 0) {
        throw new Error(result.stderr);
    }
    return result.stdout.trim();
}

function createGitFixture(): { directory: string; head: string } {
    const directory = createTemporaryDirectory('quantum-source');
    runGit(directory, 'init', '--quiet');
    runGit(directory, 'config', 'user.name', 'Quantum Fixture');
    runGit(directory, 'config', 'user.email', 'quantum-fixture@example.invalid');
    writeFileSync(join(directory, 'tracked.txt'), 'clean\n');
    runGit(directory, 'add', 'tracked.txt');
    runGit(directory, 'commit', '--quiet', '-m', 'fixture');
    return { directory, head: runGit(directory, 'rev-parse', 'HEAD') };
}

function createMeasurementFixture(): { directory: string; runnerTemp: string; argumentsPath: string } {
    const directory = createTemporaryDirectory('quantum-measurement');
    const runnerTemp = join(directory, 'runner-temp');
    const argumentsPath = join(directory, 'arguments.json');
    const program = join(directory, 'crates/daw-dsp/benches/wasm/run.mjs');
    mkdirSync(dirname(program), { recursive: true });
    mkdirSync(runnerTemp);
    writeFileSync(
        program,
        `import { writeFileSync } from 'node:fs';
writeFileSync(process.env.ARGUMENTS_PATH, JSON.stringify(process.argv.slice(2)));
console.log('fixture measurement output');
if (process.env.MEASUREMENT_FIXTURE_FAILURE === 'true') process.exit(23);
`
    );
    return { directory, runnerTemp, argumentsPath };
}

function createAdmissionFixture(): { directory: string; callsPath: string } {
    const directory = createTemporaryDirectory('quantum-admission');
    const callsPath = join(directory, 'calls.txt');
    const program = join(directory, 'scripts/checkReleaseInventory.ts');
    mkdirSync(dirname(program), { recursive: true });
    writeFileSync(
        program,
        `import { appendFileSync } from 'node:fs';
export function assertGrandBouleMeasurementAdmission() {
    appendFileSync(process.env.CALLS_PATH, 'grand-boule\\n');
    if (process.env.FAIL_GATE === 'grand-boule') throw new Error('Grand Boule refusal');
}
export function assertWholeEngineQuantumCapability() {
    appendFileSync(process.env.CALLS_PATH, 'whole-engine\\n');
    if (process.env.FAIL_GATE === 'whole-engine') throw new Error('whole-engine refusal');
}
`
    );
    return { directory, callsPath };
}

const artifactContents = {
    'crates/daw-dsp/benches/quantum-cost-table.json': '{"rows":[]}\n',
    'crates/daw-dsp/benches/quantum-cost-table.md': '# quantum\n',
    'quantum-measurement.log': 'measurement complete\n',
} as const;

const expectedArtifactHashes = {
    'crates/daw-dsp/benches/quantum-cost-table.json':
        '6c45288a5e9d1444ab024fac905b02495e73426d74e22544bbf867e5f4811680',
    'crates/daw-dsp/benches/quantum-cost-table.md': '4b5b64ce102ffa0a08910d39eceba759176afe26369b3c79e1192f072f3e4ba1',
    'quantum-measurement.log': '9ccfe17c9981f2ca75b2e812d88583c067628e3e204abd620f4cd792f8e21e7f',
    'receipt.json': 'd37cb917278b00bee547f4c207be62b6f6167896f87641ad6a657a19b61bad66',
} as const;

function createArtifactFixture(json: string = artifactContents['crates/daw-dsp/benches/quantum-cost-table.json']) {
    const directory = createTemporaryDirectory('quantum-artifact');
    const runnerTemp = join(directory, 'runner-temp');
    mkdirSync(runnerTemp);
    const contentsByPath = { ...artifactContents, 'crates/daw-dsp/benches/quantum-cost-table.json': json };
    for (const [relative, contents] of Object.entries(contentsByPath)) {
        const path = relative === 'quantum-measurement.log' ? join(runnerTemp, relative) : join(directory, relative);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, contents);
    }
    return { directory, runnerTemp, output: join(runnerTemp, 'qualified-quantum-measurement') };
}

function artifactEnvironment(fixture: ReturnType<typeof createArtifactFixture>): Record<string, string> {
    return {
        ARTIFACT_DIRECTORY: fixture.output,
        RUNNER_TEMP: fixture.runnerTemp,
        MEASUREMENT_REPOSITORY: 'owner/repository',
        MEASUREMENT_PR: '4061',
        MEASUREMENT_HEAD_SHA: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        MEASUREMENT_RUN_ID: '123',
        MEASUREMENT_RUN_ATTEMPT: '2',
    };
}

function listFiles(directory: string, prefix = ''): string[] {
    return readdirSync(directory)
        .sort()
        .flatMap((name) => {
            const relative = prefix ? join(prefix, name) : name;
            const entry = lstatSync(join(directory, name));
            return entry.isDirectory() ? listFiles(join(directory, name), relative) : [relative];
        });
}

describe('hosted quantum measurement workflow contract', () => {
    it('qualifies a complete exact-head browser measurement on an unprivileged standard runner', () => {
        expect(document.errors).toEqual([]);
        expect(() => assertHostedQuantumMeasurementWorkflow(workflow)).not.toThrow();
    });

    it('executes exact clean-source admission and refuses wrong, dirty, or nested source state', () => {
        const fixture = createGitFixture();
        expect(
            runStep(workflow, 'Verify exact clean source', fixture.directory, {
                MEASUREMENT_HEAD_SHA: fixture.head,
            }).status
        ).toBe(0);

        expect(
            runStep(workflow, 'Verify exact clean source', fixture.directory, {
                MEASUREMENT_HEAD_SHA: '0000000000000000000000000000000000000000',
            }).status
        ).not.toBe(0);

        writeFileSync(join(fixture.directory, 'tracked.txt'), 'dirty\n');
        expect(
            runStep(workflow, 'Verify exact clean source', fixture.directory, {
                MEASUREMENT_HEAD_SHA: fixture.head,
            }).status
        ).not.toBe(0);
        runGit(fixture.directory, 'checkout', '--', 'tracked.txt');

        const nested = join(fixture.directory, 'nested');
        mkdirSync(nested);
        expect(
            runStep(workflow, 'Verify exact clean source', nested, { MEASUREMENT_HEAD_SHA: fixture.head }).status
        ).not.toBe(0);
    });

    it('runs only the full default measurement and propagates producer failure through tee', () => {
        const fixture = createMeasurementFixture();
        const environment = { RUNNER_TEMP: fixture.runnerTemp, ARGUMENTS_PATH: fixture.argumentsPath };
        const passed = runStep(workflow, 'Run full browser measurement', fixture.directory, environment);
        expect(passed.status).toBe(0);
        expect(JSON.parse(readFileSync(fixture.argumentsPath, 'utf8'))).toEqual([
            '--json',
            'crates/daw-dsp/benches/quantum-cost-table.json',
        ]);
        expect(readFileSync(join(fixture.runnerTemp, 'quantum-measurement.log'), 'utf8')).toBe(
            'fixture measurement output\n'
        );

        const failed = runStep(workflow, 'Run full browser measurement', fixture.directory, {
            ...environment,
            MEASUREMENT_FIXTURE_FAILURE: 'true',
        });
        expect(failed.status).toBe(23);

        for (const override of [' --measure 1', ' --devices scoring']) {
            const mutant = structuredClone(workflow);
            const measurement = namedStep(mutant, 'Run full browser measurement');
            measurement.run = String(measurement.run).replace(' 2>&1 |', `${override} 2>&1 |`);
            expect(() => assertHostedQuantumMeasurementWorkflow(mutant)).toThrow('full default measurement');
        }
    });

    it('executes both measurement gates and propagates either refusal', () => {
        for (const failingGate of ['', 'grand-boule', 'whole-engine']) {
            const fixture = createAdmissionFixture();
            const result = runStep(workflow, 'Verify measurement admission', fixture.directory, {
                CALLS_PATH: fixture.callsPath,
                FAIL_GATE: failingGate,
            });
            expect(result.status).toBe(failingGate === '' ? 0 : 1);
            expect(readFileSync(fixture.callsPath, 'utf8')).toBe(
                failingGate === 'grand-boule' ? 'grand-boule\n' : 'grand-boule\nwhole-engine\n'
            );
        }

        const earlyExit = structuredClone(workflow);
        const admission = namedStep(earlyExit, 'Verify measurement admission');
        admission.run = String(admission.run).replace(
            'const root = process.cwd();',
            'process.exit(0);\nconst root = process.cwd();'
        );
        expect(() => assertHostedQuantumMeasurementWorkflow(earlyExit)).toThrow('acceptance gates');

        const skippedGate = structuredClone(workflow);
        namedStep(skippedGate, 'Verify measurement admission').run = String(
            namedStep(skippedGate, 'Verify measurement admission').run
        ).replace('assertWholeEngineQuantumCapability(root);', '');
        expect(() => assertHostedQuantumMeasurementWorkflow(skippedGate)).toThrow('acceptance gates');
    });

    it('assembles only fresh regular members with exact hashes and a bounded receipt', () => {
        const fixture = createArtifactFixture();
        const result = runStep(
            workflow,
            'Assemble qualified artifact',
            fixture.directory,
            artifactEnvironment(fixture)
        );
        expect(result.status).toBe(0);
        expect(listFiles(fixture.output)).toEqual([
            'crates/daw-dsp/benches/quantum-cost-table.json',
            'crates/daw-dsp/benches/quantum-cost-table.md',
            'quantum-measurement.log',
            'receipt.json',
        ]);
        for (const relative of listFiles(fixture.output)) {
            const entry = lstatSync(join(fixture.output, relative));
            expect(entry.isFile()).toBe(true);
            expect(entry.isSymbolicLink()).toBe(false);
        }
        const receiptText = readFileSync(join(fixture.output, 'receipt.json'), 'utf8');
        expect(JSON.parse(receiptText)).toEqual({
            version: 1,
            repository: 'owner/repository',
            pullRequest: 4061,
            headSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            runId: '123',
            runAttempt: 2,
            files: {
                'crates/daw-dsp/benches/quantum-cost-table.json': `sha256:${expectedArtifactHashes['crates/daw-dsp/benches/quantum-cost-table.json']}`,
                'crates/daw-dsp/benches/quantum-cost-table.md': `sha256:${expectedArtifactHashes['crates/daw-dsp/benches/quantum-cost-table.md']}`,
                'quantum-measurement.log': `sha256:${expectedArtifactHashes['quantum-measurement.log']}`,
            },
        });
        expect(
            Object.fromEntries(
                listFiles(fixture.output).map((relative) => [
                    relative,
                    createHash('sha256')
                        .update(readFileSync(join(fixture.output, relative)))
                        .digest('hex'),
                ])
            )
        ).toEqual(expectedArtifactHashes);
    });

    it('refuses existing output, symlink output, and oversized qualified data', () => {
        const extra = createArtifactFixture();
        mkdirSync(extra.output);
        const extraPath = join(extra.output, 'extra.bin');
        writeFileSync(extraPath, Buffer.alloc(12 * 1024 * 1024));
        expect(
            runStep(workflow, 'Assemble qualified artifact', extra.directory, artifactEnvironment(extra)).status
        ).not.toBe(0);
        expect(lstatSync(extraPath).size).toBe(12 * 1024 * 1024);

        const symlink = createArtifactFixture();
        const symlinkTarget = join(symlink.runnerTemp, 'symlink-target');
        mkdirSync(symlinkTarget);
        symlinkSync(symlinkTarget, symlink.output, 'dir');
        expect(
            runStep(workflow, 'Assemble qualified artifact', symlink.directory, artifactEnvironment(symlink)).status
        ).not.toBe(0);
        expect(readdirSync(symlinkTarget)).toEqual([]);

        const oversized = createArtifactFixture('x'.repeat(11 * 1024 * 1024));
        expect(
            runStep(workflow, 'Assemble qualified artifact', oversized.directory, artifactEnvironment(oversized)).status
        ).not.toBe(0);

        const reusedDirectory = structuredClone(workflow);
        namedStep(reusedDirectory, 'Assemble qualified artifact').run = String(
            namedStep(reusedDirectory, 'Assemble qualified artifact').run
        ).replace('mkdirSync(output);', 'mkdirSync(output, { recursive: true });');
        expect(() => assertHostedQuantumMeasurementWorkflow(reusedDirectory)).toThrow('bounded data members');

        const removedBound = structuredClone(workflow);
        namedStep(removedBound, 'Assemble qualified artifact').run = String(
            namedStep(removedBound, 'Assemble qualified artifact').run
        ).replace('if (totalBytes > 10 * 1024 * 1024)', 'if (false)');
        expect(() => assertHostedQuantumMeasurementWorkflow(removedBound)).toThrow('bounded data members');
    });

    it('rejects structural authority and admission mutations', () => {
        const wrongHead = structuredClone(workflow);
        record(namedStep(wrongHead, 'Checkout source head').with).ref = '${{ github.sha }}';
        expect(() => assertHostedQuantumMeasurementWorkflow(wrongHead)).toThrow('exact PR head');

        const removedMeasurement = structuredClone(workflow);
        removeStep(removedMeasurement, 'Run full browser measurement');
        expect(() => assertHostedQuantumMeasurementWorkflow(removedMeasurement)).toThrow(
            'complete ordered measurement'
        );

        const missingCensusPath = structuredClone(workflow);
        const trigger = record(record(missingCensusPath.on).pull_request);
        trigger.paths = (trigger.paths as unknown[]).filter((path) => path !== 'crates/daw-dsp/src/grand_boule/**');
        expect(() => assertHostedQuantumMeasurementWorkflow(missingCensusPath)).toThrow('source-complete');

        const privileged = structuredClone(workflow);
        privileged.on = { pull_request_target: {} };
        expect(() => assertHostedQuantumMeasurementWorkflow(privileged)).toThrow('pull-request trigger');

        const chromium = structuredClone(workflow);
        namedStep(chromium, 'Install Google Chrome').run = 'pnpm exec playwright install chromium';
        expect(() => assertHostedQuantumMeasurementWorkflow(chromium)).toThrow('Google Chrome');

        const wrongUpload = structuredClone(workflow);
        record(namedStep(wrongUpload, 'Upload qualified artifact').with).path = '.';
        expect(() => assertHostedQuantumMeasurementWorkflow(wrongUpload)).toThrow('qualified artifact upload');
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
                'scripts/quantumMeasurementCalibration.ts',
            ])
        );
    });
});
