import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { wasmRestampPlan } from '../restampWasmInventory.ts';

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
