// Release artifacts' bytes are pinned by sha256:<hex>:<path> digests in the
// inventory; a formatter rewrite silently invalidates the recorded digest and
// reddens `pnpm test:release-inventory`. This guard asks prettier through the
// same ignore-path resolution `pnpm format` uses, so removing the
// `release/*.json` entry reddens exactly this spec.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { getFileInfo } from 'prettier';
import { describe, expect, it } from 'vitest';

import { pathAddressedSha256 } from '../checkReleaseInventory';

type OpenSourceInventory = {
    surfaces: Array<{
        digests: string[];
    }>;
};

function isOpenSourceInventory(value: unknown): value is OpenSourceInventory {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    if (!('surfaces' in value) || !Array.isArray(value.surfaces)) {
        return false;
    }
    for (const surface of value.surfaces) {
        if (
            typeof surface !== 'object' ||
            surface === null ||
            !('digests' in surface) ||
            !Array.isArray(surface.digests)
        ) {
            return false;
        }
        if (!surface.digests.every((digest) => typeof digest === 'string')) {
            return false;
        }
    }
    return true;
}

function parseInventory(data: string): OpenSourceInventory {
    const parsed = JSON.parse(data);
    if (!isOpenSourceInventory(parsed)) {
        throw new Error('release/open-source-inventory.json is not a surfaces inventory');
    }
    return parsed;
}

function collectReleaseDigestPaths(inventory: OpenSourceInventory): string[] {
    const paths = inventory.surfaces.flatMap((surface) =>
        surface.digests.flatMap((digest) => {
            const addressed = pathAddressedSha256(digest);
            return addressed !== undefined && addressed.path.startsWith('release/') ? [addressed.path] : [];
        })
    );
    return [...new Set(paths)].sort();
}

const repoRoot = resolve(import.meta.dirname, '../..');
const inventoryPath = join(repoRoot, 'release', 'open-source-inventory.json');
const inventoryData = readFileSync(inventoryPath, 'utf-8');
const inventory = parseInventory(inventoryData);
const releasePaths = collectReleaseDigestPaths(inventory);

describe('.prettierignore coverage', () => {
    it('reads the pinned inventory', () => {
        expect(releasePaths.length).toBeGreaterThan(0);
        expect(releasePaths).toContain('release/dependency-license-proofs.json');
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
