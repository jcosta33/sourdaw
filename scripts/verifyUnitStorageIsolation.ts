import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseLinuxFileSnapshot, storageFileState } from './resourceGuard.ts';
import { createGuardStorage } from './resourceGuardStorage.ts';

async function waitUntil(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (!predicate()) {
        assert(Date.now() <= deadline, 'native unit storage proof timed out');
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}

// This mandatory pre-install probe runs before any Vitest workers. A denied
// same-UID consumer would poison other guards' complete file census concurrently.
async function verify(): Promise<void> {
    assert.equal(process.platform, 'linux');
    const uid = process.getuid?.();
    assert(uid !== undefined && uid > 0, 'native unit storage proof must be unprivileged');
    const root = mkdtempSync(join(tmpdir(), 'unit-file-proof-'));
    const reasons: string[] = [];
    const storage = createGuardStorage({
        root: join(root, 'storage'),
        token: randomUUID(),
        owner: { pid: process.pid, startedAt: 'unit-file-proof' },
        ports: {
            identityState: () => 'dead',
            sessionState: (_owner, original, current = original) =>
                storageFileState([original, current], [], (reason) => reasons.push(reason)),
        },
    });
    const program = [
        'import ctypes, os, sys',
        'temp = sys.stdin.readline().rstrip("\\n")',
        'os.chdir(temp)',
        'fd = os.open("held", os.O_CREAT | os.O_WRONLY, 0o600)',
        'os.write(fd, b"live nondumpable consumer")',
        'assert ctypes.CDLL(None, use_errno=True).prctl(4, 0, 0, 0, 0) == 0',
        'print(os.getpid(), flush=True)',
        'sys.stdin.readline()',
    ].join('\n');
    const child = spawn('python3', ['-c', program], {
        cwd: process.cwd(),
        env: { PATH: process.env.PATH },
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    let startupError: Error | undefined;
    let closed = false;
    let output = '';
    child.on('error', (error) => {
        startupError = error;
    });
    child.on('close', () => {
        closed = true;
    });
    child.stdin.on('error', () => {});
    child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
    });
    child.stderr.resume();
    try {
        child.stdin.write(`${storage.tempDirectory}\n`);
        await waitUntil(() => {
            if (startupError !== undefined) {
                throw startupError;
            }
            assert(output.length < 1024, 'native unit storage proof output exceeded its bound');
            assert(!closed, 'Python storage consumer exited before admission');
            return /^\d+\n$/.test(output);
        });
        assert.equal(Number(output.trim()), child.pid);
        assert(child.pid !== undefined);
        const snapshot = parseLinuxFileSnapshot(readFileSync(`/proc/${child.pid}/status`, 'utf8'));
        assert(snapshot !== undefined);
        assert.deepEqual(snapshot.uids, [uid, uid, uid, uid]);
        assert.equal(snapshot.pid, child.pid);
        assert.equal(snapshot.tgid, child.pid);
        assert.notEqual(snapshot.state, 'Z');
        assert.throws(() => readlinkSync(`/proc/${child.pid}/cwd`), { code: 'EACCES' });
        assert.equal(await storage.release(true), false, 'uninspectable same-UID storage must be retained');
        assert(existsSync(storage.tempDirectory));
        assert(existsSync(join(storage.tempDirectory, 'held')));
        assert(
            reasons.some((reason) => reason.includes(`pid=${child.pid}:phase=cwd:error=EACCES`)),
            'production file proof must observe denied cwd'
        );
    } finally {
        if (!closed) {
            child.kill('SIGKILL');
        }
        await waitUntil(() => closed);
        assert.equal(await storage.release(true), true, 'native storage must reclaim after child reaping');
        assert(!existsSync(storage.tempDirectory));
        rmSync(root, { recursive: true });
    }
    console.info(`unit storage isolation proved: uid=${uid} denied-same-uid=retained reaped-same-uid=reclaimed`);
}

await verify();
