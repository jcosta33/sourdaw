import { spawnSync } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { accessSync, constants, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertIndependentUnitObjects, copyUnitCheckout, unitAccessBootstrap } from './unitExecutionCopy.ts';
import { ownCheckoutDirectories } from './unitShardCheckoutOwnership.ts';

type CommandResult = { status: number | null; stdout: string; stderr: string };
type CommandOptions = { env?: NodeJS.ProcessEnv; cwd?: string; inheritOutput?: boolean };
type Command = (file: string, args: string[], options?: CommandOptions) => CommandResult;
type Metadata = { directory: boolean; file: boolean; uid: number; gid: number; mode: number; device: number };
export type UnitIsolationContext = {
    workspace: string;
    sourceWorkspace: string;
    sourceHead: string;
    toolRoot: string;
    uid: number;
    gid: number;
    runnerUid: number;
    account: string;
    home: string;
    store: string;
    temp: string;
    node: string;
    pnpm: string;
};
export type UnitIsolationPorts = {
    env: NodeJS.ProcessEnv;
    cwd: string;
    platform: string;
    uid: number;
    pid: number;
    node: string;
    run: Command;
    canonical: (path: string) => string;
    metadata: (path: string) => Metadata;
    mkdir: (path: string, mode: number) => void;
    write: (path: string, data: string, mode: number) => void;
    read: (path: string) => string;
    executable: (path: string) => void;
    chooseUid: () => number;
    nonce: () => string;
    independentObjects: (path: string) => void;
};

const helperName = 'scripts/runIsolatedUnitShard.ts';
const systemPath = '/usr/local/bin:/usr/bin:/bin';

function nativeCommand(file: string, args: string[], options: CommandOptions = {}): CommandResult {
    const result = spawnSync(file, args, {
        cwd: options.cwd,
        env: options.env,
        encoding: 'utf8',
        stdio: options.inheritOutput ? 'inherit' : 'pipe',
        timeout: options.inheritOutput ? undefined : 300_000,
    });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function nativePorts(): UnitIsolationPorts {
    return {
        env: process.env,
        cwd: process.cwd(),
        platform: process.platform,
        uid: process.getuid?.() ?? -1,
        pid: process.pid,
        node: process.execPath,
        run: nativeCommand,
        canonical: realpathSync,
        metadata: (path) => {
            const stat = lstatSync(path);
            return {
                directory: stat.isDirectory(),
                file: stat.isFile(),
                uid: stat.uid,
                gid: stat.gid,
                mode: stat.mode & 0o777,
                device: stat.dev,
            };
        },
        mkdir: (path, mode) => {
            mkdirSync(path, { mode });
        },
        write: (path, data, mode) => {
            writeFileSync(path, data, { mode, flag: 'wx' });
        },
        read: (path) => readFileSync(path, 'utf8'),
        executable: (path) => {
            accessSync(path, constants.R_OK | constants.X_OK);
        },
        chooseUid: () => randomInt(20_000, 60_000),
        nonce: randomUUID,
        independentObjects: assertIndependentUnitObjects,
    };
}

function requireSuccess(result: CommandResult, operation: string): string {
    if (result.status !== 0 || result.stderr !== '') {
        throw new Error(`unit isolation ${operation} failed (status ${result.status ?? 'unavailable'})`);
    }
    return result.stdout.trim();
}

function workspace(ports: UnitIsolationPorts, privileged: boolean): string {
    const path = ports.env.GITHUB_WORKSPACE;
    if (
        ports.platform !== 'linux' ||
        ports.env.GITHUB_ACTIONS !== 'true' ||
        ports.env.CI !== 'true' ||
        ports.env.RUNNER_OS !== 'Linux' ||
        ports.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
        (privileged ? ports.uid !== 0 : ports.uid <= 0) ||
        path === undefined ||
        !isAbsolute(path) ||
        /[\r\n\0]/.test(path)
    ) {
        throw new Error('unit isolation requires a hosted Linux workspace and the expected setup identity');
    }
    if (
        ports.canonical(path) !== resolve(path) ||
        ports.canonical(ports.cwd) !== path ||
        !ports.metadata(path).directory ||
        !ports.metadata(join(path, '.git')).directory
    ) {
        throw new Error('unit isolation workspace must be the physical complete checkout');
    }
    return path;
}

function unusedUid(ports: UnitIsolationPorts, uid: number): void {
    const output = requireSuccess(ports.run('/usr/bin/ps', ['-axo', 'pid=,uid=']), 'process census');
    const rows = output.split('\n').map((line) => /^\s*(\d+)\s+(\d+)\s*$/.exec(line));
    if (
        rows.length === 0 ||
        rows.some((row) => row === null) ||
        !rows.some((row) => Number(row?.[1]) === ports.pid && Number(row?.[2]) === ports.uid) ||
        rows.some(
            (row) =>
                !Number.isSafeInteger(Number(row?.[1])) ||
                Number(row?.[1]) <= 0 ||
                !Number.isSafeInteger(Number(row?.[2])) ||
                Number(row?.[2]) === uid
        )
    ) {
        throw new Error('unit isolation requires a usable census and an unused numeric UID');
    }
}

function safeEnvironment(context: UnitIsolationContext): NodeJS.ProcessEnv {
    return {
        HOME: context.home,
        PATH: `${dirname(context.node)}:${dirname(context.pnpm)}:${systemPath}`,
        PNPM_CONFIG_STORE_DIR: context.store,
        CI: 'true',
        GITHUB_ACTIONS: 'true',
        GITHUB_WORKSPACE: context.workspace,
        VITEST_MAX_WORKERS: '4',
        TMPDIR: context.temp,
        TMP: context.temp,
        TEMP: context.temp,
    };
}

function envArguments(env: NodeJS.ProcessEnv): string[] {
    return Object.entries(env).map(([key, value]) => `${key}=${value}`);
}

function setupCommand(ports: UnitIsolationPorts, file: string, args: string[], root: string): CommandResult {
    return ports.run(
        '/usr/bin/sudo',
        [
            '-n',
            '--',
            '/usr/bin/env',
            '-i',
            `PATH=${systemPath}`,
            'CI=true',
            'GITHUB_ACTIONS=true',
            'RUNNER_OS=Linux',
            'RUNNER_ENVIRONMENT=github-hosted',
            `GITHUB_WORKSPACE=${root}`,
            file,
            ...args,
        ],
        { cwd: root }
    );
}

function droppedCommand(
    ports: UnitIsolationPorts,
    context: UnitIsolationContext,
    phase: string,
    shard?: string
): CommandResult {
    const args = [
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

function prepareExecutionContext(
    ports: UnitIsolationPorts,
    root: string,
    uid: number,
    nonce: string
): UnitIsolationContext {
    const privateRoot = join('/var/tmp', `ci-unit-${nonce}`);
    const execution = join(privateRoot, 'checkout');
    const toolRoot = ports.env.SOURDAW_UNIT_TOOL_ROOT;
    if (
        toolRoot === undefined ||
        !/^\/var\/tmp\/sourdaw-unit-tools-[a-f0-9-]{36}$/.test(toolRoot) ||
        ports.canonical(toolRoot) !== toolRoot ||
        !ports.metadata(toolRoot).directory ||
        ports.metadata(toolRoot).uid !== ports.uid ||
        ports.metadata(toolRoot).mode !== 0o755
    ) {
        throw new Error('unit isolation requires its independent job tool directory');
    }
    const pnpm = ports.canonical(requireSuccess(ports.run('/usr/bin/which', ['pnpm']), 'pnpm lookup'));
    if (!pnpm.startsWith(`${toolRoot}/`)) {
        throw new Error('unit isolation pnpm must belong to the job tool directory');
    }
    ports.mkdir(privateRoot, 0o700);
    ports.mkdir(execution, 0o700);
    const sourceHead = copyUnitCheckout(root, execution, {
        run: (args) =>
            ports.run('/usr/bin/git', args, {
                cwd: root,
                env: {
                    PATH: systemPath,
                    GIT_CONFIG_GLOBAL: '/dev/null',
                    GIT_CONFIG_SYSTEM: '/dev/null',
                    GIT_TERMINAL_PROMPT: '0',
                    GIT_TRACE2_EVENT: '0',
                },
            }),
        independentObjects: ports.independentObjects,
    });
    return {
        workspace: execution,
        sourceWorkspace: root,
        sourceHead,
        toolRoot,
        uid,
        gid: uid,
        runnerUid: ports.uid,
        account: `sdaw-unit-${uid}`,
        home: join(privateRoot, 'home'),
        store: join(privateRoot, 'store'),
        temp: join(privateRoot, 'tmp'),
        node: ports.canonical(ports.node),
        pnpm,
    };
}

export function prepareUnitIsolation(ports: UnitIsolationPorts = nativePorts()): string {
    const root = workspace(ports, false);
    const uid = ports.chooseUid();
    if (!Number.isSafeInteger(uid) || uid < 20_000 || uid >= 60_000 || uid === ports.uid) {
        throw new Error('unit isolation UID allocation is invalid');
    }
    unusedUid(ports, uid);
    for (const database of ['passwd', 'group']) {
        const result = ports.run('/usr/bin/getent', [database, String(uid)]);
        if (result.status !== 2 || result.stdout !== '' || result.stderr !== '') {
            throw new Error('unit isolation numeric UID/GID must be unallocated');
        }
    }
    const agentRoot = join(root, '.agents');
    if (!ports.metadata(agentRoot).directory || ports.canonical(agentRoot) !== agentRoot) {
        throw new Error('unit isolation operational parent must be a physical checkout directory');
    }
    const fixtures = join(agentRoot, 'guard-storage-fixtures');
    try {
        ports.metadata(fixtures);
    } catch {
        ports.mkdir(fixtures, 0o755);
    }
    if (
        !ports.metadata(fixtures).directory ||
        ports.canonical(fixtures) !== fixtures ||
        ports.metadata(fixtures).device !== ports.metadata(root).device
    ) {
        throw new Error('unit isolation storage must remain on the checkout device');
    }
    const nonce = ports.nonce();
    if (!/^[a-f0-9-]{36}$/.test(nonce)) {
        throw new Error('unit isolation nonce is invalid');
    }
    const context = prepareExecutionContext(ports, root, uid, nonce);
    for (const path of [context.home, context.store, context.temp]) {
        ports.mkdir(path, 0o700);
    }
    const contextPath = join(fixtures, `unit-account-${nonce}.json`);
    ports.write(contextPath, JSON.stringify(context), 0o600);
    requireSuccess(
        setupCommand(ports, '/usr/sbin/groupadd', ['--gid', String(uid), context.account], root),
        'group allocation'
    );
    requireSuccess(
        setupCommand(
            ports,
            '/usr/sbin/useradd',
            [
                '--system',
                '--uid',
                String(uid),
                '--gid',
                String(uid),
                '--no-create-home',
                '--no-log-init',
                '-K',
                `SYS_UID_MAX=${uid}`,
                '--password',
                '!',
                '--home-dir',
                context.home,
                '--shell',
                '/usr/sbin/nologin',
                context.account,
            ],
            root
        ),
        'account allocation'
    );
    requireSuccess(
        setupCommand(
            ports,
            context.node,
            [join(root, helperName), 'prepare-directories', '--context-json', JSON.stringify(context)],
            root
        ),
        'directory preparation'
    );
    requireSuccess(droppedCommand(ports, context, 'verify'), 'unprivileged executable admission');
    return contextPath;
}

function parseContext(text: string): UnitIsolationContext {
    const data: unknown = JSON.parse(text);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        throw new Error('unit isolation context is invalid');
    }
    const record = data as Record<string, unknown>;
    // Construct through checked readers so indexed values never acquire authority by a cast.
    const textAt = (key: string): string => {
        const value = record[key];
        if (typeof value !== 'string' || value.length === 0) {
            throw new TypeError('invalid text field');
        }
        return value;
    };
    const numberAt = (key: string): number => {
        const value = record[key];
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
            throw new TypeError('invalid numeric field');
        }
        return value;
    };
    const context = {
        workspace: textAt('workspace'),
        sourceWorkspace: textAt('sourceWorkspace'),
        sourceHead: textAt('sourceHead'),
        toolRoot: textAt('toolRoot'),
        account: textAt('account'),
        home: textAt('home'),
        store: textAt('store'),
        temp: textAt('temp'),
        node: textAt('node'),
        pnpm: textAt('pnpm'),
        uid: numberAt('uid'),
        gid: numberAt('gid'),
        runnerUid: numberAt('runnerUid'),
    };
    const root = dirname(context.home);
    if (
        context.uid < 20_000 ||
        context.uid >= 60_000 ||
        context.gid !== context.uid ||
        context.uid === context.runnerUid ||
        context.account !== `sdaw-unit-${context.uid}` ||
        !/^ci-unit-[a-f0-9-]{36}$/.test(root.slice(root.lastIndexOf('/') + 1)) ||
        dirname(root) !== '/var/tmp' ||
        context.workspace !== join(root, 'checkout') ||
        !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(context.sourceHead) ||
        !isAbsolute(context.sourceWorkspace) ||
        !/^\/var\/tmp\/sourdaw-unit-tools-[a-f0-9-]{36}$/.test(context.toolRoot) ||
        !context.pnpm.startsWith(`${context.toolRoot}/`) ||
        context.home !== join(root, 'home') ||
        context.store !== join(root, 'store') ||
        context.temp !== join(root, 'tmp') ||
        ![context.workspace, context.node, context.pnpm].every(isAbsolute)
    ) {
        throw new Error('unit isolation context paths or identity are invalid');
    }
    return context;
}

function runtimeIdentity(context: UnitIsolationContext, status: string): Map<string, string> {
    if (!status.endsWith('\n') || status.length > 16_384) {
        throw new Error('unit runtime identity sample is incomplete');
    }
    const fields = new Map<string, string>();
    for (const line of status.split('\n')) {
        const match = /^(Uid|Gid|Groups|CapInh|CapPrm|CapEff|CapBnd|CapAmb|NoNewPrivs):\s*(.*)$/.exec(line);
        if (match === null) {
            continue;
        }
        const [, key, value] = match;
        if (key === undefined || value === undefined || fields.has(key)) {
            throw new Error('unit runtime identity fields are ambiguous');
        }
        fields.set(key, value.trim());
    }
    for (const [key, expected] of [
        ['Uid', context.uid],
        ['Gid', context.gid],
    ] as const) {
        const values = (fields.get(key) ?? '').split(/\s+/);
        if (values.length !== 4 || values.some((value) => !/^\d+$/.test(value) || Number(value) !== expected)) {
            throw new Error('unit runtime requires all four unprivileged UID/GID fields');
        }
    }
    for (const key of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) {
        const value = fields.get(key) ?? '';
        if (!/^[a-f0-9]+$/i.test(value) || BigInt(`0x${value}`) !== 0n) {
            throw new Error('unit runtime capabilities must be empty');
        }
    }
    return fields;
}

export function assertUnitRuntime(
    context: UnitIsolationContext,
    status: string,
    ports: UnitIsolationPorts = nativePorts()
): void {
    const fields = runtimeIdentity(context, status);
    const expectedEnv = safeEnvironment(context);
    if (
        ports.platform !== 'linux' ||
        ports.uid !== context.uid ||
        fields.get('NoNewPrivs') !== '1' ||
        fields.get('Groups') !== '' ||
        Object.entries(expectedEnv).some(([key, value]) => ports.env[key] !== value) ||
        Object.keys(ports.env).some((key) => !(key in expectedEnv))
    ) {
        throw new Error('unit runtime isolation environment is invalid');
    }
    for (const path of [dirname(context.home), context.home, context.store, context.temp]) {
        const metadata = ports.metadata(path);
        if (
            !metadata.directory ||
            metadata.uid !== context.uid ||
            metadata.gid !== context.gid ||
            metadata.mode !== 0o700 ||
            ports.canonical(path) !== path
        ) {
            throw new Error('unit runtime private storage ownership is invalid');
        }
    }
    ports.executable(context.node);
    ports.executable(context.pnpm);
}

export function runUnitPhase(
    context: UnitIsolationContext,
    phase: string,
    shard: string | undefined,
    ports: UnitIsolationPorts = nativePorts()
): number {
    assertUnitRuntime(context, ports.read('/proc/self/status'), ports);
    if (phase === 'verify') {
        return (
            ports.run(context.node, [join(context.workspace, 'scripts/verifyUnitStorageIsolation.ts')], {
                cwd: context.workspace,
                env: safeEnvironment(context),
                inheritOutput: true,
            }).status ?? 1
        );
    }
    if (phase !== 'install' && phase !== 'shard') {
        throw new Error('unit isolation phase is invalid');
    }
    if (phase === 'shard' && !/^[1-4]\/4$/.test(shard ?? '')) {
        throw new Error('unit shard must remain one of four');
    }
    console.info(
        `unit isolation admitted: uid=${context.uid} gid=${context.gid} groups=empty caps=empty no-new-privs=1 phase=${phase}${shard === undefined ? '' : ` shard=${shard}`}`
    );
    let args = ['run', 'test:run', `--shard=${shard}`];
    if (phase === 'install') {
        args = ['install', '--frozen-lockfile', '--store-dir', context.store];
    }
    return (
        ports.run(context.pnpm, args, { cwd: context.workspace, env: safeEnvironment(context), inheritOutput: true })
            .status ?? 1
    );
}

export function launchUnitPhase(
    path: string,
    phase: string,
    shard: string | undefined,
    ports: UnitIsolationPorts = nativePorts()
): number {
    const root = workspace(ports, false);
    const metadata = ports.metadata(path);
    if (
        !metadata.file ||
        metadata.uid !== ports.uid ||
        metadata.mode !== 0o600 ||
        ports.canonical(path) !== path ||
        dirname(path) !== join(root, '.agents/guard-storage-fixtures')
    ) {
        throw new Error('unit isolation context file ownership is invalid');
    }
    const context = parseContext(ports.read(path));
    if (
        context.sourceWorkspace !== root ||
        context.runnerUid !== ports.uid ||
        requireSuccess(ports.run('/usr/bin/git', ['-C', root, 'rev-parse', '--verify', 'HEAD']), 'source HEAD') !==
            context.sourceHead
    ) {
        throw new Error('unit isolation context does not belong to this runner');
    }
    return droppedCommand(ports, context, phase, shard).status ?? 1;
}

function argument(args: string[], key: string): string {
    const value = args[args.indexOf(key) + 1];
    if (!args.includes(key) || value === undefined) {
        throw new Error(`unit isolation requires ${key}`);
    }
    return value;
}

function main(args: string[], ports: UnitIsolationPorts): number {
    const mode = args[0];
    if (mode === 'prepare') {
        const output = ports.env.GITHUB_OUTPUT;
        if (output === undefined) {
            throw new Error('unit isolation requires the step output file');
        }
        const context = prepareUnitIsolation(ports);
        writeFileSync(output, `context=${context}\n`, { flag: 'a' });
        return 0;
    }
    if (mode === 'prepare-directories') {
        const root = workspace(ports, true);
        const context = parseContext(argument(args, '--context-json'));
        if (context.sourceWorkspace !== root) {
            throw new Error('unit setup checkout mismatch');
        }
        unusedUid(ports, context.uid);
        const privateRoot = dirname(context.home);
        if (ports.canonical(privateRoot) !== privateRoot || ports.metadata(privateRoot).uid !== context.runnerUid) {
            throw new Error('unit setup execution root ownership mismatch');
        }
        ownCheckoutDirectories({ workspace: privateRoot, uid: context.uid, gid: context.gid });
        return 0;
    }
    const shard =
        args.find((value) => value.startsWith('--shard='))?.slice('--shard='.length) ??
        (args.includes('--shard') ? argument(args, '--shard') : undefined);
    if (mode === 'execute') {
        return runUnitPhase(parseContext(argument(args, '--context-json')), argument(args, '--phase'), shard, ports);
    }
    if (mode === 'install' || mode === 'shard') {
        return launchUnitPhase(argument(args, '--context'), mode, shard, ports);
    }
    throw new Error('unit isolation command is invalid');
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        process.exitCode = main(process.argv.slice(2), nativePorts());
    } catch (error) {
        console.error(error instanceof Error ? error.message : 'unit isolation failed');
        process.exitCode = 1;
    }
}
