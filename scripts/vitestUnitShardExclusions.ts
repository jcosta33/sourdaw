/**
 * CI unit shards share one Vitest worker pool per matrix leg. The device write
 * boundary census walks production sources once in `beforeAll`, but after
 * thousands of prior specs in the same shard process its classify case can
 * exceed Vitest's default timeout. Keep the census out of sharded runs and
 * execute it once from the static contract lane instead.
 */

export const DEVICE_WRITE_BOUNDARY_CENSUS_SPEC =
    'src/modules/Arrangement/stores/__tests__/deviceWriteBoundaryClosure.spec.ts' as const;

export const DEVICE_WRITE_BOUNDARY_CENSUS_EXCLUDE_GLOB =
    `**/${DEVICE_WRITE_BOUNDARY_CENSUS_SPEC.split('/').at(-1)}` as const;

function hasVitestShardArgument(args: readonly string[]): boolean {
    for (const argument of args) {
        if (argument.startsWith('--shard=') || argument === '--shard') {
            return true;
        }
    }
    return false;
}

function alreadyExcludesCensus(args: readonly string[]): boolean {
    for (const argument of args) {
        if (argument === DEVICE_WRITE_BOUNDARY_CENSUS_SPEC) {
            return true;
        }
        if (argument.startsWith('--exclude=') && argument.includes('deviceWriteBoundaryClosure.spec.ts')) {
            return true;
        }
        if (argument === '--exclude' && args.includes(DEVICE_WRITE_BOUNDARY_CENSUS_EXCLUDE_GLOB)) {
            return true;
        }
    }
    return false;
}

export function appendUnitShardExclusions(args: readonly string[]): readonly string[] {
    if (!hasVitestShardArgument(args) || alreadyExcludesCensus(args)) {
        return args;
    }
    return [...args, '--exclude', DEVICE_WRITE_BOUNDARY_CENSUS_EXCLUDE_GLOB];
}
