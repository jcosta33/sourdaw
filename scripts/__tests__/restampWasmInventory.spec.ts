import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { applyWasmRestamp, assertCommittedArtifactsAreFresh, wasmRestampPlan } from '../restampWasmInventory.ts';
import { wasmArtifacts, type WasmManifest } from '../wasm-artifacts.ts';

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
        const output = execFileSync('node', ['scripts/restampWasmInventory.ts'], {
            cwd: process.cwd(),
            encoding: 'utf8',
        });
        expect(output).toContain('already current');
    });
});

describe('wasm restamp write and refusals', () => {
    const freshSurface = { id: 'project-wasm', ...expectedSurface };

    it('writes every contract field, the snapshot target digest, and the canonical serialization', () => {
        const inventory = {
            surfaces: [{ ...freshSurface, revisions: ['stale'] }],
            snapshots: [{ path: 'public/wasm/manifest.json', sha256: 'older-snapshot' }],
        };
        const plan = wasmRestampPlan(inventory.surfaces[0]!, expectedSurface, inventory.snapshots[0]!, 'current');
        if (plan === undefined || plan.snapshotSha === undefined) {
            throw new Error('expected a full plan');
        }
        const written = applyWasmRestamp(
            inventory,
            inventory.surfaces[0]!,
            inventory.snapshots[0]!,
            expectedSurface,
            plan
        );
        const parsed = JSON.parse(written) as { surfaces: unknown[]; snapshots: { sha256: string }[] };
        expect(parsed.surfaces[0]).toEqual({ id: 'project-wasm', ...expectedSurface });
        expect(parsed.snapshots[0]?.sha256).toBe('current');
        expect(written.endsWith('}\n')).toBe(true);
        expect(written).toContain('\n    "surfaces"');
    });

    it('refuses, naming the package, when a recorded crate hash moved without a rebuild', () => {
        const manifest: WasmManifest = wasmArtifacts.readManifest();
        const [id, entry] = Object.entries(manifest.packages)[0]!;
        const tampered: WasmManifest = {
            ...manifest,
            packages: { ...manifest.packages, [id]: { ...entry, crateSourceHash: 'sha256:tampered' } },
        };
        expect(() => assertCommittedArtifactsAreFresh(tampered)).toThrow(
            new RegExp(`crate sources of ${id}.*moved without a rebuild`)
        );
    });

    it('accepts the committed manifest on a fresh tree', () => {
        expect(() => assertCommittedArtifactsAreFresh(wasmArtifacts.readManifest())).not.toThrow();
    });
});
