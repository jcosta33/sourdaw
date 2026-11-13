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
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkpointArguments } from '../gitCheckpointArguments';
import { checkpointMountOptions } from '../gitCheckpointMount';
import { checkpointSamplePayload, runCheckpointSample } from '../gitCheckpointProcess';
import { checkpointSocketRows } from '../gitCheckpointSocket';

const runner = resolve('scripts/gitCheckpoint.ts');
const roots: string[] = [];
function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'checkpoint-'));
    roots.push(root);
    const receiptRoot = mkdtempSync(join(tmpdir(), 'checkpoint-receipts-'));
    roots.push(receiptRoot);
    const env: NodeJS.ProcessEnv = {
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
        expect(commitReceipt.startedAtUtc).toMatch(/^\d{4}-/);
        expect(commitReceipt.writerExitedAtUtc).toMatch(/^\d{4}-/);
        expect(commitReceipt.cwd).toBe(root);
        expect(commitReceipt.runtime.node).toBe(process.version);
        expect(commitReceipt.before.gitVersion).toMatch(/^git version /);
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
    it('rejects malformed private observer request data', () => {
        for (const input of ['{', '[]', JSON.stringify({ paths: [1], discover: true, includeIgnored: false })]) {
            const result = spawnSync(process.execPath, [runner, '--observe', '/tmp/unwritten'], {
                encoding: 'utf8',
                input,
            });
            expect(result.status).toBe(2);
            expect(result.stderr).toContain('invalid observer arguments');
            expect(result.stderr).not.toContain('node:internal');
        }
    });
    it('records dangling symlink text without opening its missing target', async () => {
        const { root, env } = fixture();
        symlinkSync('missing-target', join(root, 'dangling'));
        const result = await run(root, env, 'add', '--', 'dangling');
        expect(result.code).toBe(0);
        const source = receipt(result.stderr).value.before.sources.dangling;
        expect(source.kind).toBe('symlink');
        expect(source.sha256).toBe(createHash('sha256').update('missing-target').digest('hex'));
    });
    it('rejects malformed observer arguments without an internal stack', () => {
        for (const args of [
            ['--observe'],
            ['--observe', '/tmp/unwritten'],
            ['--sample'],
            ['--sample', '0', '', JSON.stringify('')],
            ['--sample', '1', '', '{'],
            ['--sample', '1', '', '42'],
        ]) {
            const result = spawnSync(process.execPath, [runner, ...args], { encoding: 'utf8' });
            expect(result.status).toBe(2);
            expect(result.stderr).toContain('invalid');
            expect(result.stderr).not.toContain('node:internal');
        }
    });
    it('captures files selected by a directory pathspec before staging', async () => {
        const { root, env, git } = fixture();
        mkdirSync(join(root, 'takes'));
        writeFileSync(join(root, 'takes', 'note.txt'), 'recorded take');
        const result = await run(root, env, 'add', '--', 'takes');
        expect(result.code, result.stderr).toBe(0);
        const observed = receipt(result.stderr).value;
        expect(observed.before.sources['takes/note.txt']?.sha256).toBe(
            createHash('sha256').update('recorded take').digest('hex')
        );
        expect(git('ls-files', '--error-unmatch', 'takes/note.txt')).toBe('takes/note.txt');
    });
    it.each([
        ['add all', ['add', '-A'], true],
        ['add long all', ['add', '--all'], true],
        ['add update', ['add', '-u'], false],
        ['add long update', ['add', '--update'], false],
        ['commit all', ['commit', '-am', 'test: update'], false],
        ['commit long flags', ['commit', '-a', '-m', 'test: update'], false],
        ['commit path', ['commit', '-m', 'test: update', '--', 'tracked.txt'], false],
    ])('records unstaged source before %s', async (_label, args, includesUntracked) => {
        const { root, env, git } = fixture();
        writeFileSync(join(root, 'tracked.txt'), 'old');
        git('add', '--', 'tracked.txt');
        git('commit', '-qm', 'test: baseline');
        writeFileSync(join(root, 'tracked.txt'), 'new source');
        writeFileSync(join(root, 'untracked.txt'), 'new file');
        const result = await run(root, env, ...args);
        expect(result.code, result.stderr).toBe(0);
        const observed = receipt(result.stderr).value;
        expect(observed.before.sources['tracked.txt']?.sha256).toBe(
            createHash('sha256').update('new source').digest('hex')
        );
        expect(observed.before.sourceSelection.mode).toBe('conservative');
        expect(observed.before.sourceSelection.candidateDiscovery.tracked).toBe('complete');
        if (includesUntracked) {
            expect(observed.before.sources['untracked.txt']?.sha256).toBe(
                createHash('sha256').update('new file').digest('hex')
            );
        } else {
            expect(Object.hasOwn(observed.before.sources, 'untracked.txt')).toBe(false);
        }
        expect(git('show', ':tracked.txt')).toBe('new source');
    });
    it.each([
        ['add all', ['add', '-A'], true],
        ['add update', ['add', '-u'], false],
        ['commit all', ['commit', '-am', 'test: update'], false],
    ])('records worktree-wide sources from a subdirectory before %s', async (_label, args, includesUntracked) => {
        const { root, env, git } = fixture();
        mkdirSync(join(root, 'subdir'));
        writeFileSync(join(root, 'outside.txt'), 'old outside');
        writeFileSync(join(root, 'subdir', 'outside.txt'), 'different inside');
        git('add', '--', 'outside.txt', 'subdir/outside.txt');
        git('commit', '-qm', 'test: baseline');
        git('config', 'diff.relative', 'true');
        writeFileSync(join(root, 'outside.txt'), 'new outside');
        writeFileSync(join(root, 'untracked-outside.txt'), 'new untracked outside');
        const result = await run(join(root, 'subdir'), env, ...args);
        expect(result.code, result.stderr).toBe(0);
        const observed = receipt(result.stderr).value;
        expect(observed.before.sources['../outside.txt']?.sha256).toBe(
            createHash('sha256').update('new outside').digest('hex')
        );
        expect(git('show', ':outside.txt')).toBe('new outside');
        if (includesUntracked) {
            expect(observed.before.sources['../untracked-outside.txt']?.sha256).toBe(
                createHash('sha256').update('new untracked outside').digest('hex')
            );
            expect(git('ls-files', '--error-unmatch', 'untracked-outside.txt')).toBe('untracked-outside.txt');
        }
    });
    it.each([
        ['short all', ['add', '-A', '--'], true],
        ['long all', ['add', '--all', '--'], true],
        ['short update', ['add', '-u', '--'], false],
        ['long update', ['add', '--update', '--'], false],
    ])('captures root files for empty terminator %s from a subdirectory', async (_label, args, includesUntracked) => {
        const { root, env, git } = fixture();
        mkdirSync(join(root, 'subdir'));
        writeFileSync(join(root, 'outside.txt'), 'old');
        git('add', '--', 'outside.txt');
        git('commit', '-qm', 'test: baseline');
        writeFileSync(join(root, 'outside.txt'), 'updated outside');
        writeFileSync(join(root, 'untracked.txt'), 'new outside');
        const result = await run(join(root, 'subdir'), env, ...args);
        expect(result.code, result.stderr).toBe(0);
        expect(git('show', ':outside.txt')).toBe('updated outside');
        if (includesUntracked) {
            expect(git('show', ':untracked.txt')).toBe('new outside');
        } else {
            expect(git('ls-files', '--', 'untracked.txt')).toBe('');
        }
        const observed = receipt(result.stderr).value;
        expect(observed.before.sourceSelection.mode).toBe('conservative');
        expect(observed.before.sources['../outside.txt']?.sha256).toBe(
            createHash('sha256').update('updated outside').digest('hex')
        );
        if (includesUntracked) {
            expect(observed.before.sources['../untracked.txt']?.sha256).toBe(
                createHash('sha256').update('new outside').digest('hex')
            );
        }
    });
    it('normalizes staged and explicit root pathspecs from a subdirectory', async () => {
        const { root, env, git } = fixture();
        mkdirSync(join(root, 'subdir'));
        writeFileSync(join(root, 'outside.txt'), 'old outside');
        writeFileSync(join(root, 'subdir', 'outside.txt'), 'different inside');
        git('add', '--', 'outside.txt', 'subdir/outside.txt');
        git('commit', '-qm', 'test: baseline');
        git('config', 'diff.relative', 'true');
        writeFileSync(join(root, 'outside.txt'), 'staged outside');
        git('add', '--', 'outside.txt');
        writeFileSync(join(root, 'outside.txt'), 'latest outside');
        const result = await run(join(root, 'subdir'), env, 'add', '--', ':/outside.txt');
        expect(result.code, result.stderr).toBe(0);
        const observed = receipt(result.stderr).value;
        expect(observed.before.sources['../outside.txt']?.sha256).toBe(
            createHash('sha256').update('latest outside').digest('hex')
        );
        expect(observed.before.sourceSelection.pathspecDiscovery).toBe('complete');
        expect(git('show', ':outside.txt')).toBe('latest outside');
        writeFileSync(join(root, 'new-root.txt'), 'new root source');
        const added = await run(join(root, 'subdir'), env, 'add', '--', ':/new-root.txt');
        expect(added.code, added.stderr).toBe(0);
        expect(receipt(added.stderr).value.before.sources['../new-root.txt']?.sha256).toBe(
            createHash('sha256').update('new root source').digest('hex')
        );
        expect(git('show', ':new-root.txt')).toBe('new root source');
    });
    it('preserves leading whitespace in selected source filenames', async () => {
        const { root, env } = fixture();
        const name = ' leading take.txt';
        writeFileSync(join(root, name), 'leading filename');
        const result = await run(root, env, 'add', '--', name);
        expect(result.code, result.stderr).toBe(0);
        const observed = receipt(result.stderr).value;
        expect(observed.before.sources[name]?.sha256).toBe(
            createHash('sha256').update('leading filename').digest('hex')
        );
    });
    it('respects update and force when discovering files selected by Git', async () => {
        const { root, env, git } = fixture();
        mkdirSync(join(root, 'takes'));
        writeFileSync(join(root, '.gitignore'), '*.tmp\n');
        writeFileSync(join(root, 'takes', 'tracked.wav'), 'before');
        git('add', '--', '.gitignore', 'takes/tracked.wav');
        git('commit', '-qm', 'test: baseline');
        writeFileSync(join(root, 'takes', 'tracked.wav'), 'after');
        writeFileSync(join(root, 'takes', 'untracked.wav'), 'untracked');
        writeFileSync(join(root, 'takes', 'ignored.tmp'), 'ignored');
        const updated = await run(root, env, 'add', '-u', '--', 'takes');
        expect(updated.code, updated.stderr).toBe(0);
        const updatedSources = receipt(updated.stderr).value.before.sources;
        expect(updatedSources['takes/tracked.wav'].sha256).toBe(createHash('sha256').update('after').digest('hex'));
        expect(Object.hasOwn(updatedSources, 'takes/untracked.wav')).toBe(false);
        const forced = await run(root, env, 'add', '-f', '--', 'takes/ignored.tmp');
        expect(forced.code, forced.stderr).toBe(0);
        expect(receipt(forced.stderr).value.before.sources['takes/ignored.tmp'].sha256).toBe(
            createHash('sha256').update('ignored').digest('hex')
        );
        writeFileSync(join(root, 'takes', 'combined.tmp'), 'combined force');
        const combined = await run(root, env, 'add', '-fv', '--', 'takes/combined.tmp');
        expect(combined.code, combined.stderr).toBe(0);
        expect(receipt(combined.stderr).value.before.sources['takes/combined.tmp'].sha256).toBe(
            createHash('sha256').update('combined force').digest('hex')
        );
    });
    it('preserves legal large Git path arguments through checkpoint observation', async () => {
        const { root, env } = fixture();
        const name = '"'.repeat(100);
        writeFileSync(join(root, name), 'content');
        const paths = Array<string>(1500).fill(name);
        const direct = spawnSync('git', ['add', '--', ...paths], { cwd: root, env, encoding: 'utf8' });
        expect(direct.error, direct.stderr).toBeUndefined();
        expect(direct.status, direct.stderr).toBe(0);
        const result = await run(root, env, 'add', '--', ...paths);
        expect(result.code, result.stderr).toBe(0);
        const observed = receipt(result.stderr).value;
        expect(observed.before.sources[name].sha256).toBe(createHash('sha256').update('content').digest('hex'));
    });
    it('records source filenames that are object prototype keys', async () => {
        const { root, env } = fixture();
        writeFileSync(join(root, '__proto__'), 'source');
        const result = await run(root, env, 'add', '--', '__proto__');
        expect(result.code).toBe(0);
        const observed = receipt(result.stderr).value;
        expect(Object.hasOwn(observed.before.sources, '__proto__')).toBe(true);
        expect(observed.before.sources.__proto__.sha256).toMatch(/^[a-f0-9]{64}$/);
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
    it('summarizes flags and pathspecs without commit messages', () => {
        const result = checkpointArguments([
            'commit',
            '-m',
            'private commit subject',
            '--author=Test User',
            '--',
            'takes/one.wav',
        ]);
        expect(result.arguments).toEqual(['-m', '[redacted]', '--author=Test User', '--', 'takes/one.wav']);
        expect(result.omitted).toBe(1);
        expect(JSON.stringify(result)).not.toContain('private commit subject');
        expect(checkpointArguments(['commit', '-mhello']).arguments).toEqual(['-m[redacted]']);
        expect(checkpointArguments(['commit', '--message=hello']).arguments).toEqual(['--message=[redacted]']);
        const capped = checkpointArguments(['add', '--', 'x'.repeat(513), ...Array<string>(130).fill('ok')]);
        expect(capped.arguments.length).toBeLessThanOrEqual(128);
        expect(capped.omitted).toBeGreaterThan(0);
    });
    it('returns generic observations without GitAI metadata when writer identity is missing', () => {
        const observation = runCheckpointSample(process.pid, null, '', undefined);
        expect(observation.identityMatches).toBe(false);
        expect(observation.queueSnapshots).toHaveLength(2);
        expect(observation.sample).toBeNull();
        expect(observation.socketHolderIdentities).toEqual([]);
        expect(observation).not.toHaveProperty('daemonLog');
        expect(observation).not.toHaveProperty('receiver');
    });
    it('bounds writer sample payloads and reports omitted bytes', () => {
        const stack = checkpointSamplePayload('a'.repeat(70000));
        expect(stack.sampleOmittedBytes).toBe(4464);
        expect(stack.sample).not.toBeNull();
        expect(Buffer.from(stack.sample ?? '', 'base64')).toHaveLength(65536);
        expect(checkpointSamplePayload(null)).toEqual({
            sample: null,
            sampleEncoding: 'base64',
            sampleOmittedBytes: null,
        });
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
        const peer = 'abc stream 2 3 0 def 0 0 10 20 100 100 receiver:222 /tmp/trace.sock';
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
        await new Promise<void>((resolve, reject) => {
            server.on('error', reject);
            server.listen(socket, resolve);
        });
        const name = 's'.repeat(100);
        writeFileSync(join(root, name), 'content');
        // Linux Unix-stream buffers can be larger, so exercise real backpressure with a larger argv.
        const pathCount = process.platform === 'linux' ? 5000 : 1500;
        const child = spawn(process.execPath, [runner, 'add', '--', ...Array(pathCount).fill(name)], {
            cwd: root,
            env: { ...env, GIT_TRACE2_EVENT: `af_unix:stream:${socket}` },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout.resume();
        const stderrBytes: Buffer[] = [];
        let stderrSize = 0;
        let stderrOmitted = 0;
        let drainReleased = false;
        child.stderr.on('data', (chunk: Buffer) => {
            const keep = Math.min(chunk.length, 16384 - stderrSize);
            if (keep > 0) {
                stderrBytes.push(chunk.subarray(0, keep));
            }
            stderrSize += keep;
            stderrOmitted += chunk.length - keep;
        });
        const stderrText = () => Buffer.concat(stderrBytes).toString('utf8');
        try {
            const exitedEarly = new Promise<never>((_resolve, reject) => {
                let reported = false;
                const fail = (detail: string) => {
                    if (drainReleased || reported) {
                        return;
                    }
                    reported = true;
                    const message = `checkpoint exited before drain: ${detail}; platform=${process.platform}; pathCount=${pathCount}; connections=${connections.length}; stderr omitted bytes=${stderrOmitted}; stderr=${stderrText()}`;
                    console.error(message);
                    reject(new Error(message));
                };
                child.once('error', (error) => {
                    const text = error.message.slice(0, 2048);
                    fail(
                        `spawn error: ${text}; message omitted characters=${Math.max(0, error.message.length - text.length)}`
                    );
                });
                child.once('close', (code, signal) => fail(`code=${code} signal=${signal}`));
            });
            await Promise.race([
                exitedEarly,
                vi.waitFor(
                    () => {
                        expect(child.exitCode, stderrText()).toBeNull();
                        const dirs = readdirSync(receiptRoot);
                        expect(dirs).toHaveLength(1);
                        const directory = dirs[0];
                        if (directory === undefined) {
                            throw new Error('missing checkpoint receipt directory');
                        }
                        const data = JSON.parse(readFileSync(join(receiptRoot, directory, 'receipt.json'), 'utf8'));
                        expect(data.pid).toBeGreaterThan(0);
                        expect(connections.length, stderrText()).toBeGreaterThan(0);
                        expect(child.exitCode, stderrText()).toBeNull();
                        expect(data.stall).toBeDefined();
                        expect(data.stall.sample).not.toBe('observation pending');
                        expect(data.stall.queueSnapshots).toHaveLength(2);
                        expect(
                            BigInt(data.stall.queueSnapshots[1].monotonicNs) >=
                                BigInt(data.stall.queueSnapshots[0].monotonicNs)
                        ).toBe(true);
                    },
                    { timeout: 20000, interval: 50 }
                ),
            ]);
            drainReleased = true;
            server.close();
            // Drain the exact connection only after observing the blocked writer.
            for (const connection of connections) {
                connection.resume();
            }
            const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
            expect(code).toBe(0);
        } finally {
            drainReleased = true;
            for (const connection of connections) {
                connection.destroy();
            }
            server.close();
            if (child.exitCode === null) {
                child.kill();
            }
        }
    }, 30000);
});
