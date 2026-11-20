import { spawnSync } from 'node:child_process';

import { beforeAll, describe, expect, it } from 'vitest';

import { appendUnitShardExclusions } from '../vitestUnitShardExclusions';

const agentSpec = 'src/modules/AiRuntime/__tests__/agentSystemAcceptance.spec.ts';
const decoy = 'scripts/__tests__/agentSystemAcceptance.spec.ts';
const coverageArgs = appendUnitShardExclusions([
    '--shard=1/4',
    '--coverage',
    '--exclude=scripts/__tests__/resourceGuardStorage.spec.ts',
    '--exclude=scripts/__tests__/resourceGuard.spec.ts',
    '--exclude=scripts/__tests__/resourceGuardShowOutput.spec.ts',
]);

type Partitions = { native: string[][]; configured: string[][] };
type Probe = {
    repository: Partitions;
    decoy: Partitions;
    alreadyLast: Partitions;
    workerMarker: string;
    missing: string | null;
    duplicate: string | null;
    invalidTopology: Array<string | null>;
};

function probeConfiguredShard(): Probe {
    // Collection and membership only. This uses the installed Vitest's Vite config and dispatch API.
    const result = spawnSync(
        process.execPath,
        [
            '--input-type=module',
            '-e',
            `
            import { relative, resolve } from 'node:path';
            import { BaseSequencer, createVitest, parseCLI } from 'vitest/node';

            const [args, agentPath, decoyPath] = JSON.parse(process.argv[1]);
            // Vitest normalizes command-line exclusions after parseCLI so they append to config exclusions.
            const { options: { exclude, ...options } } = parseCLI(['vitest', 'run', ...args]);
            const context = await createVitest({ ...options, cliExclude: exclude, watch: false, run: true });
            try {
                const files = await context.getRelevantTestSpecifications();
                const root = context.config.root;
                const agent = files.find(({ moduleId }) => relative(root, moduleId) === agentPath);
                if (!agent) throw new Error('the repository corpus must contain the Agent acceptance spec');

                const configured = context.config.sequence.sequencer;
                const partitions = async (Sequencer, candidates) => {
                    const result = [];
                    for (const index of [1, 2, 3, 4]) {
                        context.config.shard = { index, count: 4 };
                        const shard = await new Sequencer(context).shard(candidates);
                        result.push(shard.map(({ moduleId }) => relative(root, moduleId)));
                    }
                    return result;
                };
                const compare = async (candidates) => ({
                    native: await partitions(BaseSequencer, candidates),
                    configured: await partitions(configured, candidates),
                });
                const fixture = (path) => ({ moduleId: resolve(root, path) });
                const peer = (index) => fixture('scripts/__tests__/fixture' + index + '.spec.ts');
                const withDecoy = [agent, fixture(decoyPath), peer(0), peer(1)];
                const alreadyLast = [agent, peer(0), peer(5), peer(6)];
                const errorFor = async (candidates, topology) => {
                    context.config.shard = topology;
                    try {
                        await new configured(context).shard(candidates);
                        return null;
                    } catch (error) {
                        return error.message;
                    }
                };

                const result = {
                    repository: await compare(files),
                    decoy: await compare(withDecoy),
                    alreadyLast: await compare(alreadyLast),
                    workerMarker: context.config.env?.SOURDAW_PR_UNIT_COVERAGE_SHARD,
                    missing: await errorFor(withDecoy.slice(1), { index: 1, count: 4 }),
                    duplicate: await errorFor([...withDecoy, agent], { index: 1, count: 4 }),
                    invalidTopology: [],
                };
                for (const topology of [
                    undefined,
                    { index: 1, count: 3 },
                    { index: 0, count: 4 },
                    { index: 5, count: 4 },
                    { index: 1.5, count: 4 },
                ]) {
                    result.invalidTopology.push(await errorFor(withDecoy, topology));
                }
                process.stdout.write(JSON.stringify(result));
            } finally {
                await context.close();
            }
            `,
            JSON.stringify([coverageArgs, agentSpec, decoy]),
        ],
        {
            env: { ...process.env, SOURDAW_PR_UNIT_COVERAGE_SHARD: '1' },
            encoding: 'utf8',
            timeout: 20_000,
            maxBuffer: 4 * 1024 * 1024,
        }
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout);
}

describe('PR unit coverage sequencer', () => {
    let result: Probe;

    beforeAll(() => {
        result = probeConfiguredShard();
    }, 25_000);

    it('collects the full default union once and preserves every other assignment and its order', () => {
        const { native, configured } = result.repository;
        expect(configured.flat().sort()).toEqual(native.flat().sort());
        expect(configured.map((files) => files.filter((path) => path !== agentSpec))).toEqual(
            native.map((files) => files.filter((path) => path !== agentSpec))
        );
        expect(configured.map((files) => files.includes(agentSpec))).toEqual([false, false, false, true]);
    });

    it('relocates only the exact repository file even when another spec has the same basename', () => {
        const { native, configured } = result.decoy;
        expect(native.map((files) => files.includes(agentSpec))).toEqual([false, true, false, false]);
        expect(native[3]).toEqual([decoy]);
        expect(configured[1]).toEqual([]);
        expect(configured[3]).toEqual([decoy, agentSpec]);
    });

    it('keeps the default assignment and order when the Agent spec already belongs to shard four', () => {
        const { native, configured } = result.alreadyLast;
        expect(native[3]).toEqual([agentSpec]);
        expect(configured).toEqual(native);
    });

    it('keeps the activation marker out of worker subprocesses', () => {
        expect(result.workerMarker).toBe('');
    });

    it('rejects an omitted or ambiguous exact Agent spec', () => {
        expect(result.missing).toBe('PR unit coverage requires exactly one Agent acceptance spec, found 0');
        expect(result.duplicate).toBe('PR unit coverage requires exactly one Agent acceptance spec, found 2');
    });

    it('rejects missing, out-of-range, fractional, and non-four shard topology', () => {
        expect(result.invalidTopology).toEqual(Array(5).fill('PR unit coverage requires one of four shards'));
    });
});
