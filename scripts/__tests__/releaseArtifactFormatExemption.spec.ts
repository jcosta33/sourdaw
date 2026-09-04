// Release artifacts' bytes are pinned by sha256:<hex>:<path> digests in the
// inventory; a formatter rewrite silently invalidates the recorded digest and
// reddens `pnpm test:release-inventory`. This guard asks prettier through the
// same ignore-path resolution `pnpm format` uses, so removing the
// `release/*.json` entry reddens exactly this spec.

import { join, resolve } from 'node:path';

import { getFileInfo } from 'prettier';
import { describe, expect, it } from 'vitest';

import { pathAddressedSha256, readReleaseInventory, type ReleaseInventory } from '../checkReleaseInventory';

function collectReleaseDigestPaths(inventory: ReleaseInventory): string[] {
    const paths = inventory.surfaces.flatMap((surface) =>
        surface.digests.flatMap((digest) => {
            const addressed = pathAddressedSha256(digest);
            return addressed !== undefined && addressed.path.startsWith('release/') ? [addressed.path] : [];
        })
    );
    return [...new Set(paths)].sort();
}

const repoRoot = resolve(import.meta.dirname, '../..');
const inventory = readReleaseInventory(repoRoot);
const releasePaths = collectReleaseDigestPaths(inventory);

describe('.prettierignore coverage', () => {
    it('reads the pinned inventory', () => {
        // This pin makes a path silently dropped by a widened exclusion in
        // pathAddressedSha256 fail here instead of running fewer cases.
        expect(releasePaths).toEqual([
            'release/dependency-license-proofs.json',
            'release/upstream-proofs/mi-plaits-dsp-rs-LICENSE.txt',
            'release/upstream-proofs/mi-plaits-dsp-rs-kick_808.rs',
            'release/upstream-proofs/mutable-instruments-analog_bass_drum.h',
        ]);
    });

    it.each(releasePaths)('exempts %s from prettier', async (path) => {
        const fullPath = join(repoRoot, path);
        const unignored = await getFileInfo(fullPath);
        if (unignored.inferredParser === null) {
            return; // prettier has no parser for this file, so no formatter run can rewrite it
        }
        const ignored = await getFileInfo(fullPath, {
            ignorePath: join(repoRoot, '.prettierignore'),
        });
        expect(ignored.ignored).toBe(true);
    });
});
