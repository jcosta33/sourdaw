import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    appendUnitShardExclusions,
    DEVICE_WRITE_BOUNDARY_CENSUS_EXCLUDE_GLOB,
    DEVICE_WRITE_BOUNDARY_CENSUS_SPEC,
} from '../vitestUnitShardExclusions.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('appendUnitShardExclusions', () => {
    it('leaves non-sharded invocations unchanged', () => {
        const args = ['scripts/__tests__/vitestZeroTestReport.spec.ts'] as const;
        expect(appendUnitShardExclusions(args)).toEqual(args);
    });

    it('appends the census exclude glob when sharding', () => {
        expect(appendUnitShardExclusions(['--shard=2/4'])).toEqual([
            '--shard=2/4',
            '--exclude',
            DEVICE_WRITE_BOUNDARY_CENSUS_EXCLUDE_GLOB,
        ]);
    });

    it('does not duplicate the exclude when the census spec is run directly', () => {
        expect(appendUnitShardExclusions([DEVICE_WRITE_BOUNDARY_CENSUS_SPEC])).toEqual([
            DEVICE_WRITE_BOUNDARY_CENSUS_SPEC,
        ]);
    });
});

describe('DEVICE_WRITE_BOUNDARY_CENSUS_EXCLUDE_GLOB', () => {
    it('names a spec that exists on disk', () => {
        expect(existsSync(join(repoRoot, DEVICE_WRITE_BOUNDARY_CENSUS_SPEC))).toBe(true);
    });

    // Spawns a second Vitest process to collect real files, so it runs slower than the rest of this file.
    it('removes the census from a real Vitest collection', { timeout: 60_000 }, () => {
        const vitestBin = join(repoRoot, 'node_modules/.bin/vitest');
        const targetDir = 'src/modules/Arrangement/stores/__tests__';

        const excluded = spawnSync(
            vitestBin,
            ['list', '--filesOnly', targetDir, '--exclude', DEVICE_WRITE_BOUNDARY_CENSUS_EXCLUDE_GLOB],
            { cwd: repoRoot, encoding: 'utf8' }
        );
        const excludedLines = excluded.stdout.split('\n').filter((line) => line.length > 0);

        expect(excluded.status).toBe(0);
        expect(excludedLines.length).toBeGreaterThan(0);
        expect(excludedLines.some((line) => line.endsWith('deviceWriteBoundaryClosure.spec.ts'))).toBe(false);

        const unfiltered = spawnSync(vitestBin, ['list', '--filesOnly', targetDir], {
            cwd: repoRoot,
            encoding: 'utf8',
        });
        const unfilteredLines = unfiltered.stdout.split('\n').filter((line) => line.length > 0);

        expect(unfilteredLines.some((line) => line.endsWith('deviceWriteBoundaryClosure.spec.ts'))).toBe(true);
    });
});
