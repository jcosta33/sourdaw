import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { fileSha256, wasmReleaseInventoryContract } from '../checkReleaseInventory.ts';
import { UNRESTAMPED_DIGEST_CLASSES } from '../restampDependencyBump.ts';
import {
    applyWasmRestamp,
    assertCommittedArtifactsAreFresh,
    RELEASE_INVENTORY_PATH,
    restampWasmInventory,
    wasmRestampPlan,
} from '../restampWasmInventory.ts';
import { parseJsonWithUniqueKeys } from '../strictJson.ts';
import { wasmArtifacts, type WasmManifest } from '../wasm-artifacts.ts';

const MANIFEST_SNAPSHOT_PATH = 'public/wasm/manifest.json';
const RESTAMP_SCRIPT_PATH = join(import.meta.dirname, '..', 'restampWasmInventory.ts');

const expectedSurface = {
    kind: 'generated-binary',
    revisions: ['rust nightly-2026-04-14', 'daw-dsp sha256:aaa'],
    digests: ['sha256:manifest-digest:public/wasm/manifest.json'],
    licenses: ['Apache-2.0'],
};

const recordedSurface = {
    id: 'project-wasm',
    ...expectedSurface,
    revisions: ['rust nightly-2026-04-14', 'daw-dsp sha256:older'],
};

const recordedSnapshot = { path: 'public/wasm/manifest.json', sha256: 'older-snapshot' };

type RecordedInventory = {
    surfaces: Record<string, unknown>[];
    snapshots: { path: string; sha256: string }[];
};

const fixtureRoots: string[] = [];

afterEach(() => {
    for (const root of fixtureRoots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

/**
 * A tree whose project-wasm surface and manifest snapshot both drifted from the committed manifest,
 * or which omits one of them so the command's shape refusals are reachable.
 */
function createFixture(omit?: 'surface' | 'snapshot'): string {
    const root = mkdtempSync(join(tmpdir(), 'restamp-wasm-'));
    fixtureRoots.push(root);
    mkdirSync(join(root, 'public/wasm'), { recursive: true });
    copyFileSync(join(wasmArtifacts.repoRoot, MANIFEST_SNAPSHOT_PATH), join(root, MANIFEST_SNAPSHOT_PATH));
    mkdirSync(join(root, 'release'), { recursive: true });
    const surfaces: Record<string, unknown>[] = [];
    if (omit !== 'surface') {
        surfaces.push({
            id: 'project-wasm',
            kind: 'stale-kind',
            paths: ['stale-paths'],
            sources: ['stale-sources'],
            revisions: ['stale-revisions'],
            digests: ['stale-digests'],
            licenses: ['stale-licenses'],
        });
    }
    const snapshots: { path: string; sha256: string }[] = [];
    if (omit !== 'snapshot') {
        snapshots.push({ path: MANIFEST_SNAPSHOT_PATH, sha256: 'stale-snapshot' });
    }
    const inventory: RecordedInventory = { surfaces, snapshots };
    writeFileSync(join(root, RELEASE_INVENTORY_PATH), `${JSON.stringify(inventory, null, 4)}\n`, 'utf8');
    return root;
}

function readFixtureInventory(root: string): RecordedInventory {
    return parseJsonWithUniqueKeys<RecordedInventory>(
        readFileSync(join(root, RELEASE_INVENTORY_PATH), 'utf8'),
        RELEASE_INVENTORY_PATH
    );
}

/** Every file under `root`, so a test can require an import or a command to leave them untouched. */
function filesUnder(root: string): Record<string, string> {
    const files: Record<string, string> = {};
    const visit = (directory: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                visit(path);
            } else {
                files[relative(root, path)] = readFileSync(path, 'utf8');
            }
        }
    };
    visit(root);
    return files;
}

function thrownMessage(action: () => void): string {
    try {
        action();
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
    throw new Error('expected the action to throw');
}

describe('wasm restamp plan', () => {
    it('reports nothing when the recorded surface and snapshot already match', () => {
        expect(
            wasmRestampPlan(
                { id: 'project-wasm', ...expectedSurface },
                expectedSurface,
                { path: 'public/wasm/manifest.json', sha256: 'current' },
                'current'
            )
        ).toBeUndefined();
    });

    it('plans exactly the drifted fields, array-aware', () => {
        const plan = wasmRestampPlan(recordedSurface, expectedSurface, undefined, 'new');
        expect(plan?.surfaceFieldChanges).toEqual([
            'project-wasm revisions: rust nightly-2026-04-14, daw-dsp sha256:older -> rust nightly-2026-04-14, daw-dsp sha256:aaa',
        ]);
        expect(plan?.snapshotSha).toBeUndefined();
    });

    it('plans the manifest snapshot digest only when it drifted', () => {
        const plan = wasmRestampPlan(recordedSurface, expectedSurface, recordedSnapshot, 'current');
        expect(plan?.snapshotSha).toEqual({
            path: 'public/wasm/manifest.json',
            from: 'older-snapshot',
            to: 'current',
        });
    });

    it('plans every field when the surface is absent', () => {
        const plan = wasmRestampPlan(undefined, expectedSurface, undefined, 'current');
        expect(plan?.surfaceFieldChanges).toHaveLength(Object.keys(expectedSurface).length);
    });

    it('the command reports a current inventory on a fresh committed tree', () => {
        const output = execFileSync('node', [RESTAMP_SCRIPT_PATH], {
            cwd: process.cwd(),
            encoding: 'utf8',
        });
        expect(output).toContain('already current');
    });
});

describe('wasm restamp write and refusals', () => {
    it('writes every field the real contract declares, the snapshot target digests, and canonical serialization', () => {
        const expected = wasmReleaseInventoryContract(wasmArtifacts.repoRoot, wasmArtifacts.readManifest());
        expect(Object.keys(expected)).toHaveLength(6);
        const inventory: RecordedInventory = {
            surfaces: [
                {
                    id: 'project-wasm',
                    kind: 'stale',
                    paths: ['stale'],
                    sources: ['stale'],
                    revisions: ['stale'],
                    digests: ['stale'],
                    licenses: ['stale'],
                },
            ],
            snapshots: [{ path: MANIFEST_SNAPSHOT_PATH, sha256: 'older-snapshot' }],
        };
        const surface = inventory.surfaces[0]!;
        const snapshot = inventory.snapshots[0]!;
        const plan = wasmRestampPlan(surface, expected, snapshot, 'current');
        if (plan === undefined || plan.snapshotSha === undefined) {
            throw new Error('expected a full plan');
        }
        const written = applyWasmRestamp(inventory, surface, snapshot, expected, plan);
        const parsed = parseJsonWithUniqueKeys<RecordedInventory>(written, 'written inventory');
        expect(parsed.surfaces[0]).toEqual({ id: 'project-wasm', ...expected });
        expect(parsed.snapshots[0]?.sha256).toBe('current');
        expect(written.endsWith('}\n')).toBe(true);
        expect(written).toContain('\n    "surfaces"');
    });

    it("names each package's real rebuild command, never a wildcard", () => {
        const manifest = wasmArtifacts.readManifest();
        for (const spec of wasmArtifacts.packages) {
            const entry = manifest.packages[spec.id];
            if (entry === undefined) {
                continue;
            }
            const tampered: WasmManifest = {
                ...manifest,
                packages: { ...manifest.packages, [spec.id]: { ...entry, crateSourceHash: 'sha256:tampered' } },
            };
            const message = thrownMessage(() => {
                assertCommittedArtifactsAreFresh(tampered);
            });
            expect(message).toContain(`crate sources of ${spec.id}`);
            expect(message).toContain(`pnpm ${spec.buildScript} && pnpm wasm:manifest`);
            expect(message).not.toContain('wasm:*');
        }
    });

    it('refuses a drifted manifest through the command before writing the fixture', () => {
        const root = createFixture();
        const before = filesUnder(root);
        const manifest = wasmArtifacts.readManifest();
        const [id, entry] = Object.entries(manifest.packages)[0]!;
        const spec = wasmArtifacts.packages.find((candidate) => candidate.id === id);
        if (spec === undefined) {
            throw new Error(`no wasm package spec for ${id}`);
        }
        const tampered: WasmManifest = {
            ...manifest,
            packages: { ...manifest.packages, [id]: { ...entry, crateSourceHash: 'sha256:tampered' } },
        };
        const message = thrownMessage(() => {
            restampWasmInventory(root, { manifest: tampered });
        });
        expect(message).toContain(`pnpm ${spec.buildScript} && pnpm wasm:manifest`);
        expect(filesUnder(root)).toEqual(before);
    });

    it('refuses an inventory with no project-wasm surface, leaving every file untouched', () => {
        const root = createFixture('surface');
        const before = filesUnder(root);
        const message = thrownMessage(() => {
            restampWasmInventory(root);
        });
        expect(message).toContain('project-wasm surface is absent from the inventory');
        expect(filesUnder(root)).toEqual(before);
    });

    it('refuses an inventory with no manifest snapshot entry, leaving every file untouched', () => {
        const root = createFixture('snapshot');
        const before = filesUnder(root);
        const message = thrownMessage(() => {
            restampWasmInventory(root);
        });
        expect(message).toContain('manifest snapshot entry is absent from the inventory');
        expect(filesUnder(root)).toEqual(before);
    });

    it('restamps a drifted fixture to exactly what the repository contract computes', () => {
        const root = createFixture();
        const output = execFileSync('node', [RESTAMP_SCRIPT_PATH], { cwd: root, encoding: 'utf8' });
        const written = readFixtureInventory(root);
        const expected = wasmReleaseInventoryContract(root, wasmArtifacts.readManifest());
        expect(written.surfaces.find((surface) => surface.id === 'project-wasm')).toEqual({
            id: 'project-wasm',
            ...expected,
        });
        expect(written.snapshots.find((entry) => entry.path === MANIFEST_SNAPSHOT_PATH)?.sha256).toBe(
            fileSha256(join(root, MANIFEST_SNAPSHOT_PATH))
        );
        expect(output).toContain('project-wasm paths:');
        expect(output).toContain(`snapshot ${MANIFEST_SNAPSHOT_PATH}:`);
        expect(output).toContain('restamped release/open-source-inventory.json');
    });

    it('accepts the committed manifest on a fresh tree', () => {
        expect(() => assertCommittedArtifactsAreFresh(wasmArtifacts.readManifest())).not.toThrow();
    });
});

describe('wasm restamp entry point', () => {
    it('importing the module leaves a deliberately drifted tree untouched', () => {
        const root = createFixture();
        const before = filesUnder(root);
        const moduleUrl = pathToFileURL(RESTAMP_SCRIPT_PATH).href;
        const output = execFileSync(
            'node',
            ['--input-type=module', '-e', `await import(${JSON.stringify(moduleUrl)})`, 'not-this-script.ts'],
            {
                cwd: root,
                encoding: 'utf8',
            }
        );
        expect(filesUnder(root)).toEqual(before);
        expect(output.trim()).toBe('');
    });

    it('is reachable as pnpm release:restamp:wasm', () => {
        const manifest = parseJsonWithUniqueKeys<{ scripts: Record<string, string> }>(
            readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8'),
            'package.json'
        );
        expect(manifest.scripts['release:restamp:wasm']).toBe('node scripts/restampWasmInventory.ts');
    });

    it('is listed in the AGENTS.md checks table beside the wasm rows', () => {
        const agents = readFileSync(join(import.meta.dirname, '../../AGENTS.md'), 'utf8');
        expect(agents).toMatch(/^\| Restamp the wasm surface +\| `pnpm release:restamp:wasm` +\|$/mu);
    });

    it('release:restamp points a rebuilt wasm surface at the wasm restamp command', () => {
        expect(UNRESTAMPED_DIGEST_CLASSES).toContain('pnpm release:restamp:wasm');
    });
});
