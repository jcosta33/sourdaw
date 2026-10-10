import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
    launchUnitPhase,
    prepareUnitIsolation,
    runUnitPhase,
    type UnitIsolationContext,
    type UnitIsolationPorts,
} from '../runIsolatedUnitShard';
import { ownCheckoutDirectories, type DirectoryPorts } from '../unitShardCheckoutOwnership';

const root = '/checkout';
const nonce = '01234567-0123-4123-8123-012345678901';
const privateRoot = `/var/tmp/ci-unit-${nonce}`;
const toolRoot = `/var/tmp/sourdaw-unit-tools-${nonce}`;
const sourceHead = 'a'.repeat(40);
const context: UnitIsolationContext = {
    workspace: `${privateRoot}/checkout`,
    sourceWorkspace: root,
    sourceHead,
    toolRoot,
    uid: 20000,
    gid: 20000,
    runnerUid: 1001,
    account: 'sdaw-unit-20000',
    home: join(privateRoot, 'home'),
    store: join(privateRoot, 'store'),
    temp: join(privateRoot, 'tmp'),
    node: '/tools/node/bin/node',
    pnpm: `${toolRoot}/pnpm`,
};
const status = [
    'Uid:\t20000\t20000\t20000\t20000',
    'Gid:\t20000\t20000\t20000\t20000',
    'Groups:\t',
    'CapInh:\t0000000000000000',
    'CapPrm:\t0000000000000000',
    'CapEff:\t0000000000000000',
    'CapBnd:\t0000000000000000',
    'CapAmb:\t0000000000000000',
    'NoNewPrivs:\t1',
    '',
].join('\n');

function setupPorts() {
    const run = vi.fn<UnitIsolationPorts['run']>((file, args) => {
        if (file === '/usr/bin/git') {
            let stdout = '';
            if (args.includes('HEAD')) {
                stdout = sourceHead;
            }
            if (args.includes('--is-shallow-repository')) {
                stdout = 'false';
            }
            if (args.includes('show-ref')) {
                stdout = `${sourceHead} refs/remotes/origin/main`;
            }
            return { status: 0, stdout, stderr: '' };
        }
        if (file === '/usr/bin/ps') {
            return { status: 0, stdout: '777 1001\n888 0\n', stderr: '' };
        }
        if (file === '/usr/bin/getent') {
            return { status: 2, stdout: '', stderr: '' };
        }
        if (file === '/usr/bin/which') {
            return { status: 0, stdout: `${context.pnpm}\n`, stderr: '' };
        }
        expect(file).toBe('/usr/bin/sudo');
        expect(args.slice(0, 2)).toEqual(['-n', '--']);
        return { status: 0, stdout: '', stderr: '' };
    });
    const write = vi.fn<UnitIsolationPorts['write']>();
    const ports: UnitIsolationPorts = {
        env: {
            CI: 'true',
            GITHUB_ACTIONS: 'true',
            RUNNER_OS: 'Linux',
            RUNNER_ENVIRONMENT: 'github-hosted',
            GITHUB_WORKSPACE: root,
            SOURDAW_UNIT_TOOL_ROOT: toolRoot,
            NODE_OPTIONS: '--unexpected-loader',
            EXTRA_CREDENTIAL: 'private-fixture',
        },
        platform: 'linux',
        uid: 1001,
        pid: 777,
        cwd: root,
        node: context.node,
        run,
        canonical: (path) => path,
        metadata: (path) => ({
            directory: !path.endsWith('.json'),
            file: path.endsWith('.json'),
            uid: 1001,
            gid: 1001,
            mode: path.endsWith('.json') ? 0o600 : 0o755,
            device: 1,
        }),
        mkdir: vi.fn(),
        write,
        read: () => JSON.stringify(context),
        executable: vi.fn(),
        chooseUid: () => context.uid,
        nonce: () => nonce,
        independentObjects: vi.fn(),
    };
    return { ports, run, write };
}

function runtimePorts() {
    const { ports, run } = setupPorts();
    ports.uid = context.uid;
    ports.env = {
        HOME: context.home,
        PATH: `${dirname(context.node)}:${dirname(context.pnpm)}:/usr/local/bin:/usr/bin:/bin`,
        PNPM_CONFIG_STORE_DIR: context.store,
        CI: 'true',
        GITHUB_ACTIONS: 'true',
        GITHUB_WORKSPACE: context.workspace,
        VITEST_MAX_WORKERS: '4',
        TMPDIR: context.temp,
        TMP: context.temp,
        TEMP: context.temp,
    };
    ports.metadata = () => ({
        directory: true,
        file: false,
        uid: context.uid,
        gid: context.gid,
        mode: 0o700,
        device: 1,
    });
    ports.read = () => status;
    run.mockImplementation(() => ({ status: 0, stdout: '', stderr: '' }));
    return { ports, run };
}

describe('required unit account isolation', () => {
    it('admits a private execution copy when the new UID cannot search original checkout ancestry', () => {
        const { ports, run } = setupPorts();
        const original = run.getMockImplementation();
        run.mockImplementation((file, args, options) => {
            if (args.includes('/usr/bin/setpriv') && args.includes(`${root}/scripts/runIsolatedUnitShard.ts`)) {
                return { status: 1, stdout: '', stderr: 'MODULE_NOT_FOUND\n' };
            }
            return original?.(file, args, options) ?? { status: 1, stdout: '', stderr: '' };
        });
        expect(() => prepareUnitIsolation(ports)).not.toThrow();
        const dropped = run.mock.calls.find(([, args]) => args.includes('/usr/bin/setpriv'));
        expect(dropped?.[1]).toContain('-e');
        expect(JSON.parse(dropped?.[1].find((value) => value.startsWith('{')) ?? '{}').workspace).toBe(
            context.workspace
        );
        const preparation = run.mock.calls.find(([, args]) => args.includes('prepare-directories'));
        const saved = preparation?.[1].find((value) => value.startsWith('{'));
        expect(JSON.parse(saved ?? '{}').workspace).toBe(`/var/tmp/ci-unit-${nonce}/checkout`);
    });

    it('allocates the fresh no-mail account with supported shadow options', () => {
        const { ports, run } = setupPorts();
        const original = run.getMockImplementation();
        let mailCreated = false;
        run.mockImplementation((file, args, options) => {
            if (args.includes('/usr/sbin/useradd')) {
                // shadow useradd -K accepts login.defs keys, not /etc/default/useradd keys.
                if (args.includes('CREATE_MAIL_SPOOL=no')) {
                    return {
                        status: 3,
                        stdout: '',
                        stderr: "configuration error - unknown item 'CREATE_MAIL_SPOOL' (notify administrator)\n",
                    };
                }
                mailCreated = !args.includes('--system');
                const maximum = args.find((arg) => arg.startsWith('SYS_UID_MAX='));
                if (args.includes('--system') && Number(maximum?.split('=')[1] ?? 999) < context.uid) {
                    return {
                        status: 0,
                        stdout: '',
                        stderr: 'useradd warning: selected uid is greater than SYS_UID_MAX\n',
                    };
                }
                expect(args).toEqual(
                    expect.arrayContaining([
                        '--uid',
                        '20000',
                        '--gid',
                        '--no-create-home',
                        '--no-log-init',
                        '--password',
                        '!',
                        '--home-dir',
                        context.home,
                        '--shell',
                        '/usr/sbin/nologin',
                    ])
                );
            }
            return original?.(file, args, options) ?? { status: 1, stdout: '', stderr: '' };
        });
        expect(() => prepareUnitIsolation(ports)).not.toThrow();
        expect(mailCreated).toBe(false);
        expect(run.mock.calls.some(([, args]) => args.includes('verify'))).toBe(true);
        expect(run.mock.calls.some(([, args]) => args.includes('install'))).toBe(false);
    });

    it('admits an unused UID before account setup, creates private storage, and drops privilege before executable verification', () => {
        const { ports, run, write } = setupPorts();
        const path = prepareUnitIsolation(ports);
        expect(path).toBe(`${root}/.agents/guard-storage-fixtures/unit-account-${nonce}.json`);
        expect(write).toHaveBeenCalledWith(path, JSON.stringify(context), 0o600);
        for (const path of [privateRoot, context.home, context.store, context.temp]) {
            expect(ports.mkdir).toHaveBeenCalledWith(path, 0o700);
        }
        const calls = run.mock.calls;
        expect(calls[0]?.slice(0, 2)).toEqual(['/usr/bin/ps', ['-axo', 'pid=,uid=']]);
        const setup = calls.filter(([file]) => file === '/usr/bin/sudo');
        expect(setup).toHaveLength(4);
        expect(setup[0]?.[1]).toContain('/usr/sbin/groupadd');
        expect(setup[1]?.[1]).toContain('/usr/sbin/useradd');
        expect(setup[2]?.[1]).toContain('prepare-directories');
        const drop = setup[3]?.[1];
        expect(drop).toEqual(
            expect.arrayContaining([
                '/usr/bin/setpriv',
                '--reuid=20000',
                '--regid=20000',
                '--clear-groups',
                '--inh-caps=-all',
                '--bounding-set=-all',
                '--ambient-caps=-all',
                '--no-new-privs',
                '/usr/bin/env',
                '-i',
                'verify',
            ])
        );
        for (const [, args] of setup) {
            expect(args.join(' ')).not.toContain('unexpected-loader');
            expect(args.join(' ')).not.toContain('private-fixture');
        }
        expect(calls.some(([, args]) => args.includes('install'))).toBe(false);
    });

    it.each([
        'platform',
        'host',
        'root',
        'workspace',
        'used UID',
        'empty census',
        'malformed census',
        'existing account',
    ])('fails before privileged setup for %s', (failure) => {
        const { ports, run } = setupPorts();
        if (failure === 'platform') {
            ports.platform = 'darwin';
        }
        if (failure === 'host') {
            ports.env.RUNNER_ENVIRONMENT = 'self-hosted';
        }
        if (failure === 'root') {
            ports.uid = 0;
        }
        if (failure === 'workspace') {
            ports.canonical = () => '/outside';
        }
        if (failure === 'used UID' || failure === 'empty census' || failure === 'malformed census') {
            let stdout = '777 1001\ntruncated\n';
            if (failure === 'used UID') {
                stdout = '777 1001\n999 20000\n';
            }
            if (failure === 'empty census') {
                stdout = '';
            }
            run.mockImplementation(() => ({ status: 0, stdout, stderr: '' }));
        }
        if (failure === 'existing account') {
            run.mockImplementation((file) => ({
                status: 0,
                stdout: file.endsWith('ps') ? '777 1001\n' : 'existing',
                stderr: '',
            }));
        }
        expect(() => prepareUnitIsolation(ports)).toThrow();
        expect(run.mock.calls.some(([file]) => file === '/usr/bin/sudo')).toBe(false);
    });

    it('keeps launch failure and exact shard arguments after validating runner-owned context', () => {
        const { ports, run } = setupPorts();
        const original = run.getMockImplementation();
        run.mockImplementation((file, args, options) => {
            if (file === '/usr/bin/sudo') {
                return { status: 7, stdout: '', stderr: '' };
            }
            return original?.(file, args, options) ?? { status: 1, stdout: '', stderr: '' };
        });
        expect(
            launchUnitPhase(`${root}/.agents/guard-storage-fixtures/unit-account-${nonce}.json`, 'shard', '3/4', ports)
        ).toBe(7);
        expect(run.mock.calls[1]?.[1]).toEqual(expect.arrayContaining(['-e', 'shard', '3/4']));
        const metadata = ports.metadata;
        ports.metadata = (path) => {
            if (path.endsWith('.json')) {
                return { directory: false, file: true, uid: 0, gid: 0, mode: 0o600, device: 1 };
            }
            return metadata(path);
        };
        expect(() =>
            launchUnitPhase(
                `${root}/.agents/guard-storage-fixtures/unit-account-${nonce}.json`,
                'install',
                undefined,
                ports
            )
        ).toThrow('ownership');
        expect(run).toHaveBeenCalledTimes(2);
    });

    it('requires the native denied-consumer proof during verification and propagates its failure before any install', () => {
        const { ports, run } = runtimePorts();
        run.mockReturnValue({ status: 6, stdout: '', stderr: '' });
        expect(runUnitPhase(context, 'verify', undefined, ports)).toBe(6);
        expect(run.mock.calls[0]?.slice(0, 2)).toEqual([
            context.node,
            [`${context.workspace}/scripts/verifyUnitStorageIsolation.ts`],
        ]);
        expect(run).toHaveBeenCalledTimes(1);
        const setup = setupPorts();
        const original = setup.run.getMockImplementation();
        setup.run.mockImplementation((file, args, options) => {
            if (args.includes('verify')) {
                return { status: 6, stdout: '', stderr: '' };
            }
            return original?.(file, args, options) ?? { status: 1, stdout: '', stderr: '' };
        });
        expect(() => prepareUnitIsolation(setup.ports)).toThrow('unprivileged executable admission');
        expect(setup.run.mock.calls.some(([, args]) => args.includes('install'))).toBe(false);
    });

    it('runs frozen install and the unconditional zero-assertion wrapper only after real identity admission, propagating failure', () => {
        const { ports, run } = runtimePorts();
        run.mockReturnValue({ status: 9, stdout: '', stderr: '' });
        const receipt = vi.spyOn(console, 'info').mockImplementation(() => {});
        try {
            expect(runUnitPhase(context, 'install', undefined, ports)).toBe(9);
            expect(run.mock.calls[0]?.slice(0, 2)).toEqual([
                context.pnpm,
                ['install', '--frozen-lockfile', '--store-dir', context.store],
            ]);
            expect(runUnitPhase(context, 'shard', '4/4', ports)).toBe(9);
            expect(run.mock.calls[1]?.slice(0, 2)).toEqual([context.pnpm, ['run', 'test:run', '--shard=4/4']]);
            expect(receipt).toHaveBeenCalledWith(
                'unit isolation admitted: uid=20000 gid=20000 groups=empty caps=empty no-new-privs=1 phase=shard shard=4/4'
            );
            expect(ports.executable).toHaveBeenCalledWith(context.node);
            expect(ports.executable).toHaveBeenCalledWith(context.pnpm);
        } finally {
            receipt.mockRestore();
        }
    });

    it('forwards the explicit install store to real pinned pnpm descendants in every phase', () => {
        const invokingPnpm = process.env.npm_execpath;
        expect(invokingPnpm).toBeDefined();
        if (invokingPnpm === undefined) {
            throw new Error('the invoking pinned pnpm executable is required');
        }
        const fixture = mkdtempSync(join(tmpdir(), 'sourdaw-unit-store-'));
        const pinnedVersion = JSON.parse(
            readFileSync(join(process.cwd(), 'package.json'), 'utf8')
        ).packageManager.replace('pnpm@', '');
        const actualContext = {
            ...context,
            workspace: fixture,
            home: join(fixture, 'home'),
            store: join(fixture, 'store'),
            temp: join(fixture, 'tmp'),
            node: process.execPath,
            pnpm: realpathSync(invokingPnpm),
        };
        const { ports, run } = runtimePorts();
        ports.env = {
            ...ports.env,
            HOME: actualContext.home,
            PATH: `${dirname(actualContext.node)}:${dirname(actualContext.pnpm)}:/usr/local/bin:/usr/bin:/bin`,
            PNPM_CONFIG_STORE_DIR: actualContext.store,
            GITHUB_WORKSPACE: fixture,
            TMPDIR: actualContext.temp,
            TMP: actualContext.temp,
            TEMP: actualContext.temp,
        };
        const observations: Array<{ version: string; store: string }> = [];
        const receipt = vi.spyOn(console, 'info').mockImplementation(() => {});
        try {
            for (const path of [actualContext.home, actualContext.store, actualContext.temp]) {
                mkdirSync(path, { mode: 0o700 });
            }
            run.mockImplementation((_file, _args, options) => {
                const result = spawnSync(
                    process.execPath,
                    [
                        '-e',
                        `const {execFileSync}=require('node:child_process');
                         const cli=process.argv[1];
                         const version=execFileSync(cli,['--version'],{encoding:'utf8'}).trim();
                         const store=execFileSync(cli,['config','get','storeDir'],{encoding:'utf8'}).trim();
                         process.stdout.write(JSON.stringify({version,store}));`,
                        actualContext.pnpm,
                    ],
                    { cwd: options?.cwd, env: options?.env, encoding: 'utf8', timeout: 10_000 }
                );
                expect(result.error).toBeUndefined();
                expect(result.status, result.stderr).toBe(0);
                observations.push(JSON.parse(result.stdout));
                return { status: result.status, stdout: result.stdout, stderr: result.stderr };
            });
            expect(runUnitPhase(actualContext, 'install', undefined, ports)).toBe(0);
            expect(run.mock.calls[0]?.[1]).toEqual([
                'install',
                '--frozen-lockfile',
                '--store-dir',
                actualContext.store,
            ]);
            expect(runUnitPhase(actualContext, 'verify', undefined, ports)).toBe(0);
            expect(runUnitPhase(actualContext, 'shard', '3/4', ports)).toBe(0);
            expect(observations).toEqual(
                Array.from({ length: 3 }, () => ({ version: pinnedVersion, store: actualContext.store }))
            );
        } finally {
            receipt.mockRestore();
            rmSync(fixture, { recursive: true });
        }
    }, 20_000);

    it.each(['1/4 --context=/private', '--shard=1/4'])(
        'rejects helper arguments embedded in the Vitest shard %s before launching pnpm',
        (shard) => {
            const { ports, run } = runtimePorts();
            expect(() => runUnitPhase(context, 'shard', shard, ports)).toThrow('unit shard must remain one of four');
            expect(run).not.toHaveBeenCalled();
        }
    );

    it.each([
        'UID',
        'GID',
        'capability',
        'groups',
        'NoNewPrivs',
        'duplicate',
        'truncated',
        'storage',
        'executable',
        'loader',
        'credential',
        'store configuration',
    ])('refuses %s without running pnpm or relaxing permissions', (failure) => {
        const { ports, run } = runtimePorts();
        let sample = status;
        if (failure === 'UID') {
            sample = status.replace('Uid:\t20000', 'Uid:\t0');
        }
        if (failure === 'GID') {
            sample = status.replace('Gid:\t20000', 'Gid:\t1001');
        }
        if (failure === 'capability') {
            sample = status.replace('CapEff:\t0000000000000000', 'CapEff:\t0000000000000001');
        }
        if (failure === 'groups') {
            sample = status.replace('Groups:\t', 'Groups:\t1001');
        }
        if (failure === 'NoNewPrivs') {
            sample = status.replace('NoNewPrivs:\t1', 'NoNewPrivs:\t0');
        }
        if (failure === 'duplicate') {
            sample += 'Uid:\t20000\t20000\t20000\t20000\n';
        }
        if (failure === 'truncated') {
            sample = status.trimEnd();
        }
        if (failure === 'storage') {
            ports.metadata = () => ({ directory: true, file: false, uid: 1001, gid: 1001, mode: 0o755, device: 1 });
        }
        if (failure === 'executable') {
            ports.executable = () => {
                throw new Error('EACCES');
            };
        }
        if (failure === 'loader') {
            ports.env.NODE_OPTIONS = '--unexpected-loader';
        }
        if (failure === 'credential') {
            ports.env.EXTRA_CREDENTIAL = 'private-fixture';
        }
        if (failure === 'store configuration') {
            ports.env.PNPM_CONFIG_STORE_DIR = '/outside/store';
        }
        ports.read = () => sample;
        expect(() => runUnitPhase(context, 'install', undefined, ports)).toThrow();
        expect(run).not.toHaveBeenCalled();
    });
});

function directoryPorts() {
    const own = vi.fn<DirectoryPorts['own']>();
    const close = vi.fn<DirectoryPorts['close']>();
    const open = vi.fn<DirectoryPorts['open']>((path) => {
        if (path === root) {
            return 1;
        }
        if (path === '/proc/self/fd/1/physical') {
            return 2;
        }
        throw new Error('unexpected file or symlink traversal');
    });
    const ports: DirectoryPorts = {
        open,
        own,
        close,
        now: () => 0,
        metadata: () => ({ directory: true, device: 1, links: 2 }),
        physicalPath: (fd) => (fd === 1 ? root : `${root}/physical`),
        children: (fd) => {
            if (fd === 1) {
                return [
                    { name: 'physical', directory: true, symlink: false },
                    { name: 'hardlinked-file', directory: false, symlink: false },
                    { name: 'outside-link', directory: true, symlink: true },
                ];
            }
            return [];
        },
    };
    return { ports, own, close, open };
}

describe('checkout directory ownership', () => {
    it('changes only opened physical directory descriptors, excluding hardlinked files and symlink targets', () => {
        const { ports, own, close, open } = directoryPorts();
        ownCheckoutDirectories({ ...context, workspace: root }, ports);
        expect(open.mock.calls).toEqual([[root], ['/proc/self/fd/1/physical']]);
        expect(own.mock.calls).toEqual([
            [1, 20000, 20000],
            [2, 20000, 20000],
        ]);
        expect(close.mock.calls).toEqual([[2], [1]]);
    });

    it.each(['outside', 'device', 'file', 'unlinked', 'deadline'])(
        'does not own a child when its %s proof fails',
        (failure) => {
            const { ports, own, close } = directoryPorts();
            if (failure === 'outside') {
                ports.physicalPath = (fd) => (fd === 1 ? root : '/outside');
            }
            if (failure === 'device' || failure === 'file' || failure === 'unlinked') {
                ports.metadata = (fd) => ({
                    directory: failure !== 'file' || fd === 1,
                    device: failure === 'device' && fd === 2 ? 2 : 1,
                    links: failure === 'unlinked' && fd === 2 ? 0 : 2,
                });
            }
            if (failure === 'deadline') {
                let calls = 0;
                ports.now = () => (++calls > 2 ? 300001 : 0);
            }
            expect(() => ownCheckoutDirectories({ ...context, workspace: root }, ports)).toThrow('boundary');
            expect(own.mock.calls).toEqual([[1, 20000, 20000]]);
            expect(close.mock.calls).toEqual([[2], [1]]);
        }
    );
});
