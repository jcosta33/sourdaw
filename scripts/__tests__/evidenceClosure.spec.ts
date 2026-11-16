import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readLiveClosures, type ClosureIo, type GateRunIo } from '../agent-campaign/evidenceClosure';
import {
    EVIDENCE_MANIFEST_PATH,
    EVIDENCE_RECORDS_DIRECTORY,
    buildEvidenceManifest,
    evaluateRelease,
    main,
    parseEvidenceRecord,
    type EvidenceManifest,
    type EvidenceRecord,
    type EvidenceSuite,
    type ReleaseState,
} from '../agent-campaign/run-evidence-gate';

const SPEC = 'src/__tests__/subject.spec.ts';
const SUBJECT = 'src/subject.ts';
const TYPE_ONLY_SUBJECT = 'src/shape.ts';
const UNRELATED = 'src/unrelated.ts';
const SETUP_HELPER = 'src/setupHelper.ts';
const DEPENDENCY_SOURCE = 'crates/dep-crate/src/lib.rs';
const HEAD = 'd'.repeat(40);

const SUITE: EvidenceSuite = {
    id: 'AC-SYNTHETIC',
    task: 'TASK-SYNTHETIC',
    kind: 'unit+rust',
    command: `pnpm test:run ${SPEC} && cargo test -p root-crate filter`,
    fixtures: [
        { path: SPEC, digest: 'a'.repeat(64) },
        { path: 'crates/root-crate/src', digest: 'b'.repeat(64) },
    ],
};

/** AC-060 declares `electron/channels.ts` in `EVIDENCE_SUITE_CLOSURE_READS`; only the id matters here. */
const DECLARED_READ_SUITE: EvidenceSuite = {
    id: 'AC-060',
    task: 'TASK-SYNTHETIC',
    kind: 'unit',
    command: `pnpm test:run ${SPEC}`,
    fixtures: [{ path: SPEC, digest: 'a'.repeat(64) }],
};

const DECLARED_READ = 'electron/channels.ts';

/** A real contract gate whose command the runner accepts; the spec stands in for running it. */
const CONTRACT_GATE = {
    task: 'TASK-SA-00-protocol-governance',
    gate: 'AC-017',
    spec: 'src/app/__tests__/agentProtocolVersioning.spec.ts',
};

const APP_DIGESTS = { capabilityInventory: 'a'.repeat(64), census: 'b'.repeat(64) };

const GIT_IDENTITY = ['-c', 'user.email=evidence@example.invalid', '-c', 'user.name=Evidence'];

const roots: string[] = [];

function write(root: string, path: string, value: string): void {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, value);
}

function manifestOf(suite: EvidenceSuite): EvidenceManifest {
    return {
        schemaVersion: 1,
        campaign: 'synthetic',
        thresholds: { path: 'docs/thresholds.md', digest: 'e'.repeat(64) },
        capabilityInventory: { source: 'src/app/capabilities.ts', digest: 'f'.repeat(64) },
        census: { digest: '0'.repeat(64) },
        environment: [],
        tasks: [{ id: suite.task, gates: [suite.id] }],
        suites: [suite],
        collisions: [],
    };
}

/** `cargo metadata --no-deps` output for the temp workspace: root depends on dep, dep dev-depends on dev-only. */
function cargoMetadataFor(root: string, packages: readonly string[]): string {
    const dependency = (name: string, kind: string | null) => ({ name, path: join(root, 'crates', name), kind });
    const shapes: Record<string, unknown> = {
        'root-crate': {
            name: 'root-crate',
            manifest_path: join(root, 'crates/root-crate/Cargo.toml'),
            dependencies: [dependency('dep-crate', null), { name: 'serde', kind: null }],
            targets: [
                { kind: ['lib'], src_path: join(root, 'crates/root-crate/src/lib.rs') },
                { kind: ['test'], src_path: join(root, 'crates/root-crate/tests/it.rs') },
            ],
        },
        'dep-crate': {
            name: 'dep-crate',
            manifest_path: join(root, 'crates/dep-crate/Cargo.toml'),
            dependencies: [dependency('dev-only', 'dev')],
            targets: [
                { kind: ['lib'], src_path: join(root, DEPENDENCY_SOURCE) },
                { kind: ['custom-build'], src_path: join(root, 'crates/dep-crate/build.rs') },
            ],
        },
        'dev-only': {
            name: 'dev-only',
            manifest_path: join(root, 'crates/dev-only/Cargo.toml'),
            dependencies: [],
            targets: [{ kind: ['lib'], src_path: join(root, 'crates/dev-only/src/lib.rs') }],
        },
    };
    return JSON.stringify({ packages: packages.map((name) => shapes[name]) });
}

/** The Vitest runner a `pnpm test:run` command runs under, shaped like the repository's. */
function writeRunner(root: string): void {
    write(root, 'package.json', '{"scripts":{"test:run":"node scripts/runVitestZeroTestGuard.ts"}}\n');
    write(root, 'scripts/runVitestZeroTestGuard.ts', "import { report } from './runnerReport.ts';\n\nreport();\n");
    write(root, 'scripts/runnerReport.ts', 'export function report(): void {}\n');
    write(root, 'scripts/vitestProgressReporter.ts', 'export default {};\n');
    write(root, 'scripts/vitestProgressSetup.ts', 'export {};\n');
    write(
        root,
        'vite.config.ts',
        [
            'export default {',
            '    test: {',
            '        setupFiles: process.env.PROGRESS',
            "            ? ['./scripts/vitestProgressSetup.ts', './src/setupTests.ts']",
            "            : ['./src/setupTests.ts'],",
            '    },',
            '};',
            '',
        ].join('\n')
    );
    write(root, 'src/setupTests.ts', "import { prepare } from './setupHelper';\n\nprepare();\n");
    write(root, SETUP_HELPER, 'export function prepare(): void {}\n');
}

function workspace(): { root: string; io: ClosureIo } {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-evidence-closure-'));
    roots.push(root);
    write(root, 'tsconfig.json', '{}\n');
    writeRunner(root);
    write(root, SUBJECT, "export const ALLOWED_PERMISSIONS = ['clipboard'];\n");
    write(root, TYPE_ONLY_SUBJECT, 'export type Shape = { kind: string };\n');
    write(root, UNRELATED, 'export const UNRELATED = 1;\n');
    write(root, DECLARED_READ, "export const CHANNELS = ['open'];\n");
    write(
        root,
        SPEC,
        [
            "import type { Shape } from '../shape';",
            "import { ALLOWED_PERMISSIONS } from '../subject';",
            '',
            "export const seen: Shape = { kind: ALLOWED_PERMISSIONS.join(',') };",
            '',
        ].join('\n')
    );
    write(root, 'Cargo.toml', '[workspace]\nmembers = ["crates/*"]\n');
    write(root, 'rust-toolchain.toml', '[toolchain]\nchannel = "1.90.0"\n');
    write(root, '.cargo/config.toml', '[build]\n');
    for (const crate of ['root-crate', 'dep-crate', 'dev-only']) {
        write(root, `crates/${crate}/Cargo.toml`, `[package]\nname = "${crate}"\n`);
        write(root, `crates/${crate}/src/lib.rs`, 'pub fn value() -> u8 { 1 }\n');
    }
    write(root, 'crates/root-crate/tests/it.rs', '#[test]\nfn filter() {}\n');
    write(root, 'crates/dep-crate/build.rs', 'fn main() {}\n');
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', [...GIT_IDENTITY, 'commit', '-q', '-m', 'init'], { cwd: root });
    return { root, io: { cargoMetadata: () => cargoMetadataFor(root, ['root-crate', 'dep-crate', 'dev-only']) } };
}

async function recordedRun(root: string, io: ClosureIo, suite: EvidenceSuite = SUITE): Promise<EvidenceRecord> {
    const closure = (await readLiveClosures(root, [suite], io)).get(suite.id) ?? null;
    return {
        schemaVersion: 1,
        suite: suite.id,
        task: suite.task,
        command: suite.command,
        integratedCommit: HEAD,
        capabilityInventoryDigest: manifestOf(suite).capabilityInventory.digest,
        fixtures: suite.fixtures,
        environment: [],
        closure,
        startedAt: '2026-01-01T00:00:00.000Z',
        durationMs: 1,
        exitCode: 0,
        outcome: 'passed',
    };
}

async function releaseBlockers(
    root: string,
    io: ClosureIo,
    record: EvidenceRecord,
    suite: EvidenceSuite = SUITE
): Promise<readonly string[]> {
    const release: ReleaseState = { head: HEAD, environment: [], closures: await readLiveClosures(root, [suite], io) };
    return evaluateRelease(manifestOf(suite), [record], release).blockers;
}

/** A temp tree carrying the full generated manifest and the one contract gate's spec, committed. */
function gateWorkspace(): { root: string; io: ClosureIo; manifestPath: string } {
    const { root, io } = workspace();
    write(root, 'docs/architecture/agent-release-gates.md', '# thresholds\n');
    write(root, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
    write(root, 'Cargo.lock', 'version = 4\n');
    write(
        root,
        CONTRACT_GATE.spec,
        "import { ALLOWED_PERMISSIONS } from '../../subject';\n\nexport const seen = ALLOWED_PERMISSIONS;\n"
    );
    write(root, EVIDENCE_MANIFEST_PATH, `${JSON.stringify(buildEvidenceManifest(root, APP_DIGESTS), null, 4)}\n`);
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', [...GIT_IDENTITY, 'commit', '-q', '-m', 'gate'], { cwd: root });
    return { root, io, manifestPath: join(root, EVIDENCE_MANIFEST_PATH) };
}

function gateArguments(manifestPath: string): readonly string[] {
    return ['--task', CONTRACT_GATE.task, '--gate', CONTRACT_GATE.gate, '--manifest', manifestPath];
}

beforeEach(() => {
    vi.stubEnv('GIT_TRACE2_EVENT', '0');
});

afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
    vi.unstubAllEnvs();
});

describe('evidence closure at release', { timeout: 60_000 }, () => {
    it('refuses a record once a production file its spec imports changes, naming that file', async () => {
        const { root, io } = workspace();
        const record = await recordedRun(root, io);
        write(root, SUBJECT, "export const ALLOWED_PERMISSIONS = ['clipboard', 'camera'];\n");

        expect(await releaseBlockers(root, io, record)).toEqual([`${SUITE.id}: closure file drifted: ${SUBJECT}`]);
    });

    it('refuses a record once a file its spec imports only for types changes', async () => {
        const { root, io } = workspace();
        const record = await recordedRun(root, io);
        write(root, TYPE_ONLY_SUBJECT, 'export type Shape = { kind: string; size: number };\n');

        expect(await releaseBlockers(root, io, record)).toEqual([
            `${SUITE.id}: closure file drifted: ${TYPE_ONLY_SUBJECT}`,
        ]);
    });

    it('refuses a record once a file a Vitest setup file imports changes', async () => {
        const { root, io } = workspace();
        const record = await recordedRun(root, io);
        write(root, SETUP_HELPER, 'export function prepare(): void { void 0; }\n');

        expect(await releaseBlockers(root, io, record)).toEqual([`${SUITE.id}: closure file drifted: ${SETUP_HELPER}`]);
    });

    it('refuses a record once a path-dependency crate it compiles changes, naming that file', async () => {
        const { root, io } = workspace();
        const record = await recordedRun(root, io);
        write(root, DEPENDENCY_SOURCE, 'pub fn value() -> u8 { 2 }\n');

        expect(await releaseBlockers(root, io, record)).toEqual([
            `${SUITE.id}: closure file drifted: ${DEPENDENCY_SOURCE}`,
        ]);
    });

    it('refuses a record once the cargo workspace manifest or toolchain changes', async () => {
        const { root, io } = workspace();
        const record = await recordedRun(root, io);
        write(root, 'Cargo.toml', '[workspace]\nmembers = ["crates/*"]\n\n[profile.dev]\nopt-level = 1\n');
        write(root, 'rust-toolchain.toml', '[toolchain]\nchannel = "1.91.0"\n');

        expect(await releaseBlockers(root, io, record)).toEqual([
            `${SUITE.id}: closure file drifted: Cargo.toml`,
            `${SUITE.id}: closure file drifted: rust-toolchain.toml`,
        ]);
    });

    it('refuses a record once a file its suite declares it reads by path changes', async () => {
        const { root, io } = workspace();
        const record = await recordedRun(root, io, DECLARED_READ_SUITE);
        write(root, DECLARED_READ, "export const CHANNELS = ['open', 'debug'];\n");

        expect(await releaseBlockers(root, io, record, DECLARED_READ_SUITE)).toEqual([
            `${DECLARED_READ_SUITE.id}: closure file drifted: ${DECLARED_READ}`,
        ]);
    });

    it('covers the runner, its setup files, the tested crate, its path dependencies and the workspace files', async () => {
        const { root, io } = workspace();
        const paths = (await recordedRun(root, io)).closure?.files.map(({ path }) => path);

        expect(paths).toEqual([
            '.cargo/config.toml',
            'Cargo.toml',
            'crates/dep-crate/Cargo.toml',
            'crates/dep-crate/build.rs',
            DEPENDENCY_SOURCE,
            'crates/root-crate/Cargo.toml',
            'crates/root-crate/src/lib.rs',
            'crates/root-crate/tests/it.rs',
            'rust-toolchain.toml',
            'scripts/runVitestZeroTestGuard.ts',
            'scripts/runnerReport.ts',
            'scripts/vitestProgressReporter.ts',
            'scripts/vitestProgressSetup.ts',
            SPEC,
            SETUP_HELPER,
            'src/setupTests.ts',
            TYPE_ONLY_SUBJECT,
            SUBJECT,
            'vite.config.ts',
        ]);
    });

    it('passes a record when only a file outside its closure changes', async () => {
        const { root, io } = workspace();
        const record = await recordedRun(root, io);
        write(root, UNRELATED, 'export const UNRELATED = 2;\n');
        write(root, 'crates/dev-only/src/lib.rs', 'pub fn value() -> u8 { 3 }\n');

        expect(await releaseBlockers(root, io, record)).toEqual([]);
    });

    it('refuses to derive a closure through an unresolvable import', async () => {
        const { root, io } = workspace();
        write(root, SPEC, "import { gone } from '../missing';\n\nexport const seen = gone;\n");

        await expect(readLiveClosures(root, [SUITE], io)).rejects.toThrow(`${SPEC}: cannot resolve import ../missing`);
    });

    it('refuses to derive a closure through a package that is not installed', async () => {
        const { root, io } = workspace();
        write(root, SPEC, "import { gone } from 'not-an-installed-package';\n\nexport const seen = gone;\n");

        await expect(readLiveClosures(root, [SUITE], io)).rejects.toThrow(
            `${SPEC}: cannot resolve import not-an-installed-package`
        );
    });

    it('refuses to derive a closure when a path dependency is missing from cargo metadata', async () => {
        const { root } = workspace();
        const io = { cargoMetadata: () => cargoMetadataFor(root, ['root-crate']) };

        await expect(readLiveClosures(root, [SUITE], io)).rejects.toThrow(
            'root-crate: path dependency dep-crate at crates/dep-crate is not a workspace package in cargo metadata'
        );
    });

    it('refuses a record that carries no closure', async () => {
        const { root, io } = workspace();
        const record = { ...(await recordedRun(root, io)), closure: null };

        expect(await releaseBlockers(root, io, record)).toEqual([`${SUITE.id}: record carries no closure`]);
    });
});

describe('evidence closure during a gate run', { timeout: 60_000 }, () => {
    it('records the closure a run observed when nothing moves under it', async () => {
        const { root, io, manifestPath } = gateWorkspace();
        const gateIo: GateRunIo = { ...io, runCommand: () => ({ exitCode: 0, durationMs: 1 }) };

        await expect(main(gateArguments(manifestPath), gateIo)).resolves.toBe(0);

        const recordPath = join(root, EVIDENCE_RECORDS_DIRECTORY, `${CONTRACT_GATE.gate}.json`);
        const record = parseEvidenceRecord(readFileSync(recordPath, 'utf8'), recordPath);
        expect(record.closure?.files.map(({ path }) => path)).toContain(SUBJECT);
    });

    it('refuses a run during which a closure file changed, naming it and writing no record', async () => {
        const { root, io, manifestPath } = gateWorkspace();
        const gateIo: GateRunIo = {
            ...io,
            runCommand: () => {
                write(root, SETUP_HELPER, 'export function prepare(): void { void 1; }\n');
                return { exitCode: 0, durationMs: 1 };
            },
        };
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const exitCode = await main(gateArguments(manifestPath), gateIo);

        expect(exitCode).toBe(1);
        expect(errorSpy.mock.calls.flat()).toContainEqual(
            `${CONTRACT_GATE.gate}: closure file drifted during the run: ${SETUP_HELPER}`
        );
        expect(existsSync(join(root, EVIDENCE_RECORDS_DIRECTORY, `${CONTRACT_GATE.gate}.json`))).toBe(false);
        errorSpy.mockRestore();
    });
});
