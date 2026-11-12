import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync,
    mkdirSync,
    symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkpointSocketRows } from '../gitCheckpointSocket';
import { checkpointMountOptions } from '../gitCheckpointMount';

const runner = resolve('scripts/gitCheckpoint.ts');
const roots: string[] = [];
function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'checkpoint-'));
    roots.push(root);
    const receiptRoot = mkdtempSync(join(tmpdir(), 'checkpoint-receipts-'));
    roots.push(receiptRoot);
    const env = {
        ...process.env,
        SOURDAW_CHECKPOINT_DIR: receiptRoot,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_TRACE2_EVENT: '0',
    };
    const git = (...args: string[]) => {
        const result = spawnSync('git', args, { cwd: root, env, encoding: 'utf8' });
        if (result.status !== 0) {
            throw new Error(result.stderr);
        }
        return result.stdout.trim();
    };
    git('init', '-q');
    git('config', 'user.name', 'Checkpoint Test');
    git('config', 'user.email', 'checkpoint@example.invalid');
    return { root, env, git, receiptRoot };
}
function run(root: string, env: NodeJS.ProcessEnv, ...args: string[]) {
    return new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
        const child = spawn(process.execPath, [runner, ...args], { cwd: root, env });
        let stderr = '';
        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, stderr }));
    });
}
function receipt(stderr: string) {
    const path = stderr.match(/checkpoint receipt: (.+)/)?.[1];
    expect(path).toBeDefined();
    return { path: path!, value: JSON.parse(readFileSync(path!, 'utf8')) };
}
afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});
describe('Git checkpoint diagnostic', () => {
    it('preserves normal hook execution and captures source, index and HEAD around real Git writes', async () => {
        const { root, env, git } = fixture();
        mkdirSync(join(root, '.git', 'hooks'), { recursive: true });
        writeFileSync(
            join(root, '.git', 'hooks', 'commit-msg'),
            '#!/bin/sh\nprintf ran > hook-ran\nprintf changed > song.txt\n',
            { mode: 0o755 }
        );
        writeFileSync(join(root, 'song.txt'), 'first');
        const added = await run(root, env, 'add', '--', 'song.txt');
        expect(added.code).toBe(0);
        const addReceipt = receipt(added.stderr);
        expect(statSync(addReceipt.path).mode & 0o777).toBe(0o600);
        expect(addReceipt.value.before.sources['song.txt'].sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(addReceipt.value.before.index.sha256).not.toBe(addReceipt.value.after.index.sha256);
        const committed = await run(root, env, 'commit', '-m', 'test: checkpoint');
        expect(committed.code).toBe(0);
        const commitReceipt = receipt(committed.stderr).value;
        expect(readFileSync(join(root, 'hook-ran'), 'utf8')).toBe('ran');
        expect(commitReceipt.after.head).toBe(git('rev-parse', 'HEAD'));
        expect(commitReceipt.exit.code).toBe(0);
        expect(commitReceipt.before.sources['song.txt'].sha256).not.toBe(
            commitReceipt.after.sources['song.txt'].sha256
        );
        expect(commitReceipt.syscallPath).toContain('unavailable');
        expect(JSON.stringify(commitReceipt)).not.toContain('test: checkpoint');
    });
    it('hashes symlink text while retaining the index byte digest', async () => {
        const { root, env } = fixture();
        writeFileSync(join(root, 'target.txt'), 'target bytes differ from link text');
        symlinkSync('target.txt', join(root, 'link.txt'));
        const result = await run(root, env, 'add', '--', 'link.txt');
        expect(result.code).toBe(0);
        const observed = receipt(result.stderr).value;
        const linkDigest = createHash('sha256').update('target.txt').digest('hex');
        const targetDigest = createHash('sha256').update('target bytes differ from link text').digest('hex');
        expect(observed.before.sources['link.txt'].sha256).toBe(linkDigest);
        expect(observed.before.sources['link.txt'].kind).toBe('symlink');
        expect(observed.before.sources['link.txt'].sha256).not.toBe(targetDigest);
        expect(observed.after.index.sha256).toBe(
            createHash('sha256')
                .update(readFileSync(join(root, '.git', 'index')))
                .digest('hex')
        );
    });
    it('records source filenames that are object prototype keys', async () => {
        const { root, env } = fixture();
        writeFileSync(join(root, '__proto__'), 'source');
        const result = await run(root, env, 'add', '--', '__proto__');
        expect(result.code).toBe(0);
        const observed = receipt(result.stderr).value;
        expect(Object.hasOwn(observed.before.sources, '__proto__')).toBe(true);
        expect(observed.before.sources['__proto__'].sha256).toMatch(/^[a-f0-9]{64}$/);
    });
    it('retains the first failed command stderr and status without retrying', async () => {
        const { root, env, git } = fixture();
        const objectsBefore = readdirSync(join(root, '.git', 'objects')).sort();
        const result = await run(root, env, 'add', '--', 'missing-file');
        expect(result.code).not.toBe(0);
        const observed = receipt(result.stderr).value;
        expect(Buffer.from(observed.stderr.base64, 'base64').toString()).toContain("pathspec 'missing-file'");
        expect(observed.exit.code).toBe(result.code);
        expect(observed.attempts).toBe(1);
        expect(observed.before.head).toBe(observed.after.head);
        expect(observed.before.index).toEqual(observed.after.index);
        expect(readdirSync(join(root, '.git', 'objects')).sort()).toEqual(objectsBefore);
        expect(git('status', '--porcelain')).toBe('');
    });
    it('keeps the original Git failure when the receipt directory disappears during its hook', async () => {
        const { root, env, git } = fixture();
        writeFileSync(join(root, 'song.txt'), 'first');
        git('add', '--', 'song.txt');
        writeFileSync(
            join(root, '.git', 'hooks', 'commit-msg'),
            `#!/bin/sh
printf x >> hook-count
node -e 'require("node:fs").rmSync(process.env.SOURDAW_CHECKPOINT_DIR, { recursive: true, force: true })'
printf 'hook failure marker\n' >&2
exit 23
`,
            { mode: 0o755 }
        );
        const result = await run(root, env, 'commit', '-m', 'test: checkpoint');
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('hook failure marker');
        expect(result.stderr).not.toContain('node:internal');
        expect(result.stderr).not.toContain('Error: ENOENT');
        expect(readFileSync(join(root, 'hook-count'), 'utf8')).toBe('x');
        expect(git('status', '--porcelain')).toContain('A  song.txt');
    });
    it('records a signal and returns its conventional exit code', async () => {
        const { root, env } = fixture();
        const bin = join(root, 'bin');
        mkdirSync(bin);
        writeFileSync(
            join(bin, 'git'),
            '#!/bin/sh\nif [ "$1" = add ]; then kill -TERM $$; fi\nexec /usr/bin/git "$@"\n',
            { mode: 0o755 }
        );
        const result = await run(root, { ...env, PATH: `${bin}:${env.PATH}` }, 'add', '--', 'song.txt');
        expect(result.code).toBe(143);
        expect(receipt(result.stderr).value.exit.signal).toBe('SIGTERM');
    });
    it('skips sampling when the recorded writer identity does not match', () => {
        const result = spawnSync(
            process.execPath,
            [runner, '--sample', String(process.pid), 'different identity', JSON.stringify('')],
            { encoding: 'utf8' }
        );
        expect(result.status).toBe(0);
        const observation = JSON.parse(result.stdout);
        expect(observation.identityMatches).toBe(false);
        expect(observation.sample).toBeNull();
        const absent = spawnSync(
            process.execPath,
            [runner, '--sample', '99999999', 'different identity', JSON.stringify('')],
            { encoding: 'utf8' }
        );
        expect(JSON.parse(absent.stdout).sample).toBeNull();
    });
    it('selects mount options only for the exact filesystem and mountpoint reported by df', () => {
        const df = 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s1 1000 100 900 10% /work';
        const target = '/dev/disk3s1 on /work (apfs, local, read-only)';
        const mounts = `/dev/disk3s10 on /other (apfs, local)\n${target}`;
        expect(checkpointMountOptions(df, mounts)).toBe(target);
        expect(checkpointMountOptions(df, '/dev/disk3s10 on /other (apfs, local)')).toBeNull();
        expect(checkpointMountOptions(null, mounts)).toBeNull();
        const spacedDf =
            'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s1 1000 100 900 10% /Volumes/Audio Work';
        const otherMount = '/dev/disk3s1 on /work (apfs, local, read-only)';
        const spacedMount = '/dev/disk3s1 on /Volumes/Audio Work (apfs, local, read-write)';
        expect(checkpointMountOptions(spacedDf, `${otherMount}\n${spacedMount}`)).toBe(spacedMount);
        expect(checkpointMountOptions(spacedDf, otherMount)).toBeNull();
        expect(checkpointMountOptions('unparseable', mounts)).toBeNull();
        const macDf =
            'Filesystem 512-blocks Used Available Capacity Mounted on\n/dev/disk8s1 1953514584 819215496 1133894448 42% /Volumes/Development';
        const macMount = '/dev/disk8s1 on /Volumes/Development (apfs, local, nodev, nosuid, journaled, noowners)';
        expect(checkpointMountOptions(macDf, macMount)).toBe(macMount);
    });
    it('selects only the named socket and the exact connected writer pair', () => {
        const header = 'Address Type Recv-Q Send-Q Inode Conn Refs Nextref rxbytes txbytes rhiwat shiwat process:pid';
        const peer = 'abc stream 2 3 0 def 0 0 10 20 100 100 git-ai:222 /tmp/trace.sock';
        const writer = 'def stream 4 5 0 abc 0 0 20 10 100 100 git:123';
        const unrelated = 'xxx stream 0 0 0 yyy 0 0 0 0 100 100 git:999 /tmp/private';
        expect(checkpointSocketRows([header, peer, writer, unrelated].join('\n'), '/tmp/trace.sock', 123)).toEqual([
            header,
            peer,
            writer,
        ]);
        expect(checkpointSocketRows([header, peer, writer].join('\n'), '/tmp/other.sock', 123)).toBeNull();
        expect(
            checkpointSocketRows(
                [header, peer.replace('/tmp/trace.sock', '/other/tmp/trace.sock'), writer].join('\n'),
                '/tmp/trace.sock',
                123
            )
        ).toBeNull();
        expect(checkpointSocketRows([header, peer, writer].join('\n'), '/tmp/trace.sock', 999)).toBeNull();
    });
    it('records a stalled writer against an owned Trace2 stream that stops draining', async () => {
        const { root, env, receiptRoot } = fixture();
        const socketRoot = mkdtempSync('/tmp/checkpoint-sock-');
        roots.push(socketRoot);
        const socket = join(socketRoot, 'trace.sock');
        const connections: import('node:net').Socket[] = [];
        const server = createServer((connection) => {
            connections.push(connection);
            connection.pause();
        });
        await new Promise<void>((resolveListen, reject) => {
            server.on('error', reject);
            server.listen(socket, resolveListen);
        });
        const name = 's'.repeat(100);
        writeFileSync(join(root, name), 'content');
        const child = spawn(process.execPath, [runner, 'add', '--', ...Array(1500).fill(name)], {
            cwd: root,
            env: { ...env, GIT_TRACE2_EVENT: `af_unix:stream:${socket}` },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout.resume();
        let gitStderr = '';
        child.stderr.on('data', (chunk) => {
            gitStderr += chunk.toString();
        });
        try {
            await vi.waitFor(
                () => {
                    const dirs = readdirSync(receiptRoot);
                    expect(dirs).toHaveLength(1);
                    const data = JSON.parse(readFileSync(join(receiptRoot, dirs[0], 'receipt.json'), 'utf8'));
                    expect(data.pid).toBeGreaterThan(0);
                    expect(connections.length, gitStderr).toBeGreaterThan(0);
                    expect(child.exitCode, gitStderr).toBeNull();
                    expect(data.stall).toBeDefined();
                    expect(data.stall.sample).not.toBe('observation pending');
                },
                { timeout: 20000, interval: 50 }
            );
            server.close();
            // Drain the exact connection only after observing the blocked writer.
            for (const connection of connections) connection.resume();
            const code = await new Promise<number | null>((resolveClose) => child.on('close', resolveClose));
            expect(code).toBe(0);
        } finally {
            for (const connection of connections) connection.destroy();
            server.close();
            if (child.exitCode === null) {
                child.kill();
            }
        }
    }, 30000);
});
