import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EVIDENCE_SUITE_COMMANDS } from '../agent-campaign/evidenceGateContract';
import { sharedFixturePaths } from '../agent-campaign/evidenceManifest';
import {
    EVIDENCE_MANIFEST_PATH,
    EVIDENCE_RECORDS_DIRECTORY,
    SOURCE_EXAMPLES_CORPUS_PATH,
    buildEvidenceManifest,
    compareDigests,
    evaluateRelease,
    main,
    parseEvidenceRecord,
    readEnvironmentDigests,
    readLiveDigests,
    selectGate,
    sourceExampleReleaseBlockers,
    validateEvidenceManifest,
    type EvidenceManifest,
    type EvidenceRecord,
    type EvidenceSuite,
    type ReleaseState,
} from '../agent-campaign/run-evidence-gate';

const APP_DIGESTS = { capabilityInventory: 'a'.repeat(64), census: 'b'.repeat(64) };

/** Present in the temp tree, so its digest can drift. */
const PRESENT_FIXTURE = 'src/app/__tests__/agentProtocolVersioning.spec.ts';

/** Never written to the temp tree, so its gate is blocked. */
const ABSENT_GATE = { task: 'TASK-SA-00-protocol-governance', gate: 'AC-055' };

const DRIFTING_GATE = { task: 'TASK-SA-00-protocol-governance', gate: 'AC-017' };

const ENVIRONMENT_PATHS = ['package.json', 'pnpm-lock.yaml', 'Cargo.lock', 'tsconfig.json', 'vite.config.ts'];

/** An environment input, edited to move its digest away from what a record observed. */
const ENVIRONMENT_INPUT = 'package.json';

const GIT_IDENTITY = ['-c', 'user.email=evidence@example.invalid', '-c', 'user.name=Evidence'];

const roots: string[] = [];

function write(root: string, path: string, value: string): void {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, value);
}

function fixture(): { root: string; manifest: EvidenceManifest; manifestPath: string; head: string } {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-evidence-gate-'));
    roots.push(root);
    write(root, 'docs/architecture/agent-release-gates.md', '# EVIDENCE-sourdaw-agent-release-gates\n');
    write(root, 'package.json', '{"name":"temp"}\n');
    write(root, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
    write(root, 'Cargo.lock', 'version = 4\n');
    write(root, 'tsconfig.json', '{}\n');
    write(root, 'vite.config.ts', 'export default {};\n');
    write(root, PRESENT_FIXTURE, 'original\n');

    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
    execFileSync('git', [...GIT_IDENTITY, 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: root });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

    const manifest = buildEvidenceManifest(root, APP_DIGESTS);
    const manifestPath = join(root, EVIDENCE_MANIFEST_PATH);
    write(root, EVIDENCE_MANIFEST_PATH, `${JSON.stringify(manifest, null, 4)}\n`);
    return { root, manifest, manifestPath, head };
}

function suiteOf(manifest: EvidenceManifest, selector: { task: string; gate: string }): EvidenceSuite {
    return selectGate(manifest, selector.task, selector.gate);
}

function scopedTo(manifest: EvidenceManifest, suite: EvidenceSuite): EvidenceManifest {
    return { ...manifest, suites: [suite], collisions: [] };
}

function releaseState(root: string, manifest: EvidenceManifest, head: string): ReleaseState {
    return { head, environment: readEnvironmentDigests(root, manifest) };
}

function passingRecord(manifest: EvidenceManifest, suite: EvidenceSuite, release: ReleaseState): EvidenceRecord {
    return {
        schemaVersion: 1,
        suite: suite.id,
        task: suite.task,
        command: suite.command,
        integratedCommit: release.head,
        capabilityInventoryDigest: manifest.capabilityInventory.digest,
        fixtures: suite.fixtures,
        environment: release.environment,
        startedAt: '2026-01-01T00:00:00.000Z',
        durationMs: 12,
        exitCode: 0,
        outcome: 'passed',
    };
}

/**
 * Trace2 is switched off for every `git` this spec and the runner start: a trace2 event consumer
 * keeps writing into `.git` after the command returns, which races the removal of the temporary tree.
 */
beforeEach(() => {
    vi.stubEnv('GIT_TRACE2_EVENT', '0');
});

afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
    vi.unstubAllEnvs();
});

describe('evidence manifest generation', () => {
    it('builds every requirement suite under exactly one task', () => {
        const { manifest } = fixture();

        expect(manifest.schemaVersion).toBe(1);
        expect(manifest.campaign).toBe('sourdaw-agent-production-system');
        expect(manifest.thresholds.path).toBe('docs/architecture/agent-release-gates.md');
        expect(manifest.capabilityInventory.digest).toBe(APP_DIGESTS.capabilityInventory);
        expect(manifest.census.digest).toBe(APP_DIGESTS.census);
        expect(manifest.environment).toEqual(ENVIRONMENT_PATHS);

        const ids = manifest.suites.map(({ id }) => id);
        expect(ids).toHaveLength(63);
        expect(ids).toEqual([...ids].sort());
        expect(ids[0]).toBe('AC-001');
        expect(ids.at(-1)).toBe('AC-063');
        expect(manifest.tasks.flatMap(({ gates }) => gates).sort()).toEqual(ids);
    });

    it('records a fixture the tree does not carry as absent', () => {
        const { manifest } = fixture();
        const suite = suiteOf(manifest, ABSENT_GATE);

        expect(suite.fixtures).toContainEqual({
            path: 'src/app/__tests__/agentProductionReadiness.spec.ts',
            digest: null,
            status: 'absent',
        });
    });

    it('accepts the generated manifest', () => {
        const { manifest } = fixture();

        expect(validateEvidenceManifest(manifest)).toEqual([]);
    });

    it('rejects a suite id declared twice', () => {
        const { manifest } = fixture();
        const original = manifest.suites[0];
        if (original === undefined) {
            throw new Error('fixture manifest carries no suites');
        }
        const duplicate: EvidenceSuite = { ...original, fixtures: [] };
        const duplicated = { ...manifest, suites: [...manifest.suites, duplicate] };

        expect(validateEvidenceManifest(duplicated)).toEqual([`suite ${original.id} is declared more than once`]);
    });
});

describe('gate selection', () => {
    it('refuses a gate that belongs to another task', () => {
        const { manifest } = fixture();

        expect(() => selectGate(manifest, 'TASK-SA-01-project-model-and-query', 'AC-017')).toThrow(
            'AC-017: not a gate of TASK-SA-01-project-model-and-query'
        );
    });
});

describe('digest comparison', () => {
    it('lists a fixture whose bytes changed under the recorded manifest', () => {
        const { root, manifest } = fixture();
        write(root, PRESENT_FIXTURE, 'edited\n');

        expect(compareDigests(manifest, readLiveDigests(root, manifest))).toEqual([PRESENT_FIXTURE]);
    });

    it('reports nothing while the tree matches the manifest', () => {
        const { root, manifest } = fixture();

        expect(compareDigests(manifest, readLiveDigests(root, manifest))).toEqual([]);
    });
});

describe('release evaluation', () => {
    it('accepts a suite whose record matches the head, the manifest, and the live environment', () => {
        const { root, manifest, head } = fixture();
        const suite = suiteOf(manifest, DRIFTING_GATE);
        const release = releaseState(root, manifest, head);

        expect(evaluateRelease(scopedTo(manifest, suite), [passingRecord(manifest, suite, release)], release)).toEqual({
            blockers: [],
        });
    });

    it('blocks a suite with no record', () => {
        const { root, manifest, head } = fixture();
        const suite = suiteOf(manifest, DRIFTING_GATE);

        expect(evaluateRelease(scopedTo(manifest, suite), [], releaseState(root, manifest, head)).blockers).toEqual([
            'AC-017: no record at evidence/agent-campaign/records/AC-017.json',
        ]);
    });

    it('blocks a record integrated at another commit', () => {
        const { root, manifest, head } = fixture();
        const suite = suiteOf(manifest, DRIFTING_GATE);
        const release = releaseState(root, manifest, head);
        const stale = { ...passingRecord(manifest, suite, release), integratedCommit: 'c'.repeat(40) };

        expect(evaluateRelease(scopedTo(manifest, suite), [stale], release).blockers).toEqual([
            `AC-017: record integrates ${'c'.repeat(40)}, not the current head ${head}`,
        ]);
    });

    it('blocks a record whose observed fixture digest drifted', () => {
        const { root, manifest, head } = fixture();
        const suite = suiteOf(manifest, DRIFTING_GATE);
        const release = releaseState(root, manifest, head);
        const drifted = {
            ...passingRecord(manifest, suite, release),
            fixtures: suite.fixtures.map((entry) => ({ path: entry.path, digest: 'd'.repeat(64) })),
        };

        expect(evaluateRelease(scopedTo(manifest, suite), [drifted], release).blockers).toEqual([
            `AC-017: record digest drifted for ${PRESENT_FIXTURE}`,
        ]);
    });

    it('blocks a record taken before an environment input changed', () => {
        const { root, manifest, head } = fixture();
        const suite = suiteOf(manifest, DRIFTING_GATE);
        const record = passingRecord(manifest, suite, releaseState(root, manifest, head));
        write(root, ENVIRONMENT_INPUT, '{"name":"temp","version":"1.0.0"}\n');

        const release = releaseState(root, manifest, head);

        expect(evaluateRelease(scopedTo(manifest, suite), [record], release).blockers).toEqual([
            `AC-017: record digest drifted for ${ENVIRONMENT_INPUT}`,
        ]);
    });

    it('blocks a record whose suite failed', () => {
        const { root, manifest, head } = fixture();
        const suite = suiteOf(manifest, DRIFTING_GATE);
        const release = releaseState(root, manifest, head);
        const failed: EvidenceRecord = { ...passingRecord(manifest, suite, release), exitCode: 1, outcome: 'failed' };

        expect(evaluateRelease(scopedTo(manifest, suite), [failed], release).blockers).toEqual([
            'AC-017: record outcome is failed, not passed',
        ]);
    });

    it('blocks a record whose suite was blocked rather than run', () => {
        const { root, manifest, head } = fixture();
        const suite = suiteOf(manifest, DRIFTING_GATE);
        const release = releaseState(root, manifest, head);
        const blocked: EvidenceRecord = { ...passingRecord(manifest, suite, release), exitCode: 2, outcome: 'blocked' };

        expect(evaluateRelease(scopedTo(manifest, suite), [blocked], release).blockers).toEqual([
            'AC-017: record outcome is blocked, not passed',
        ]);
    });
});

describe('shared fixture detection', () => {
    it('reports the fixture path two of three hand-built suites share', () => {
        const sharedPath = 'src/shared/fixture.ts';
        const suiteA: EvidenceSuite = {
            id: 'Z-A',
            task: 'Z',
            kind: 'unit',
            command: 'echo a',
            fixtures: [{ path: sharedPath, digest: 'a'.repeat(64) }],
        };
        const suiteB: EvidenceSuite = {
            id: 'Z-B',
            task: 'Z',
            kind: 'unit',
            command: 'echo b',
            fixtures: [{ path: sharedPath, digest: 'a'.repeat(64) }],
        };
        const suiteC: EvidenceSuite = {
            id: 'Z-C',
            task: 'Z',
            kind: 'unit',
            command: 'echo c',
            fixtures: [{ path: 'src/shared/other.ts', digest: 'b'.repeat(64) }],
        };

        expect(sharedFixturePaths([suiteA, suiteB, suiteC])).toEqual([{ path: sharedPath, suites: ['Z-A', 'Z-B'] }]);
    });
});

describe('source examples corpus', () => {
    it('blocks release on every example the corpus still records as unrecovered', () => {
        const { root } = fixture();
        write(
            root,
            SOURCE_EXAMPLES_CORPUS_PATH,
            JSON.stringify({
                schemaVersion: 1,
                examples: [
                    { id: 'EX-01', disposition: 'recovered' },
                    { id: 'EX-09', disposition: 'unrecovered' },
                ],
            })
        );

        expect(sourceExampleReleaseBlockers(root)).toEqual(['source-example EX-09: unrecovered']);
    });

    it('blocks nothing when the corpus records no unrecovered example', () => {
        const { root } = fixture();
        write(
            root,
            SOURCE_EXAMPLES_CORPUS_PATH,
            JSON.stringify({
                schemaVersion: 1,
                examples: [
                    { id: 'EX-01', disposition: 'recovered' },
                    { id: 'EX-10', disposition: 'deferred' },
                ],
            })
        );

        expect(sourceExampleReleaseBlockers(root)).toEqual([]);
    });

    it('blocks release when the corpus itself is missing', () => {
        const { root } = fixture();

        expect(sourceExampleReleaseBlockers(root)).toEqual(['source examples corpus missing']);
    });

    it('wires the missing-corpus blocker into the --release report', async () => {
        const { manifestPath } = fixture();
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const exitCode = await main(['--release', '--manifest', manifestPath]);

        expect(exitCode).toBe(1);
        expect(errorSpy.mock.calls.flat()).toContainEqual('source examples corpus missing');
        errorSpy.mockRestore();
    });

    it('wires the unrecovered source-example blocker into the --release report', async () => {
        const { root, manifestPath } = fixture();
        write(
            root,
            SOURCE_EXAMPLES_CORPUS_PATH,
            JSON.stringify({
                schemaVersion: 1,
                examples: [
                    { id: 'EX-01', disposition: 'recovered' },
                    { id: 'EX-09', disposition: 'unrecovered' },
                ],
            })
        );
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const exitCode = await main(['--release', '--manifest', manifestPath]);

        expect(exitCode).toBe(1);
        expect(errorSpy.mock.calls.flat()).toContainEqual('source-example EX-09: unrecovered');
        errorSpy.mockRestore();
    });
});

describe('suite command contract', () => {
    it('refuses a manifest whose suite command departs from the frozen contract, without spawning it', async () => {
        const { root, manifest, manifestPath } = fixture();
        const suite = suiteOf(manifest, DRIFTING_GATE);
        expect(suite.command).toBe(EVIDENCE_SUITE_COMMANDS[suite.id]);

        const tampered: EvidenceManifest = {
            ...manifest,
            suites: manifest.suites.map((entry) =>
                entry.id === suite.id ? { ...entry, command: 'echo tampered' } : entry
            ),
        };
        write(root, EVIDENCE_MANIFEST_PATH, `${JSON.stringify(tampered, null, 4)}\n`);
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const exitCode = await main([
            '--task',
            DRIFTING_GATE.task,
            '--gate',
            DRIFTING_GATE.gate,
            '--manifest',
            manifestPath,
        ]);

        expect(exitCode).toBe(1);
        expect(errorSpy.mock.calls.flat()).toContainEqual(expect.stringContaining(suite.id));
        expect(existsSync(join(root, EVIDENCE_RECORDS_DIRECTORY, `${suite.id}.json`))).toBe(false);
        errorSpy.mockRestore();
    });
});

describe('gate run', () => {
    it('blocks a gate whose fixture does not exist without running its command', async () => {
        const { root, manifest, manifestPath, head } = fixture();

        const exitCode = await main([
            '--task',
            ABSENT_GATE.task,
            '--gate',
            ABSENT_GATE.gate,
            '--manifest',
            manifestPath,
        ]);

        expect(exitCode).toBe(2);
        const recordPath = join(root, 'evidence/agent-campaign/records', `${ABSENT_GATE.gate}.json`);
        const record = parseEvidenceRecord(readFileSync(recordPath, 'utf8'), recordPath);
        expect(record.outcome).toBe('blocked');
        expect(record.integratedCommit).toBe(head);
        expect(record.durationMs).toBe(0);
        expect(record.environment).toEqual(readEnvironmentDigests(root, manifest));
    });

    it('leaves the manifest current when an environment input changes', async () => {
        const { root, manifest, manifestPath } = fixture();
        write(root, ENVIRONMENT_INPUT, '{"name":"temp","version":"1.0.0"}\n');

        expect(compareDigests(manifest, readLiveDigests(root, manifest))).toEqual([]);
        await expect(main(['--manifest', manifestPath])).resolves.toBe(0);
    });

    it('reports every suite without a record when release readiness is asked for', async () => {
        const { manifestPath } = fixture();

        await expect(main(['--release', '--manifest', manifestPath])).resolves.toBe(1);
    });
});
