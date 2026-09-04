import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    appendUnitShardExclusions,
    UNIT_SHARD_EXCLUDED_SPECS,
    unitShardExcludeGlob,
} from '../vitestUnitShardExclusions.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [censusSpec, releaseProofSpec, agentDeliveryScriptsSpec] = UNIT_SHARD_EXCLUDED_SPECS;
const excludeArguments = UNIT_SHARD_EXCLUDED_SPECS.flatMap((spec) => ['--exclude', unitShardExcludeGlob(spec)]);

describe('appendUnitShardExclusions', () => {
    it('leaves non-sharded invocations unchanged', () => {
        const args = ['scripts/__tests__/vitestZeroTestReport.spec.ts'] as const;
        expect(appendUnitShardExclusions(args)).toEqual(args);
    });

    // Spelled out rather than derived, so shortening or reordering the list fails here instead of passing silently.
    it('appends the census, release proof, and agent delivery scripts exclude globs, in that order, when sharding', () => {
        expect(appendUnitShardExclusions(['--shard=1/4'])).toEqual([
            '--shard=1/4',
            '--exclude',
            '**/deviceWriteBoundaryClosure.spec.ts',
            '--exclude',
            '**/releaseProof.spec.ts',
            '--exclude',
            '**/agentDeliveryScripts.spec.ts',
        ]);
    });

    it('appends one exclude glob per listed spec when sharding', () => {
        expect(appendUnitShardExclusions(['--shard=2/4'])).toEqual(['--shard=2/4', ...excludeArguments]);
    });

    it('leaves a non-sharded invocation naming a listed spec unchanged', () => {
        expect(appendUnitShardExclusions([releaseProofSpec])).toEqual([releaseProofSpec]);
    });

    it('does not duplicate an exclude when the sharded run names that spec as a positional path', () => {
        const args = ['--shard=2/4', releaseProofSpec] as const;
        expect(appendUnitShardExclusions(args)).toEqual([
            ...args,
            '--exclude',
            unitShardExcludeGlob(censusSpec),
            '--exclude',
            unitShardExcludeGlob(agentDeliveryScriptsSpec),
        ]);
    });

    it('does not duplicate an exclude already present as separate --exclude arguments', () => {
        const args = ['--shard=2/4', '--exclude', unitShardExcludeGlob(releaseProofSpec)] as const;
        expect(appendUnitShardExclusions(args)).toEqual([
            ...args,
            '--exclude',
            unitShardExcludeGlob(censusSpec),
            '--exclude',
            unitShardExcludeGlob(agentDeliveryScriptsSpec),
        ]);
    });

    it('does not duplicate an exclude already present as a single --exclude= argument', () => {
        const args = ['--shard=2/4', `--exclude=${unitShardExcludeGlob(releaseProofSpec)}`] as const;
        expect(appendUnitShardExclusions(args)).toEqual([
            ...args,
            '--exclude',
            unitShardExcludeGlob(censusSpec),
            '--exclude',
            unitShardExcludeGlob(agentDeliveryScriptsSpec),
        ]);
    });

    it('still appends the exclude when a non-exclude argument merely contains a listed basename', () => {
        const args = ['--shard=2/4', '--not-exclude', unitShardExcludeGlob(releaseProofSpec)] as const;
        expect(appendUnitShardExclusions(args)).toEqual([
            ...args,
            '--exclude',
            unitShardExcludeGlob(censusSpec),
            '--exclude',
            unitShardExcludeGlob(releaseProofSpec),
            '--exclude',
            unitShardExcludeGlob(agentDeliveryScriptsSpec),
        ]);
    });

    it('appends the remaining globs when the census is already excluded', () => {
        const args = ['--shard=2/4', '--exclude', unitShardExcludeGlob(censusSpec)] as const;
        expect(appendUnitShardExclusions(args)).toEqual([
            ...args,
            '--exclude',
            unitShardExcludeGlob(releaseProofSpec),
            '--exclude',
            unitShardExcludeGlob(agentDeliveryScriptsSpec),
        ]);
    });
});

function collectSpecFiles(args: readonly string[]): readonly string[] {
    const result = spawnSync(join(repoRoot, 'node_modules/.bin/vitest'), ['list', '--filesOnly', ...args], {
        cwd: repoRoot,
        encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    return result.stdout.split('\n').filter((line) => line.length > 0);
}

describe('UNIT_SHARD_EXCLUDED_SPECS', () => {
    it('names specs that exist on disk', () => {
        for (const spec of UNIT_SHARD_EXCLUDED_SPECS) {
            expect(existsSync(join(repoRoot, spec)), spec).toBe(true);
        }
    });

    // Spawns Vitest twice per listed spec to collect real files, so it runs slower than the rest of this file.
    it('drops every listed spec from a sharded collection of its own directory', { timeout: 180_000 }, () => {
        const proven = UNIT_SHARD_EXCLUDED_SPECS.map((spec) => {
            const targetDir = dirname(spec);
            const specFile = basename(spec);

            const control = collectSpecFiles([targetDir]);
            expect(
                control.some((line) => line.endsWith(`/${specFile}`)),
                `${spec} in control`
            ).toBe(true);

            const sharded = collectSpecFiles(appendUnitShardExclusions(['--shard=1/1', targetDir]));
            expect(sharded.length, `${targetDir} collected nothing`).toBeGreaterThan(0);
            expect(
                sharded.some((line) => line.endsWith(`/${specFile}`)),
                `${spec} survived sharding`
            ).toBe(false);

            return specFile;
        });

        expect(proven).toEqual([
            'deviceWriteBoundaryClosure.spec.ts',
            'releaseProof.spec.ts',
            'agentDeliveryScripts.spec.ts',
        ]);
    });
});
