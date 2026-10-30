import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import {
    closeSync,
    existsSync,
    fstatSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { ownedGuardReceipt, readCleanupFile } from '../cleanupLaneBookkeeping.ts';
import {
    authenticateCleanup,
    cleanupBackoff,
    cleanupLanes,
    readCleanupRecords,
    withCleanupLock,
    type CleanupPort,
} from '../cleanupLanes.ts';
import {
    AUTHOR_BOT_NODE_ID,
    AUTHOR_LOCK_REASON,
    githubAuthorizationGitEnv,
    type authenticateRole,
} from '../githubAppIdentity.ts';
import { laneIsActive } from '../laneActivity.ts';
import { guardFailureReceiptPath, type GuardFailureReceipt } from '../prContract.ts';
import { shellPort, type PullRequest, type ShellRunner } from '../removeLane.ts';
import { writeGuardFailureReceipt } from '../resourceGuard.ts';
import * as resourceGuard from '../resourceGuard.ts';

function fixture() {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'sourdaw-cleanup-')));
    const env = githubAuthorizationGitEnv();
    const git = (args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env }).trim();
    git(['init', '-b', 'main']);
    git(['config', 'user.name', 'Fixture']);
    git(['config', 'user.email', 'fixture@example.com']);
    writeFileSync(join(root, '.gitignore'), '.agents/\n.env\nnode_modules/\n');
    writeFileSync(join(root, 'tracked'), 'original');
    git(['add', '.']);
    git(['commit', '-m', 'fixture']);
    const lane = join(root, '.agents/worktrees/author');
    git(['worktree', 'add', '-b', 'fix/fixture', lane]);
    git(['worktree', 'lock', '--reason', AUTHOR_LOCK_REASON, lane]);
    const head = git(['rev-parse', 'HEAD']);
    const pr: PullRequest = {
        number: 42,
        headRefName: 'fix/fixture',
        headRefOid: head,
        headRepository: 'jcosta33/sourdaw',
        baseRefName: 'main',
        state: 'MERGED',
        isDraft: false,
        mergedAt: '2026-10-28T00:00:00Z',
    };
    const shell: ShellRunner = {
        capture: (command, args, options) => {
            const output = execFileSync(command, args, {
                cwd: root,
                env: options?.processClock === 'utc' ? { ...env, LC_ALL: 'C', TZ: 'UTC' } : env,
                encoding: 'utf8',
                maxBuffer: 64 * 1024 * 1024,
            });
            return options?.preserveStdout ? output : output.trim();
        },
        run: (command, args) => {
            execFileSync(command, args, { cwd: root, env });
        },
    };
    const native = shellPort(shell, root);
    let now = 1_000;
    const port: CleanupPort = {
        primaryRoot: root,
        now: () => now,
        serialize: (operation) => withCleanupLock(root, shell, operation),
        log: () => {},
        removal: {
            ...native,
            repository: () => 'jcosta33/sourdaw',
            fetch: () => {},
            pullRequests: () => [pr],
            commitPullRequests: () => [pr],
            currentDirectory: () => root,
            active: () => false,
            remoteHead: () => undefined,
        },
    };
    return {
        root,
        lane,
        head,
        pr,
        git,
        shell,
        port,
        advance: () => {
            now += 100_000_000;
        },
        dispose: () => rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }),
    };
}

function guardReceipt(head: string, failedAt = '2026-10-28T00:00:00Z'): GuardFailureReceipt {
    return {
        version: 1,
        lane: 'author',
        branch: 'fix/fixture',
        headSha: head,
        failedAt,
        reason: 'memory',
        command: 'pnpm',
        args: ['test:run', 'fixture.spec.ts'],
        profile: 'focused',
        peakRssBytes: 10,
        maxRssBytes: 5,
        durationMs: 100,
    };
}

const cleanupLockRef = 'refs/sourdaw/lane-cleanup/lock';

function installLock(root: string, owner: unknown): string {
    const oid = execFileSync('git', ['-C', root, 'hash-object', '-w', '--stdin'], {
        input: JSON.stringify(owner),
        encoding: 'utf8',
        env: githubAuthorizationGitEnv(),
    }).trim();
    execFileSync('git', ['-C', root, 'update-ref', cleanupLockRef, oid], { env: githubAuthorizationGitEnv() });
    return oid;
}

describe('automatic lane cleanup', () => {
    it('preserves raw bytes and original receipt fingerprints, and distinguishes absent files', () => {
        const f = fixture();
        try {
            const missing = join(f.root, 'missing-file');
            expect(readCleanupFile(missing)).toBeUndefined();
            expect(readCleanupRecords(f.root)).toEqual([]);
            expect(
                ownedGuardReceipt(f.root, {
                    path: f.lane,
                    head: f.head,
                    branch: 'fix/fixture',
                    detached: false,
                    directory: { dev: 0, ino: 0, birthtimeMs: 0 },
                })
            ).toBeNull();
            const bytes = Buffer.from([0xff, 0, 0x41]);
            writeFileSync(missing, bytes);
            expect(readCleanupFile(missing)?.bytes).toEqual(bytes);
            writeGuardFailureReceipt(f.root, guardReceipt(f.head));
            const descriptor = openSync(guardFailureReceiptPath(f.root, 'author'), 'r');
            try {
                const stat = fstatSync(descriptor);
                expect(
                    ownedGuardReceipt(f.root, {
                        path: f.lane,
                        head: f.head,
                        branch: 'fix/fixture',
                        detached: false,
                        directory: { dev: 0, ino: 0, birthtimeMs: 0 },
                    })
                ).toEqual({
                    hash: createHash('sha256').update(readFileSync(descriptor)).digest('hex'),
                    dev: stat.dev,
                    ino: stat.ino,
                    birthtimeMs: stat.birthtimeMs,
                });
            } finally {
                closeSync(descriptor);
            }
        } finally {
            f.dispose();
        }
    });

    it.each(['directory', 'fifo', 'symlink', 'dangling symlink', 'symlink parent', 'dangling parent', 'read failure'])(
        'refuses %s promptly and closes every opened descriptor',
        (kind) => {
            const f = fixture();
            try {
                let path = join(f.root, 'read-target');
                if (kind === 'directory') {
                    mkdirSync(path);
                } else if (kind === 'fifo') {
                    execFileSync('mkfifo', [path], { env: githubAuthorizationGitEnv() });
                } else if (kind.endsWith('symlink')) {
                    const target = join(f.root, 'target');
                    if (kind === 'symlink') {
                        writeFileSync(target, 'unrelated bytes');
                    }
                    symlinkSync(target, path);
                } else if (kind.endsWith('parent')) {
                    const target = join(f.root, 'real-parent');
                    if (kind === 'symlink parent') {
                        mkdirSync(target);
                    }
                    symlinkSync(target, path, 'dir');
                    path = join(path, 'receipt');
                    if (kind === 'symlink parent') {
                        writeFileSync(path, 'unrelated parent bytes');
                    }
                } else {
                    writeFileSync(path, 'keep bytes');
                }
                const program = `
                    import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
                    const path=${JSON.stringify(path)},kind=${JSON.stringify(kind)};
                    const open=fs.openSync,close=fs.closeSync,read=fs.readFileSync;
                    const opened=[],closed=new Set();
                    fs.openSync=(file,...args)=>{const fd=open(file,...args);if(file===path)opened.push(fd);return fd;};
                    fs.closeSync=(fd)=>{closed.add(fd);return close(fd);};
                    fs.readFileSync=(file,...args)=>{if(kind==='read failure'&&opened.includes(file))throw Object.assign(new Error('read denied'),{code:'EACCES'});return read(file,...args);};
                    syncBuiltinESMExports();
                    const {readCleanupFile}=await import(${JSON.stringify(resolve('scripts/cleanupLaneBookkeeping.ts'))});
                    let error,code;try{readCleanupFile(path);}catch(caught){error=caught.message;code=caught.code;}
                    console.log(JSON.stringify({error,code,opened:opened.length,closed:opened.every(fd=>closed.has(fd))}));
                `;
                const result = JSON.parse(
                    execFileSync(process.execPath, ['--input-type=module', '-e', program], {
                        cwd: f.root,
                        encoding: 'utf8',
                        env: githubAuthorizationGitEnv(),
                        timeout: 5_000,
                    })
                );
                expect(result.error).toBeDefined();
                expect(result.closed).toBe(true);
                if (!kind.endsWith('symlink') && !kind.endsWith('parent')) {
                    expect(result.opened).toBeGreaterThan(0);
                }
                if (kind === 'read failure') {
                    expect(result.code).toBe('EACCES');
                }
            } finally {
                f.dispose();
            }
        }
    );

    it.each(['guard receipt', 'cleanup journal'])(
        'never reads a foreign payload swapped into a checked %s',
        (route) => {
            const f = fixture();
            const foreign = realpathSync(mkdtempSync(join(tmpdir(), 'sourdaw-read-swap-')));
            try {
                cleanupLanes(f.port, undefined, true);
                const record = readCleanupRecords(f.root)[0]!;
                writeGuardFailureReceipt(f.root, guardReceipt(f.head));
                const directory = join(f.root, '.agents/lane-cleanup');
                const name = readdirSync(directory).find((entry) => /^[a-f0-9]{64}\.json$/.test(entry))!;
                const victim =
                    route === 'guard receipt' ? guardFailureReceiptPath(f.root, 'author') : join(directory, name);
                const target = join(foreign, 'payload');
                let payload: Record<string, unknown>;
                if (route === 'guard receipt') {
                    payload = { ...guardReceipt(f.head), command: 'foreign payload' };
                } else {
                    payload = { ...record, reason: 'foreign payload' };
                }
                writeFileSync(target, JSON.stringify(payload));
                const program = `
                    import fs from 'node:fs';
                    import {syncBuiltinESMExports} from 'node:module';
                    const path=${JSON.stringify(victim)},target=${JSON.stringify(target)};
                    const read=fs.readFileSync,open=fs.openSync,close=fs.closeSync;
                    const opened=[],closed=new Set();let swapped=false,foreignRead=false,owned;
                    fs.openSync=(file,...args)=>{const fd=open(file,...args);if(file===path){owned=fd;opened.push(fd);}return fd;};
                    fs.closeSync=(fd)=>{closed.add(fd);return close(fd);};
                    fs.readFileSync=(file,...args)=>{
                        if((file===path||file===owned)&&!swapped){fs.renameSync(path,path+'.original');fs.symlinkSync(target,path);swapped=true;}
                        if(file===path&&swapped)foreignRead=true;
                        return read(file,...args);
                    };
                    syncBuiltinESMExports();
                    let error;
                    try{
                        if(${JSON.stringify(route)}==='guard receipt'){
                            const {ownedGuardReceipt}=await import(${JSON.stringify(resolve('scripts/cleanupLaneBookkeeping.ts'))});
                            ownedGuardReceipt(${JSON.stringify(f.root)},${JSON.stringify(record.identity)});
                        }else{
                            const {readCleanupRecords}=await import(${JSON.stringify(resolve('scripts/cleanupLanes.ts'))});
                            readCleanupRecords(${JSON.stringify(f.root)});
                        }
                    }catch(caught){error=caught.message;}
                    console.log(JSON.stringify({swapped,foreignRead,error,opened:opened.length,closed:opened.every(fd=>closed.has(fd))}));
                `;
                const result = JSON.parse(
                    execFileSync(process.execPath, ['--input-type=module', '-e', program], {
                        cwd: f.root,
                        encoding: 'utf8',
                        env: githubAuthorizationGitEnv(),
                    })
                );
                expect(result.swapped).toBe(true);
                expect(result.foreignRead).toBe(false);
                expect(result.error).toBeDefined();
                expect(result.opened).toBeGreaterThan(0);
                expect(result.closed).toBe(true);
                expect(JSON.parse(readFileSync(target, 'utf8'))).toMatchObject(
                    route === 'guard receipt' ? { command: 'foreign payload' } : { reason: 'foreign payload' }
                );
            } finally {
                f.dispose();
                rmSync(foreign, { recursive: true });
            }
        }
    );

    it('requests only read permissions under the author identity for cleanup', async () => {
        const requests: Array<Parameters<typeof authenticateRole>[0]> = [];
        const refused = new Error('stop before authentication');
        await expect(
            authenticateCleanup('/repo', async (input) => {
                requests.push(input);
                throw refused;
            })
        ).rejects.toBe(refused);
        expect(requests).toEqual([
            {
                primaryRoot: '/repo',
                role: 'author',
                permissions: {
                    contents: 'read',
                    pull_requests: 'read',
                    issues: 'read',
                },
            },
        ]);
    });
    it('removes a clean merged author and legacy detached review lane through native no-force Git', () => {
        const f = fixture();
        try {
            const review = join(f.root, '.agents/review-worktrees/review-42');
            f.git(['worktree', 'add', '--detach', review, f.head]);
            const outcomes = cleanupLanes(f.port);
            expect(outcomes.filter((outcome) => outcome.status === 'removed')).toHaveLength(2);
            expect(existsSync(f.lane)).toBe(false);
            expect(existsSync(review)).toBe(false);
            expect(f.git(['branch', '--list', 'fix/fixture'])).toContain('fix/fixture');
            expect(readCleanupRecords(f.root).every((record) => record.status === 'removed')).toBe(true);
        } finally {
            f.dispose();
        }
    });

    it.each(
        ['author', 'review', 'replacement'].flatMap((route) =>
            [
                { name: 'non-main base', invalid: { baseRefName: 'feature/still-open' } },
                { name: 'unknown base', invalid: { baseRefName: null } },
                { name: 'missing base', invalid: { baseRefName: undefined } },
                { name: 'missing timestamp', invalid: { mergedAt: undefined } },
                { name: 'null timestamp', invalid: { mergedAt: null } },
                { name: 'blank timestamp', invalid: { mergedAt: '' } },
                { name: 'invalid timestamp', invalid: { mergedAt: 'not-a-timestamp' } },
                { name: 'nonexistent calendar date', invalid: { mergedAt: '2026-02-30T00:00:00Z' } },
            ].map((proof) => ({ route, ...proof }))
        )
    )('retains $name for the $route route with a durable reason', ({ route, invalid }) => {
        const f = fixture();
        try {
            const target = route === 'review' ? join(f.root, '.agents/review-worktrees/review-42') : f.lane;
            if (route === 'review') {
                f.git(['worktree', 'add', '--detach', target, f.head]);
            }
            if (route === 'replacement') {
                f.pr.state = 'CLOSED';
                f.pr.mergedAt = null;
                f.port.removal.comments = () => [
                    {
                        body: 'Superseded by #99.',
                        authorNodeId: AUTHOR_BOT_NODE_ID,
                        authorType: 'Bot',
                        authorLogin: 'fixture',
                    },
                ];
                f.port.removal.replacement = (number) =>
                    Object.assign(
                        { number, state: 'MERGED', baseRefName: 'main', mergedAt: '2026-08-20T00:00:00Z' },
                        invalid
                    );
            } else {
                Object.assign(f.pr, invalid);
            }
            const outcome = cleanupLanes(f.port).find((item) => item.lane === target);
            expect(outcome?.status).toBe('protected');
            expect(existsSync(target)).toBe(true);
            expect(readCleanupRecords(f.root).find((record) => record.identity.path === target)?.reason).not.toBe('');
        } finally {
            f.dispose();
        }
    });

    it('removes a closed stack lane only when its truthful replacement merged into main', () => {
        const f = fixture();
        try {
            f.pr.state = 'CLOSED';
            f.pr.mergedAt = null;
            f.pr.baseRefName = 'feature/old-parent';
            f.port.removal.comments = () => [
                {
                    body: 'Superseded by #99.',
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorType: 'Bot',
                    authorLogin: 'fixture',
                },
            ];
            f.port.removal.replacement = (number) => ({
                number,
                state: 'MERGED',
                baseRefName: 'main',
                mergedAt: '2026-08-20T00:00:00Z',
            });
            expect(cleanupLanes(f.port)[0]?.status).toBe('removed');
            expect(existsSync(f.lane)).toBe(false);
        } finally {
            f.dispose();
        }
    });

    it.each([
        'dirty',
        'untracked',
        'ignored',
        'active cwd',
        'open file',
        'operation',
        'foreign lock',
        'open PR',
        'unmerged',
        'wrong head',
        'ambiguous',
    ])('retains %s with a durable reason and retries only after backoff', (condition) => {
        const f = fixture();
        try {
            if (condition === 'dirty') {
                writeFileSync(join(f.lane, 'tracked'), 'changed');
            }
            if (condition === 'untracked') {
                writeFileSync(join(f.lane, 'notes'), 'keep');
            }
            if (condition === 'ignored') {
                writeFileSync(join(f.lane, '.env'), 'keep');
            }
            if (condition === 'active cwd' || condition === 'open file') {
                f.port.removal.active = () => true;
            }
            if (condition === 'operation') {
                writeFileSync(f.git(['-C', f.lane, 'rev-parse', '--git-path', 'MERGE_HEAD']), f.head);
            }
            if (condition === 'foreign lock') {
                f.git(['worktree', 'unlock', f.lane]);
                f.git(['worktree', 'lock', '--reason', 'foreign', f.lane]);
            }
            if (condition === 'open PR') {
                f.pr.state = 'OPEN';
                f.pr.mergedAt = null;
            }
            if (condition === 'unmerged') {
                f.pr.state = 'CLOSED';
                f.pr.mergedAt = null;
                f.port.removal.comments = () => [];
            }
            if (condition === 'wrong head') {
                f.pr.headRefOid = '1'.repeat(40);
            }
            if (condition === 'ambiguous') {
                f.port.removal.pullRequests = () => [f.pr, { ...f.pr, number: 43 }];
            }
            expect(cleanupLanes(f.port)[0]).toMatchObject({ status: 'protected' });
            expect(existsSync(f.lane)).toBe(true);
            const [record] = readCleanupRecords(f.root);
            expect(record?.reason).not.toBe('');
            expect(record?.attempts).toBe(1);
            cleanupLanes(f.port);
            expect(readCleanupRecords(f.root)[0]?.attempts).toBe(1);
        } finally {
            f.dispose();
        }
    });

    it('retains primary and outside worktrees and never trusts a queued path after its HEAD changes', () => {
        const f = fixture();
        try {
            const foreign = join(f.root, 'foreign');
            f.git(['worktree', 'add', '-b', 'foreign', foreign]);
            cleanupLanes(f.port, undefined, true);
            f.git(['-C', f.lane, 'commit', '--allow-empty', '-m', 'successor']);
            const outcome = cleanupLanes(f.port);
            expect(outcome[0]?.reason).toContain('replaced a previous cleanup identity');
            expect(existsSync(f.lane)).toBe(true);
            expect(existsSync(foreign)).toBe(true);
            expect(existsSync(join(f.root, '.git'))).toBe(true);
        } finally {
            f.dispose();
        }
    });

    it('does not spend a stale request on a replacement directory holding the same branch/head', () => {
        const f = fixture();
        try {
            cleanupLanes(f.port, undefined, true);
            f.git(['worktree', 'unlock', f.lane]);
            f.git(['worktree', 'remove', f.lane]);
            f.git(['worktree', 'add', f.lane, 'fix/fixture']);
            expect(cleanupLanes(f.port)[0]?.status).toBe('protected');
            expect(existsSync(f.lane)).toBe(true);
            f.advance();
            expect(cleanupLanes(f.port)[0]?.status).toBe('removed');
        } finally {
            f.dispose();
        }
    });

    it('keeps API refusal pending without hammering later lanes, then a fresh worker proves merge before removal', () => {
        const f = fixture();
        try {
            let calls = 0;
            f.port.removal.pullRequests = () => {
                calls += 1;
                throw new Error('GitHub unavailable');
            };
            expect(cleanupLanes(f.port)[0]?.status).toBe('pending');
            expect(calls).toBe(1);
            expect(readCleanupRecords(f.root)[0]?.nextAttemptAt).toBeGreaterThan(f.port.now());
            cleanupLanes(f.port);
            expect(calls).toBe(1);
            const freshPort = {
                ...f.port,
                removal: {
                    ...f.port.removal,
                    pullRequests: () => {
                        calls += 1;
                        return [f.pr];
                    },
                },
            };
            f.advance();
            expect(cleanupLanes(freshPort)[0]?.status).toBe('removed');
            expect(calls).toBe(3); // both native ownership snapshots read fresh live proof
        } finally {
            f.dispose();
        }
    });

    it('keeps protected checks on cadence and a successful delivery wakes the exact head without bypassing API backoff', () => {
        const f = fixture();
        try {
            f.pr.state = 'OPEN';
            f.pr.mergedAt = null;
            for (let attempt = 0; attempt < 8; attempt += 1) {
                cleanupLanes(f.port);
                expect(readCleanupRecords(f.root)[0]?.nextAttemptAt).toBe(f.port.now() + cleanupBackoff(1));
                f.advance();
            }
            cleanupLanes(f.port);
            f.pr.state = 'MERGED';
            f.pr.mergedAt = '2026-10-28T00:00:00Z';
            expect(cleanupLanes(f.port, f.head)[0]?.status).toBe('removed');
        } finally {
            f.dispose();
        }
        const blocked = fixture();
        try {
            let reads = 0;
            blocked.port.removal.pullRequests = () => {
                reads += 1;
                throw new Error('GitHub unavailable');
            };
            cleanupLanes(blocked.port);
            expect(cleanupLanes(blocked.port, blocked.head)[0]?.status).toBe('pending');
            expect(reads).toBe(1);
            expect(existsSync(blocked.lane)).toBe(true);
        } finally {
            blocked.dispose();
        }
    });

    it('preserves the author lock when native removal fails after its final unlock', () => {
        const f = fixture();
        try {
            f.port.removal.remove = () => {
                throw new Error('native removal refused');
            };
            expect(cleanupLanes(f.port)[0]?.status).toBe('pending');
            expect(f.port.removal.worktrees().find((lane) => lane.path === f.lane)?.lockReason).toBe(
                AUTHOR_LOCK_REASON
            );
        } finally {
            f.dispose();
        }
    });

    it('reconciles a killed worker after native removal and clears only its original guard receipt', async () => {
        const f = fixture();
        try {
            writeGuardFailureReceipt(f.root, guardReceipt(f.head));
            const script = `
                const {cleanupLanes, withCleanupLock} = await import(${JSON.stringify(resolve('scripts/cleanupLanes.ts'))});
                const {shellPort,capture:nativeCapture} = await import(${JSON.stringify(resolve('scripts/removeLane.ts'))});
                const {execFileSync} = await import('node:child_process');
                const root = ${JSON.stringify(f.root)};
                const shell = {capture:(command,args,options)=>{if(command==='ps')return nativeCapture(command,args,options);const out=execFileSync(command,args,{cwd:root,encoding:'utf8'});return options?.preserveStdout?out:out.trim()},
                    run:(command,args)=>execFileSync(command,args,{cwd:root})};
                const native = shellPort(shell, root);
                const removal = {...native,fetch:()=>{},repository:()=> 'jcosta33/sourdaw',currentDirectory:()=>root,active:()=>false,
                    pullRequests:()=>[${JSON.stringify(f.pr)}],remoteHead:()=>undefined,
                    remove:(path)=>{native.remove(path);process.kill(process.pid,'SIGKILL')}};
                cleanupLanes({primaryRoot:root,removal,now:()=>1000,serialize:op=>withCleanupLock(root,shell,op),log:()=>{}});
            `;
            const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
                cwd: f.root,
                env: githubAuthorizationGitEnv(),
                stdio: 'pipe',
            });
            const [, signal] = await once(child, 'exit');
            expect(signal).toBe('SIGKILL');
            expect(existsSync(f.lane)).toBe(false);
            expect(existsSync(guardFailureReceiptPath(f.root, 'author'))).toBe(true);
            expect(readCleanupRecords(f.root)[0]).toMatchObject({ status: 'pending', attempts: 1 });
            f.advance();
            expect(cleanupLanes(f.port)[0]?.status).toBe('removed');
            expect(readCleanupRecords(f.root)[0]?.status).toBe('removed');
            expect(existsSync(guardFailureReceiptPath(f.root, 'author'))).toBe(false);
        } finally {
            f.dispose();
        }
    });

    it('retries failed post-removal guard housekeeping in a fresh worker scan', () => {
        const f = fixture();
        const clear = vi.spyOn(resourceGuard, 'clearGuardFailureReceiptIfUnchanged');
        try {
            writeGuardFailureReceipt(f.root, guardReceipt(f.head));
            clear.mockImplementationOnce(() => {
                throw new Error('guard bookkeeping temporarily unavailable');
            });
            expect(cleanupLanes(f.port)[0]).toMatchObject({
                status: 'pending',
                reason: 'guard bookkeeping temporarily unavailable',
            });
            expect(existsSync(f.lane)).toBe(false);
            expect(f.port.removal.worktrees().some((lane) => lane.path === f.lane)).toBe(false);
            expect(existsSync(guardFailureReceiptPath(f.root, 'author'))).toBe(true);
            f.advance();
            const fresh = {
                ...f.port,
                removal: {
                    ...f.port.removal,
                    pullRequests: () => {
                        throw new Error('no PR lookup after removal');
                    },
                },
            };
            expect(cleanupLanes(fresh)[0]?.status).toBe('removed');
            expect(readCleanupRecords(f.root)[0]?.status).toBe('removed');
            expect(existsSync(guardFailureReceiptPath(f.root, 'author'))).toBe(false);
        } finally {
            clear.mockRestore();
            f.dispose();
        }
    });

    it('reconciles older absent records without inventing authority to clear guard state', () => {
        const f = fixture();
        try {
            cleanupLanes(f.port, undefined, true);
            f.git(['worktree', 'unlock', f.lane]);
            f.git(['worktree', 'remove', f.lane]);
            writeGuardFailureReceipt(f.root, guardReceipt(f.head));
            f.advance();
            expect(cleanupLanes(f.port)[0]).toMatchObject({
                status: 'removed',
                reason: expect.stringContaining('unbound guard bookkeeping preserved'),
            });
            expect(existsSync(guardFailureReceiptPath(f.root, 'author'))).toBe(true);
        } finally {
            f.dispose();
        }
    });

    it('rechecks an atomically claimed receipt and preserves a concurrent replacement with identical bytes', () => {
        const f = fixture();
        const original = resourceGuard.clearGuardFailureReceiptIfUnchanged;
        const clear = vi.spyOn(resourceGuard, 'clearGuardFailureReceiptIfUnchanged');
        try {
            const receipt = guardReceipt(f.head);
            writeGuardFailureReceipt(f.root, receipt);
            clear.mockImplementationOnce((...args) => {
                writeGuardFailureReceipt(f.root, receipt);
                return original(...args);
            });
            expect(cleanupLanes(f.port)[0]?.status).toBe('pending');
            expect(existsSync(f.lane)).toBe(false);
            const path = guardFailureReceiptPath(f.root, 'author');
            expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(receipt);
            f.advance();
            expect(cleanupLanes(f.port)[0]?.status).toBe('removed');
            expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(receipt);
        } finally {
            clear.mockRestore();
            f.dispose();
        }
    });

    it.each(['new guard receipt', 'same bytes in a new receipt', 'unregistered directory', 'registered worktree'])(
        'preserves %s when reconciling an interrupted removal',
        (replacement) => {
            const f = fixture();
            const clear = vi.spyOn(resourceGuard, 'clearGuardFailureReceiptIfUnchanged');
            try {
                const receipt = guardReceipt(f.head);
                writeGuardFailureReceipt(f.root, receipt);
                clear.mockImplementationOnce(() => {
                    throw new Error('interrupted housekeeping');
                });
                cleanupLanes(f.port);
                expect(existsSync(f.lane)).toBe(false);
                if (replacement === 'registered worktree') {
                    f.git(['worktree', 'add', f.lane, 'fix/fixture']);
                } else if (replacement === 'unregistered directory') {
                    mkdirSync(f.lane);
                    writeFileSync(join(f.lane, 'notes'), 'replacement work');
                } else {
                    writeGuardFailureReceipt(
                        f.root,
                        replacement === 'new guard receipt' ? guardReceipt(f.head, '2026-10-29T00:00:00Z') : receipt
                    );
                }
                const path = guardFailureReceiptPath(f.root, 'author');
                const bytes = readFileSync(path, 'utf8');
                f.advance();
                const outcomes = cleanupLanes(f.port);
                if (replacement.endsWith('directory') || replacement.endsWith('worktree')) {
                    expect(outcomes.every((outcome) => outcome.status === 'protected')).toBe(true);
                    expect(existsSync(f.lane)).toBe(true);
                } else {
                    expect(outcomes[0]?.status).toBe('removed');
                }
                expect(readFileSync(path, 'utf8')).toBe(bytes);
                if (replacement === 'unregistered directory') {
                    expect(readFileSync(join(f.lane, 'notes'), 'utf8')).toBe('replacement work');
                }
                if (replacement.endsWith('directory') || replacement.endsWith('worktree')) {
                    expect(readCleanupRecords(f.root).find((record) => record.attempts === 1)?.removal).toBeUndefined();
                    if (replacement === 'registered worktree') {
                        f.git(['worktree', 'remove', f.lane]);
                    } else {
                        rmSync(f.lane, { recursive: true });
                    }
                    f.advance();
                    cleanupLanes(f.port);
                    expect(readFileSync(path, 'utf8')).toBe(bytes);
                }
            } finally {
                clear.mockRestore();
                f.dispose();
            }
        }
    );

    it('retains a changed lane immediately before the native removal boundary', () => {
        const f = fixture();
        try {
            const unlock = f.port.removal.unlock;
            f.port.removal.unlock = (path) => {
                unlock(path);
                writeFileSync(join(path, 'late-notes'), 'keep');
            };
            expect(cleanupLanes(f.port)[0]?.status).toBe('protected');
            expect(readFileSync(join(f.lane, 'late-notes'), 'utf8')).toBe('keep');
        } finally {
            f.dispose();
        }
    });

    it('serializes competing workers and recovers a killed worker without losing its pending identity', async () => {
        const f = fixture();
        try {
            expect(() => withCleanupLock(f.root, f.shell, () => withCleanupLock(f.root, f.shell, () => {}))).toThrow(
                'already running'
            );
            const module = resolve('scripts/cleanupLanes.ts');
            const script = `
                const {cleanupLanes, withCleanupLock} = await import(${JSON.stringify(module)});
                const {shellPort,capture:nativeCapture} = await import(${JSON.stringify(resolve('scripts/removeLane.ts'))});
                const {execFileSync} = await import('node:child_process');
                const root = ${JSON.stringify(f.root)};
                const shell = { capture: (command,args,options) => {if(command==='ps')return nativeCapture(command,args,options);const out=execFileSync(command,args,{cwd:root,encoding:'utf8'});return options?.preserveStdout?out:out.trim()},
                    run: (command,args) => execFileSync(command,args,{cwd:root}) };
                const removal={...shellPort(shell,root),fetch:()=>{},repository:()=> 'jcosta33/sourdaw',currentDirectory:()=>root,active:()=>false,
                    pullRequests:()=>[${JSON.stringify(f.pr)}],remoteHead:()=>undefined,
                    remove:()=>process.kill(process.pid,'SIGKILL')};
                cleanupLanes({primaryRoot:root,removal,now:()=>1000,serialize:op=>withCleanupLock(root,shell,op),log:()=>{}});
            `;
            const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
                cwd: f.root,
                env: githubAuthorizationGitEnv(),
                stdio: 'pipe',
            });
            const [, signal] = await once(child, 'exit');
            expect(signal).toBe('SIGKILL');
            expect(readCleanupRecords(f.root)[0]).toMatchObject({ status: 'pending', attempts: 1 });
            expect(existsSync(f.lane)).toBe(true);
            f.advance();
            expect(cleanupLanes(f.port)[0]?.status).toBe('removed');
        } finally {
            f.dispose();
        }
    });

    it('reclaims a lock whose PID now belongs to a different live process lifetime', async () => {
        const f = fixture();
        const child = spawn(process.execPath, ['-e', "process.stdout.write('ready');setInterval(()=>{},1000)"], {
            stdio: 'pipe',
        });
        try {
            await once(child.stdout, 'data');
            installLock(f.root, {
                version: 1,
                pid: child.pid,
                token: randomUUID(),
                startedAt: '2000-01-01T00:00:00.000Z',
            });
            let operationRan = false;
            withCleanupLock(f.root, f.shell, () => {
                operationRan = true;
            });
            expect(operationRan).toBe(true);
            expect(f.git(['for-each-ref', '--format=%(objectname)', cleanupLockRef])).toBe('');
            expect(child.exitCode).toBeNull();
        } finally {
            child.kill();
            await once(child, 'exit');
            f.dispose();
        }
    });

    it('keeps the live original lock across caller locale and timezone drift', () => {
        const f = fixture();
        const environments: Array<{ command: string; options?: Parameters<ShellRunner['capture']>[2] }> = [];
        const caller = (timezone: string, locale: string): ShellRunner => ({
            ...f.shell,
            capture: (command, args, options) => {
                environments.push({ command, options });
                const env = { ...githubAuthorizationGitEnv(), TZ: timezone, LC_ALL: locale };
                if (options?.processClock === 'utc') {
                    env.TZ = 'UTC';
                    env.LC_ALL = 'C';
                }
                const result = execFileSync(command, args, {
                    cwd: f.root,
                    encoding: 'utf8',
                    env,
                });
                return options?.preserveStdout ? result : result.trim();
            },
        });
        try {
            let nestedRan = false;
            withCleanupLock(f.root, caller('UTC', 'C'), () => {
                const original = f.git(['rev-parse', '--verify', cleanupLockRef]);
                const owner = JSON.parse(f.git(['cat-file', 'blob', original]));
                expect(owner).toMatchObject({ pid: process.pid, startedAt: expect.stringMatching(/\.000Z$/) });
                expect(() =>
                    withCleanupLock(f.root, caller('America/Los_Angeles', 'de_DE.UTF-8'), () => {
                        nestedRan = true;
                    })
                ).toThrow('already running');
                expect(f.git(['rev-parse', '--verify', cleanupLockRef])).toBe(original);
            });
            expect(nestedRan).toBe(false);
            expect(environments.filter((entry) => entry.command === 'ps')).toHaveLength(3);
            for (const entry of environments.filter((item) => item.command === 'ps')) {
                expect(entry.options).toMatchObject({ processClock: 'utc' });
            }
        } finally {
            f.dispose();
        }
    });

    it('reclaims only the exact lock ref of a conclusively dead owner', async () => {
        const f = fixture();
        const child = spawn(process.execPath, ['-e', ''], { stdio: 'pipe' });
        try {
            const pid = child.pid;
            await once(child, 'exit');
            installLock(f.root, { version: 1, pid, token: randomUUID(), startedAt: '2000-01-01T00:00:00.000Z' });
            let operationRan = false;
            withCleanupLock(f.root, f.shell, () => {
                operationRan = true;
            });
            expect(operationRan).toBe(true);
            expect(f.git(['for-each-ref', '--format=%(objectname)', cleanupLockRef])).toBe('');
        } finally {
            f.dispose();
        }
    });

    it.each([
        { label: 'missing lifetime', fields: { startedAt: undefined } },
        { label: 'malformed lifetime', fields: { startedAt: 'not-a-time' } },
        { label: 'nonexistent calendar lifetime', fields: { startedAt: '2026-02-30T00:00:00.000Z' } },
        { label: 'missing token', fields: { token: undefined } },
        { label: 'malformed PID', fields: { pid: 0 } },
    ])('preserves a lock with $label and does not enter the operation', ({ fields }) => {
        const f = fixture();
        try {
            const original = installLock(f.root, {
                version: 1,
                pid: process.pid,
                token: randomUUID(),
                startedAt: '2000-01-01T00:00:00.000Z',
                ...fields,
            });
            let operationRan = false;
            expect(() =>
                withCleanupLock(f.root, f.shell, () => {
                    operationRan = true;
                })
            ).toThrow('unknown');
            expect(operationRan).toBe(false);
            expect(f.git(['rev-parse', '--verify', cleanupLockRef])).toBe(original);
            expect(readFileSync(join(f.lane, 'tracked'), 'utf8')).toBe('original');
        } finally {
            f.dispose();
        }
    });

    it.each(['missing', 'malformed', 'denied'])('preserves lock and work when lifetime inspection is %s', (state) => {
        const f = fixture();
        try {
            const original = installLock(f.root, {
                version: 1,
                pid: process.pid,
                token: randomUUID(),
                startedAt: '2000-01-01T00:00:00.000Z',
            });
            let queries = 0;
            let operationRan = false;
            const uncertain = {
                ...f.shell,
                capture: (command: string, args: string[], options?: Parameters<ShellRunner['capture']>[2]) => {
                    if (command === 'ps' && ++queries === 2) {
                        if (state === 'denied') {
                            throw new Error('permission denied');
                        }
                        return state === 'missing' ? '' : 'unreadable process lifetime';
                    }
                    return f.shell.capture(command, args, options);
                },
            };
            expect(() =>
                withCleanupLock(f.root, uncertain, () => {
                    operationRan = true;
                })
            ).toThrow('unknown');
            expect(operationRan).toBe(false);
            expect(f.git(['rev-parse', '--verify', cleanupLockRef])).toBe(original);
            expect(existsSync(f.lane)).toBe(true);
        } finally {
            f.dispose();
        }
    });

    it('does not acquire a lock when its own process lifetime cannot be inspected', () => {
        const f = fixture();
        try {
            const uncertain = {
                ...f.shell,
                capture: (command: string, args: string[]) => {
                    if (command === 'ps') {
                        throw new Error('inspection unavailable');
                    }
                    return f.shell.capture(command, args);
                },
            };
            let operationRan = false;
            expect(() =>
                withCleanupLock(f.root, uncertain, () => {
                    operationRan = true;
                })
            ).toThrow('unknown');
            expect(operationRan).toBe(false);
            expect(f.git(['for-each-ref', '--format=%(objectname)', cleanupLockRef])).toBe('');
        } finally {
            f.dispose();
        }
    });

    it.each(
        ['current', 'owner'].flatMap((stage) =>
            ['timeout', 'diagnostic', 'failure'].map((failure) => ({ stage, failure }))
        )
    )('keeps the native bounded inspection fail-closed for $stage $failure', ({ stage, failure }) => {
        const f = fixture();
        try {
            const program = `
                    import cp from 'node:child_process';
                    import {syncBuiltinESMExports} from 'node:module';
                    const root=${JSON.stringify(f.root)},stage=${JSON.stringify(stage)},failure=${JSON.stringify(failure)};
                    const original=cp.spawnSync;
                    let samples=0,inspection;
                    cp.spawnSync=(command,args,options)=>{
                        if(command==='ps'||command==='/bin/ps') {
                            samples++;
                            if(stage==='current'||samples===2) {
                                inspection={command,timeout:options.timeout,locale:options.env.LC_ALL,timezone:options.env.TZ};
                                const result={pid:process.pid,output:[null,'Fri Oct 30 00:00:00 2026',''],stdout:'Fri Oct 30 00:00:00 2026',stderr:'',status:0,signal:null};
                                if(failure==='timeout')result.error=Object.assign(new Error('inspection timed out'),{code:'ETIMEDOUT'});
                                if(failure==='diagnostic')result.stderr='inspection incomplete';
                                if(failure==='failure'){result.status=1;result.stderr='permission denied';}
                                return result;
                            }
                        }
                        return original(command,args,options);
                    };
                    syncBuiltinESMExports();
                    const {withCleanupLock}=await import(${JSON.stringify(resolve('scripts/cleanupLanes.ts'))});
                    const {capture}=await import(${JSON.stringify(resolve('scripts/removeLane.ts'))});
                    const git=(args,input)=>cp.execFileSync('git',['-C',root,...args],{encoding:'utf8',input}).trim();
                    const owner={version:1,pid:process.pid,token:${JSON.stringify(randomUUID())},startedAt:'2000-01-01T00:00:00.000Z'};
                    const initial=git(['hash-object','-w','--stdin'],JSON.stringify(owner));
                    git(['update-ref',${JSON.stringify(cleanupLockRef)},initial]);
                    const shell={capture:(command,args,options)=>command==='ps'?capture(command,args,options):cp.execFileSync(command,args,{cwd:root,encoding:'utf8'}).trim(),run:(command,args)=>cp.execFileSync(command,args,{cwd:root})};
                    let ran=false,error;
                    try{withCleanupLock(root,shell,()=>{ran=true;});}catch(caught){error=caught.message;}
                    console.log(JSON.stringify({ran,error,inspection,initial,current:git(['rev-parse',${JSON.stringify(cleanupLockRef)}])}));
                `;
            const result = JSON.parse(
                execFileSync(process.execPath, ['--input-type=module', '-e', program], {
                    cwd: f.root,
                    encoding: 'utf8',
                    env: { ...githubAuthorizationGitEnv(), TZ: 'America/Los_Angeles', LC_ALL: 'de_DE.UTF-8' },
                })
            );
            expect(result.ran).toBe(false);
            expect(result.error).toContain('unknown');
            expect(result.current).toBe(result.initial);
            expect(result.inspection).toEqual({
                command: process.platform === 'darwin' ? '/bin/ps' : 'ps',
                timeout: 5_000,
                locale: 'C',
                timezone: 'UTC',
            });
            expect(existsSync(f.lane)).toBe(true);
        } finally {
            f.dispose();
        }
    });

    it('retains the lock on unknown PID access instead of inferring owner death', () => {
        const f = fixture();
        const kill = vi.spyOn(process, 'kill');
        try {
            const original = installLock(f.root, {
                version: 1,
                pid: process.pid,
                token: randomUUID(),
                startedAt: '2000-01-01T00:00:00.000Z',
            });
            kill.mockImplementationOnce(() => {
                throw Object.assign(new Error('denied'), { code: 'EPERM' });
            });
            let operationRan = false;
            expect(() =>
                withCleanupLock(f.root, f.shell, () => {
                    operationRan = true;
                })
            ).toThrow('unknown');
            expect(operationRan).toBe(false);
            expect(f.git(['rev-parse', '--verify', cleanupLockRef])).toBe(original);
        } finally {
            kill.mockRestore();
            f.dispose();
        }
    });

    it.each(['acquire', 'release'])('never overwrites a contending Git ref during %s', (stage) => {
        const f = fixture();
        try {
            let competing = '';
            let operationRan = false;
            const compete = () =>
                installLock(f.root, {
                    version: 1,
                    pid: process.pid,
                    token: randomUUID(),
                    startedAt: '2000-01-01T00:00:00.000Z',
                });
            const shell = {
                ...f.shell,
                run: (command: string, args: string[]) => {
                    if (stage === 'acquire' && args[0] === 'update-ref' && args[1] === cleanupLockRef) {
                        competing = compete();
                    }
                    f.shell.run(command, args);
                },
            };
            expect(() =>
                withCleanupLock(f.root, shell, () => {
                    operationRan = true;
                    if (stage === 'release') {
                        competing = compete();
                    }
                })
            ).toThrow();
            expect(operationRan).toBe(stage === 'release');
            expect(f.git(['rev-parse', '--verify', cleanupLockRef])).toBe(competing);
        } finally {
            f.dispose();
        }
    });

    it('caps retry backoff without persisting secret-shaped errors', () => {
        expect(cleanupBackoff(1)).toBe(300_000);
        expect(cleanupBackoff(100)).toBe(86_400_000);
        const f = fixture();
        try {
            f.port.removal.pullRequests = () => {
                throw new Error(['gh', 'p_', 'private'].join(''));
            };
            cleanupLanes(f.port);
            expect(readCleanupRecords(f.root)[0]?.reason).toBe('inspection failed (private details withheld)');
        } finally {
            f.dispose();
        }
    });
});

describe('complete lane activity proof', () => {
    const uid = process.getuid?.() ?? 0;
    const catalog = `p${process.pid}\0\nfcwd\0tDIR\0n/repo\0\n`;
    const capture = (command: string) => (command === 'ps' ? `${process.pid} ${uid}` : catalog);

    it('refuses a successful but incomplete catalog omitting a live process', () => {
        expect(() =>
            laneIsActive('/repo/lane', {
                capture: (command) => (command === 'ps' ? `${process.pid} ${uid}\n${process.ppid} ${uid}` : catalog),
            })
        ).toThrow('omitted a live process');
    });
    it('refuses truncated and permission-denied observations', () => {
        expect(() =>
            laneIsActive('/repo/lane', { capture: (command) => (command === 'ps' ? capture(command) : 'p1') })
        ).toThrow('incomplete');
        expect(() =>
            laneIsActive('/repo/lane', {
                capture: (command) =>
                    command === 'ps' ? capture(command) : `p${process.pid}\0\nfcwd\0tDIR\0nPermission denied\0\n`,
            })
        ).toThrow('incomplete');
        expect(() =>
            laneIsActive('/repo/lane', {
                capture: () => {
                    throw new Error('permission denied');
                },
            })
        ).toThrow('permission denied');
    });
    it('an observed holder vetoes deletion even when an unrelated descriptor catalog is incomplete', () => {
        const partial = `p${process.pid}\0\nf7\0tREG\0n/repo/lane/held\0\nf8\0nmissing-type\0\n`;
        expect(
            laneIsActive('/repo/lane', { capture: (command) => (command === 'ps' ? capture(command) : partial) })
        ).toBe(true);
    });
    it('admits only complete before/after coverage and observes any open file', () => {
        expect(laneIsActive('/repo/lane', { capture })).toBe(false);
        expect(
            laneIsActive('/repo/lane', {
                capture: (command) =>
                    command === 'ps' ? capture(command) : `${catalog}f7\0tREG\0n/repo/lane/held\0\n`,
            })
        ).toBe(true);
    });
    it.skipIf(process.platform !== 'darwin')(
        'observes a real holder whose working directory is outside the temporary worktree',
        async () => {
            const f = fixture();
            const child = spawn(
                process.execPath,
                [
                    '-e',
                    `const fs=require('node:fs');fs.openSync(${JSON.stringify(join(f.lane, 'tracked'))},'r');process.stdout.write('ready');setInterval(()=>{},1000);`,
                ],
                { cwd: f.root, stdio: ['ignore', 'pipe', 'pipe'] }
            );
            try {
                await once(child.stdout, 'data');
                const native = shellPort(
                    {
                        ...f.shell,
                        capture: (command, args, options) =>
                            f.shell.capture(
                                command,
                                command === 'lsof' ? [...args, '-p', String(child.pid)] : args,
                                options
                            ),
                    },
                    f.root
                );
                expect(native.active(f.lane)).toBe(true);
            } finally {
                child.kill();
                await once(child, 'exit');
                f.dispose();
            }
        }
    );
});
