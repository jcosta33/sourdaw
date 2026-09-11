/**
 * Guard: the sourdaw-craft burn-down lists stay honest.
 *
 * scripts/oxlintCraft/plugin.mjs skips a rule for exactly the paths listed
 * under that rule in oxlint.craft-baseline.mjs. Those lists only burn down
 * if they can only shrink: a path that no longer exists must be removed by
 * hand, and a duplicate or an out-of-order entry would let a merge quietly
 * re-add a path that already left the list.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { craftBaselineFiles, craftRuleIds } from '../../../oxlint.craft-baseline.mjs';

const repoRoot = resolve(import.meta.dirname, '../../..');

describe('oxlint craft baseline', () => {
    it('should key a list for every craft rule id and no other keys', () => {
        expect(Object.keys(craftBaselineFiles).sort()).toEqual([...craftRuleIds].sort());
    });

    it('should list every path relative to the repo root, sorted and free of duplicates', () => {
        for (const ruleId of craftRuleIds) {
            const files = craftBaselineFiles[ruleId];
            const sorted = [...files].sort();
            expect(files, ruleId).toEqual(sorted);
            expect(new Set(files).size, ruleId).toBe(files.length);
        }
    });

    it('should name only files that still exist on disk', () => {
        const missing = craftRuleIds.flatMap((ruleId) =>
            craftBaselineFiles[ruleId]
                .filter((relativePath) => !existsSync(resolve(repoRoot, relativePath)))
                .map((relativePath) => `${ruleId}:${relativePath}`)
        );
        expect(missing).toEqual([]);
    });
});
