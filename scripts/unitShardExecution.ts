import { dirname, isAbsolute, join } from 'node:path';

import type { UnitIsolationContext, UnitIsolationPorts } from './runIsolatedUnitShard.ts';
import { maxUnitCoverageShardBytes, unitCoverageJson, unitCoverageShardDirectory } from './unitCoveragePaths.ts';
import { unitAccessBootstrap } from './unitExecutionCopy.ts';

export const systemPath = '/usr/local/bin:/usr/bin:/bin';

export function safeEnvironment(context: UnitIsolationContext): Record<string, string> {
    return {
        HOME: context.home,
        PATH: `${dirname(context.node)}:${dirname(context.pnpm)}:${systemPath}`,
        PNPM_CONFIG_STORE_DIR: context.store,
        CI: 'true',
        GITHUB_ACTIONS: 'true',
        GITHUB_WORKSPACE: context.workspace,
        VITEST_MAX_WORKERS: '2',
        TMPDIR: context.temp,
        TMP: context.temp,
        TEMP: context.temp,
    };
}

function envArguments(env: Record<string, string>): string[] {
    return Object.entries(env).map(([key, value]) => `${key}=${value}`);
}

function droppedIdentity(context: UnitIsolationContext): string[] {
    return [
        '-n',
        '--',
        '/usr/bin/setpriv',
        `--reuid=${context.uid}`,
        `--regid=${context.gid}`,
        '--clear-groups',
        '--inh-caps=-all',
        '--bounding-set=-all',
        '--ambient-caps=-all',
        '--no-new-privs',
    ];
}

export function droppedCommand(
    ports: UnitIsolationPorts,
    context: UnitIsolationContext,
    phase: string,
    shard?: string
): ReturnType<UnitIsolationPorts['run']> {
    const args = [
        ...droppedIdentity(context),
        '/usr/bin/env',
        '-i',
        ...envArguments(safeEnvironment(context)),
        context.node,
        '-e',
        unitAccessBootstrap,
        JSON.stringify(context),
        phase,
    ];
    if (shard !== undefined) {
        args.push(shard);
    }
    return ports.run('/usr/bin/sudo', args, { cwd: '/', inheritOutput: true });
}

export function exportUnitCoverage(
    ports: UnitIsolationPorts,
    context: UnitIsolationContext,
    shard: string,
    elapsedMs: number
): void {
    const temp = ports.env.RUNNER_TEMP;
    const runId = ports.env.GITHUB_RUN_ID ?? '';
    const attempt = ports.env.GITHUB_RUN_ATTEMPT ?? '';
    if (
        !/^[1-4]\/4$/.test(shard) ||
        temp === undefined ||
        !isAbsolute(temp) ||
        ports.canonical(temp) !== temp ||
        !ports.metadata(temp).directory ||
        ports.metadata(temp).uid !== ports.uid ||
        !/^[1-9]\d*$/.test(runId) ||
        !/^[1-9]\d*$/.test(attempt)
    ) {
        throw new Error('unit coverage export identity is invalid');
    }
    // Read using the worker's own permissions. The runner never follows a pathname
    // in worker-owned storage with its wider filesystem privileges.
    const result = ports.run(
        '/usr/bin/sudo',
        [
            ...droppedIdentity(context),
            '/usr/bin/env',
            '-i',
            '/usr/bin/head',
            '--bytes',
            String(maxUnitCoverageShardBytes + 1),
            '--',
            join(context.temp, unitCoverageShardDirectory, unitCoverageJson),
        ],
        { cwd: '/', maxBuffer: maxUnitCoverageShardBytes + 1 }
    );
    if (result.status !== 0 || result.stderr !== '') {
        throw new Error('unit coverage export failed under the isolated identity');
    }
    const raw = result.stdout.trim();
    if (raw === '' || Buffer.byteLength(raw) > maxUnitCoverageShardBytes) {
        throw new Error('unit coverage export is missing or exceeds its byte limit');
    }
    const destination = join(temp, unitCoverageShardDirectory);
    const index = Number(shard[0]);
    const coverage: unknown = JSON.parse(raw);
    ports.mkdir(destination, 0o700);
    ports.write(
        join(destination, `shard-${index}.json`),
        JSON.stringify({
            version: 1,
            revision: context.sourceHead,
            runId,
            attempt,
            shard: index,
            sourceRoot: context.workspace,
            elapsedMs,
            coverage,
        }),
        0o600
    );
}
