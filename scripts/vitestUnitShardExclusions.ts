/**
 * CI unit shards share one Vitest worker pool per matrix leg. A spec whose cost
 * is charged once per file, or once per case in a subprocess, pays that cost on
 * top of the shard's accumulated load and can exceed Vitest's default timeout
 * there. Keep those specs out of sharded runs and execute them once from the
 * static contract lane instead.
 */

import { basename } from 'node:path';

export const UNIT_SHARD_EXCLUDED_SPECS = [
    // Walks every production source once in `beforeAll`, after thousands of prior specs have loaded into the same shard process.
    'src/modules/Arrangement/stores/__tests__/deviceWriteBoundaryClosure.spec.ts',
    // Every case assembles a full release candidate: two repository clones and a zip subprocess apiece.
    'scripts/__tests__/releaseProof.spec.ts',
] as const;

export function unitShardExcludeGlob(spec: string): string {
    return `**/${basename(spec)}`;
}

function hasVitestShardArgument(args: readonly string[]): boolean {
    return args.some((argument) => argument === '--shard' || argument.startsWith('--shard='));
}

function alreadyExcludes(args: readonly string[], spec: string): boolean {
    const glob = unitShardExcludeGlob(spec);
    if (args.includes(spec) || args.includes(`--exclude=${glob}`)) {
        return true;
    }
    return args.some((argument, index) => argument === '--exclude' && args[index + 1] === glob);
}

export function appendUnitShardExclusions(args: readonly string[]): readonly string[] {
    if (!hasVitestShardArgument(args)) {
        return args;
    }
    const missing = UNIT_SHARD_EXCLUDED_SPECS.filter((spec) => !alreadyExcludes(args, spec));
    return [...args, ...missing.flatMap((spec) => ['--exclude', unitShardExcludeGlob(spec)])];
}
