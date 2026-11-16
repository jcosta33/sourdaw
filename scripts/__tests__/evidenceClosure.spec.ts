import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readLiveClosures, type ClosureIo } from '../agent-campaign/evidenceClosure';
import {
    evaluateRelease,
    type EvidenceManifest,
    type EvidenceRecord,
    type EvidenceSuite,
    type ReleaseState,
} from '../agent-campaign/run-evidence-gate';

const SPEC = 'src/__tests__/subject.spec.ts';
const SUBJECT = 'src/subject.ts';
const UNRELATED = 'src/unrelated.ts';
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

const MANIFEST: EvidenceManifest = {
    schemaVersion: 1,
    campaign: 'synthetic',
    thresholds: { path: 'docs/thresholds.md', digest: 'e'.repeat(64) },
    capabilityInventory: { source: 'src/app/capabilities.ts', digest: 'f'.repeat(64) },
    census: { digest: '0'.repeat(64) },
    environment: [],
    tasks: [{ id: SUITE.task, gates: [SUITE.id] }],
    suites: [SUITE],
    collisions: [],
};

const GIT_IDENTITY = ['-c', 'user.email=evidence@example.invalid', '-c', 'user.name=Evidence'];

const roots: string[] = [];

function write(root: string, path: string, value: string): void {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, value);
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

function workspace(): { root: string; io: ClosureIo } {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-evidence-closure-'));
    roots.push(root);
    write(root, 'tsconfig.json', '{}\n');
    write(root, SUBJECT, "export const ALLOWED_PERMISSIONS = ['clipboard'];\n");
    write(root, UNRELATED, 'export const UNRELATED = 1;\n');
    write(
        root,
        SPEC,
        "import { ALLOWED_PERMISSIONS } from '../subject';\n\nexport const seen = ALLOWED_PERMISSIONS;\n"
    );
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

async function recordedRun(root: string, io: ClosureIo): Promise<EvidenceRecord> {
    const closure = (await readLiveClosures(root, [SUITE], io)).get(SUITE.id) ?? null;
    return {
        schemaVersion: 1,
        suite: SUITE.id,
        task: SUITE.task,
        command: SUITE.command,
        integratedCommit: HEAD,
        capabilityInventoryDigest: MANIFEST.capabilityInventory.digest,
        fixtures: SUITE.fixtures,
        environment: [],
        closure,
        startedAt: '2026-01-01T00:00:00.000Z',
        durationMs: 1,
        exitCode: 0,
        outcome: 'passed',
    };
}

async function releaseBlockers(root: string, io: ClosureIo, record: EvidenceRecord): Promise<readonly string[]> {
    const release: ReleaseState = { head: HEAD, environment: [], closures: await readLiveClosures(root, [SUITE], io) };
    return evaluateRelease(MANIFEST, [record], release).blockers;
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

    it('refuses a record once a path-dependency crate it compiles changes, naming that file', async () => {
        const { root, io } = workspace();
        const record = await recordedRun(root, io);
        write(root, DEPENDENCY_SOURCE, 'pub fn value() -> u8 { 2 }\n');

        expect(await releaseBlockers(root, io, record)).toEqual([
            `${SUITE.id}: closure file drifted: ${DEPENDENCY_SOURCE}`,
        ]);
    });

    it('covers the tested crate, its path dependencies and their build scripts, never a dependency dev-dependency', async () => {
        const { root, io } = workspace();
        const paths = (await recordedRun(root, io)).closure?.files.map(({ path }) => path);

        expect(paths).toEqual([
            'crates/dep-crate/Cargo.toml',
            'crates/dep-crate/build.rs',
            DEPENDENCY_SOURCE,
            'crates/root-crate/Cargo.toml',
            'crates/root-crate/src/lib.rs',
            'crates/root-crate/tests/it.rs',
            SPEC,
            SUBJECT,
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
