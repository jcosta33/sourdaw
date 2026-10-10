import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
    existsSync,
    chmodSync,
    mkdtempSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { main, parseCliArgs, runGuardedCommand, storageFileState } from '../resourceGuard';
import {
    createGuardStorage,
    diskStorageFailure,
    reclaimGuardStorage,
    recoverGuardStorage,
    resolveGuardStorageRoot,
    storageReferenceState,
    sameUserProcessIds,
    parseLsofCensus,
    referencesStoragePath,
    DEFAULT_DISK_RESERVE_BYTES,
    DISK_RESERVE_ENV,
    type StorageRecoveryPorts,
} from '../resourceGuardStorage';

const roots: string[] = [];
const childPids = new Set<number>();
const abundantMemoryBytes = 128 * 1024 ** 3;
const guardPath = resolve('scripts/resourceGuard.ts');
const storagePath = resolve('scripts/resourceGuardStorage.ts');

function fixture(): string {
    const fixtures = resolve('.agents/guard-storage-fixtures');
    mkdirSync(fixtures, { recursive: true });
    const root = mkdtempSync(join(fixtures, 'storage-'));
    roots.push(root);
    return root;
}

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() >= deadline) {
            throw new Error('storage fixture condition timed out');
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}

async function kill(pid: number): Promise<void> {
    if (isAlive(pid)) {
        process.kill(pid, 'SIGKILL');
        await waitUntil(() => !isAlive(pid));
    }
}

afterEach(async () => {
    for (const pid of childPids) {
        await kill(pid);
    }
    childPids.clear();
    for (const root of roots) {
        rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
});

function guarded(root: string, input: Partial<Parameters<typeof runGuardedCommand>[0]> = {}) {
    return runGuardedCommand({
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        profile: 'focused',
        availableMemoryBytes: abundantMemoryBytes,
        maxRssBytes: 512 * 1024 ** 2,
        admissionRoot: root,
        storageRoot: join(root, 'storage'),
        diskReserveBytes: 1,
        ...input,
    });
}

const fakeOwner = { pid: 999990, startedAt: 'original-start' };
const fakeReclaimer = { pid: 999991, startedAt: 'reclaimer-start' };
const deadPorts: StorageRecoveryPorts = { identityState: () => 'dead', sessionState: () => 'dead' };

function ownedStorage(root: string, ports: StorageRecoveryPorts = deadPorts) {
    return createGuardStorage({ root, token: randomUUID(), owner: fakeOwner, ports });
}

function readOwner(tempDirectory: string): Parameters<typeof reclaimGuardStorage>[0]['owner'] {
    return JSON.parse(readFileSync(join(dirname(tempDirectory), 'owner.json'), 'utf8'));
}

function claimPayloads(root: string): string[] {
    const claims = join(root, '.claims');
    return readdirSync(claims).flatMap((claim) =>
        readdirSync(join(claims, claim))
            .filter((name) => name !== 'claim.json')
            .map((name) => join(claims, claim, name))
    );
}

describe('guard-owned temporary storage', () => {
    it('defaults to the canonical Git primary or the non-Git command volume', () => {
        const commonDirectory = execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
        const primary = dirname(realpathSync(resolve(commonDirectory)));
        expect(resolveGuardStorageRoot(process.cwd())).toBe(join(primary, '.agents', 'guard-storage'));

        const root = fixture();
        const observed = execFileSync(
            process.execPath,
            [
                '--input-type=module',
                '-e',
                `import { resolveGuardStorageRoot } from ${JSON.stringify(pathToFileURL(storagePath).href)}; console.log(JSON.stringify(resolveGuardStorageRoot(process.cwd())));`,
            ],
            {
                cwd: root,
                env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(root) },
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
            }
        );
        expect(JSON.parse(observed)).toBe(join(realpathSync(root), '.agents', 'guard-storage'));
    });

    it('owns all child temp paths before startup and removes them after normal exit', async () => {
        const fixtures = resolve('.agents/guard-storage-fixtures');
        mkdirSync(fixtures, { recursive: true });
        const root = mkdtempSync(join(fixtures, 'startup-'));
        const storageRoot = join(root, 'storage');
        try {
            const result = await runGuardedCommand({
                command: process.execPath,
                args: [
                    '-e',
                    `console.log(JSON.stringify({ tmp: require('node:os').tmpdir(), TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP }));`,
                ],
                profile: 'focused',
                admissionRoot: root,
                storageRoot,
                availableMemoryBytes: 128 * 1024 ** 3,
                maxRssBytes: 512 * 1024 ** 2,
                env: { ...process.env, TMPDIR: root, TMP: root, TEMP: root },
            });
            expect(result.reason).toBeUndefined();
            expect(result.code).toBe(0);
            const paths: { tmp: string; TMPDIR: string; TMP: string; TEMP: string } = JSON.parse(result.output);
            expect(paths.tmp.startsWith(`${storageRoot}/`)).toBe(true);
            expect(paths.TMPDIR).toBe(paths.tmp);
            expect(paths.TMP).toBe(paths.tmp);
            expect(paths.TEMP).toBe(paths.tmp);
            expect(existsSync(paths.tmp)).toBe(false);
            expect(existsSync(root)).toBe(true);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('contains spawn errors without an unhandled child error and cleans only its run', async () => {
        const root = fixture();
        const foreign = join(root, 'keep');
        writeFileSync(foreign, 'foreign');
        await expect(guarded(root, { command: join(root, 'missing-executable') })).rejects.toThrow(/ENOENT/);
        expect(readdirSync(join(root, 'storage')).filter((name) => !name.startsWith('.'))).toEqual([]);
        expect(readFileSync(foreign, 'utf8')).toBe('foreign');
    });

    it('contains post-spawn publication failure and retains uncertain storage without masking the failure', async () => {
        const root = fixture();
        let childPid: number | undefined;
        let temp: string | undefined;
        const foreign = join(root, 'keep');
        writeFileSync(foreign, 'foreign');
        await expect(
            guarded(root, {
                args: ['-e', 'setInterval(() => {}, 1000)'],
                storageFactory: (input) => {
                    const storage = createGuardStorage(input);
                    temp = storage.tempDirectory;
                    return {
                        ...storage,
                        recordProcesses: (child, tracked) => {
                            childPid = child?.pid;
                            const metadataPath = join(dirname(storage.tempDirectory), 'owner.json');
                            rmSync(metadataPath);
                            mkdirSync(metadataPath);
                            storage.recordProcesses(child, tracked);
                        },
                    };
                },
            })
        ).rejects.toThrow(/validation process identity could not be published; guard storage retained/);
        expect(childPid).toBeDefined();
        if (childPid !== undefined) {
            expect(isAlive(childPid)).toBe(false);
        }
        expect(temp).toBeDefined();
        if (temp !== undefined) {
            expect(existsSync(temp)).toBe(true);
        }
        expect(readFileSync(foreign, 'utf8')).toBe('foreign');
    });

    it('blocks child startup when any monitored volume is low or cannot be measured', async () => {
        for (const unavailable of [false, true]) {
            const root = fixture();
            const marker = join(root, 'spawned');
            const sampled: string[] = [];
            const result = await guarded(root, {
                args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'spawned')`],
                diskReserveBytes: 100,
                diskSampler: (path) => {
                    sampled.push(path);
                    if (path !== '/') {
                        return 1000;
                    }
                    return unavailable ? undefined : 99;
                },
            });
            expect(result.reason).toBe(unavailable ? 'monitor' : 'pressure');
            expect(result.output).toMatch(unavailable ? /disk space could not be measured/ : /disk space below/);
            expect(sampled).toContain('/');
            expect(sampled).toContain(process.cwd());
            expect(sampled.some((path) => path.startsWith(join(root, 'storage')))).toBe(true);
            expect(existsSync(marker)).toBe(false);
        }
    });

    it('preserves pre-spawn failure and releases admission when storage cleanup rejects', async () => {
        for (const setupFailure of [false, true]) {
            const root = fixture();
            const marker = join(root, 'spawned');
            const pending = guarded(root, {
                args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'spawned')`],
                diskSampler: () => (setupFailure ? 1000 : 0),
                storageFactory: (input) => {
                    const storage = createGuardStorage(input);
                    return {
                        ...storage,
                        markSpawning: () => {
                            throw new Error('injected pre-spawn publication failure');
                        },
                        release: async () => {
                            throw new Error('injected cleanup rejection');
                        },
                    };
                },
            });
            if (setupFailure) {
                await expect(pending).rejects.toThrow(/injected pre-spawn publication failure; guard storage retained/);
            } else {
                const result = await pending;
                expect(result.reason).toBe('pressure');
                expect(result.output).toMatch(/disk space below.*guard storage retained/s);
            }
            expect(existsSync(marker)).toBe(false);
            expect(readdirSync(join(root, 'sourdaw-validation.reservations'))).toEqual([]);
        }
    });

    it('stops a real child on disk pressure, retaining its temp until the child has stopped', async () => {
        const root = fixture();
        const marker = join(root, 'started.json');
        let tempExistedWhileAlive = false;
        const result = await guarded(root, {
            args: [
                '-e',
                `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ pid: process.pid, tmp: require('node:os').tmpdir() })); setInterval(() => {}, 1000);`,
            ],
            hostSampleIntervalMs: 20,
            sampleIntervalMs: 20,
            diskSampler: () => {
                if (!existsSync(marker)) {
                    return 1000;
                }
                const started: { pid: number; tmp: string } = JSON.parse(readFileSync(marker, 'utf8'));
                tempExistedWhileAlive = isAlive(started.pid) && existsSync(started.tmp);
                return 0;
            },
        });
        const started: { pid: number; tmp: string } = JSON.parse(readFileSync(marker, 'utf8'));
        expect(result.reason).toBe('pressure');
        expect(result.output).toMatch(/disk space below/);
        expect(tempExistedWhileAlive).toBe(true);
        expect(isAlive(started.pid)).toBe(false);
        expect(existsSync(started.tmp)).toBe(false);
    });

    it('keeps storage through SIGTERM resistance and removes it only after forced descendant exit', async () => {
        const root = fixture();
        const marker = join(root, 'started.json');
        const terminated = join(root, 'term');
        const lastLiveSample = join(root, 'live');
        const descendant = `const fs = require('node:fs'); const tmp = require('node:os').tmpdir(); process.on('SIGTERM', () => fs.writeFileSync(${JSON.stringify(terminated)}, 'received')); fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ pid: process.pid, tmp })); setInterval(() => { fs.writeFileSync(${JSON.stringify(`${lastLiveSample}.candidate`)}, String(fs.existsSync(tmp))); fs.renameSync(${JSON.stringify(`${lastLiveSample}.candidate`)}, ${JSON.stringify(lastLiveSample)}); }, 20);`;
        const result = await guarded(root, {
            args: [
                '-e',
                `process.on('SIGTERM', () => {}); require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { detached: true, stdio: 'ignore' }); setInterval(() => {}, 1000);`,
            ],
            timeoutMs: 1000,
            sampleIntervalMs: 20,
            hostSampleIntervalMs: 20,
        });
        const started: { pid: number; tmp: string } = JSON.parse(readFileSync(marker, 'utf8'));
        expect(result.reason).toBe('timeout');
        expect(readFileSync(terminated, 'utf8')).toBe('received');
        expect(readFileSync(lastLiveSample, 'utf8')).toBe('true');
        expect(isAlive(started.pid)).toBe(false);
        expect(existsSync(started.tmp)).toBe(false);
    }, 15_000);

    it('preserves a killed supervisors storage while descendants live and reclaims it on a later start', async () => {
        const root = fixture();
        const marker = join(root, 'started.json');
        const descendant = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ pid: process.pid, tmp: require('node:os').tmpdir() })); setInterval(() => {}, 1000);`;
        const child = `const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { detached: true, stdio: 'ignore' }); require('node:fs').writeFileSync(${JSON.stringify(join(root, 'root.pid'))}, String(process.pid)); setInterval(() => {}, 1000);`;
        const options = {
            command: process.execPath,
            args: ['-e', child],
            profile: 'focused',
            availableMemoryBytes: abundantMemoryBytes,
            maxRssBytes: 512 * 1024 ** 2,
            admissionRoot: root,
            storageRoot: join(root, 'storage'),
            diskReserveBytes: 1,
            sampleIntervalMs: 20,
            hostSampleIntervalMs: 20,
        };
        const supervisor = spawn(
            process.execPath,
            [
                '--input-type=module',
                '-e',
                `const { runGuardedCommand } = await import(${JSON.stringify(guardPath)}); await runGuardedCommand(${JSON.stringify(options)});`,
            ],
            { stdio: 'ignore' }
        );
        expect(supervisor.pid).toBeDefined();
        if (supervisor.pid !== undefined) {
            childPids.add(supervisor.pid);
        }
        await waitUntil(() => existsSync(marker) && existsSync(join(root, 'root.pid')));
        const started: { pid: number; tmp: string } = JSON.parse(readFileSync(marker, 'utf8'));
        const rootPid = Number(readFileSync(join(root, 'root.pid'), 'utf8'));
        childPids.add(started.pid);
        childPids.add(rootPid);
        await waitUntil(() => readOwner(started.tmp).tracked.some((identity) => identity.pid === started.pid));
        if (supervisor.pid !== undefined) {
            await kill(supervisor.pid);
        }
        expect(existsSync(started.tmp)).toBe(true);
        expect((await guarded(root)).code).toBe(0);
        expect(existsSync(started.tmp)).toBe(true);
        await kill(rootPid);
        await kill(started.pid);
        expect((await guarded(root)).code).toBe(0);
        expect(existsSync(started.tmp)).toBe(false);
    }, 30_000);

    it.each([
        { scenario: 'parent exit', program: 'single-line program' },
        { scenario: 'supervisor crash', program: 'single-line program' },
        { scenario: 'parent exit', program: 'multiline program' },
        { scenario: 'supervisor crash', program: 'multiline program' },
    ] as const)(
        'retains storage for a detached descendant that replaces its environment: $scenario ($program)',
        async ({ scenario, program }) => {
            const root = fixture();
            const marker = join(root, 'escaped.json');
            const rootMarker = join(root, 'root.pid');
            const resultPath = join(root, 'result.json');
            const descendant = [
                "const fs = require('node:fs');",
                `fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ pid: process.pid, tmp: require('node:os').tmpdir() }));`,
                'setInterval(() => {}, 1000);',
            ].join(program === 'multiline program' ? '\n' : ' ');
            const parent = `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(rootMarker)}, String(process.pid)); setTimeout(() => { const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { detached: true, stdio: 'ignore', env: { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP, PATH: process.env.PATH } }); child.unref(); }, 375); const timer = setInterval(() => { if (fs.existsSync(${JSON.stringify(marker)}) && ${JSON.stringify(scenario === 'parent exit')}) { clearInterval(timer); process.exit(0); } }, 5);`;
            const options = {
                command: process.execPath,
                args: ['-e', parent],
                profile: 'focused',
                availableMemoryBytes: abundantMemoryBytes,
                maxRssBytes: 512 * 1024 ** 2,
                admissionRoot: root,
                storageRoot: join(root, 'storage'),
                diskReserveBytes: 1,
            };
            const supervisor = spawn(
                process.execPath,
                [
                    '--input-type=module',
                    '-e',
                    `const { writeFileSync } = await import('node:fs'); const { runGuardedCommand } = await import(${JSON.stringify(guardPath)}); const result = await runGuardedCommand(${JSON.stringify(options)}); writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(result));`,
                ],
                { stdio: 'ignore' }
            );
            const supervisorPid = supervisor.pid;
            expect(supervisorPid).toBeDefined();
            if (supervisorPid === undefined) {
                throw new Error('storage fixture supervisor did not start');
            }
            childPids.add(supervisorPid);
            await waitUntil(() => existsSync(marker));
            const started: { pid: number; tmp: string } = JSON.parse(readFileSync(marker, 'utf8'));
            const rootPid = Number(readFileSync(rootMarker, 'utf8'));
            childPids.add(started.pid);
            childPids.add(rootPid);
            const startedAt = execFileSync('ps', ['-p', String(started.pid), '-o', 'lstart='], {
                encoding: 'utf8',
            }).trim();
            expect(startedAt).not.toBe('');
            if (scenario === 'supervisor crash') {
                expect(readOwner(started.tmp).tracked.some((identity) => identity.pid === started.pid)).toBe(false);
                await kill(supervisorPid);
                await kill(rootPid);
            } else {
                await waitUntil(() => existsSync(resultPath) && !isAlive(supervisorPid));
            }
            const alive = isAlive(started.pid);
            const tempExists = existsSync(started.tmp);
            console.log(JSON.stringify({ scenario, program, pid: started.pid, startedAt, alive, tempExists }));
            expect(alive && !tempExists).toBe(false);
            if (alive) {
                if (scenario === 'parent exit') {
                    expect(JSON.parse(readFileSync(resultPath, 'utf8')).reason).toBe('leak');
                }
                expect((await guarded(root)).code).toBe(0);
                expect(existsSync(started.tmp)).toBe(true);
                await kill(started.pid);
            }
            const recovery = await guarded(root);
            expect(recovery.code).toBe(0);
            expect(isAlive(started.pid)).toBe(false);
            if (existsSync(started.tmp)) {
                console.log(
                    JSON.stringify({
                        retainedAfterExit: true,
                        scenario,
                        program,
                        recoveryReason: recovery.reason,
                        evidence: recovery.output.slice(-512),
                    })
                );
            }
            expect(existsSync(started.tmp)).toBe(false);
        },
        15_000
    );

    it.each([
        { consumer: 'cwd', scenario: 'parent exit' },
        { consumer: 'open file', scenario: 'parent exit' },
        { consumer: 'cwd', scenario: 'supervisor crash' },
        { consumer: 'open file', scenario: 'supervisor crash' },
        { consumer: 'cwd', scenario: 'moved claim' },
        { consumer: 'open file', scenario: 'moved claim' },
    ] as const)(
        'retains hidden temp users: $consumer after $scenario',
        async ({ consumer, scenario }) => {
            const root = fixture();
            const marker = join(root, 'hidden.json');
            const heartbeat = join(root, 'heartbeat');
            const rootMarker = join(root, 'root.pid');
            const resultPath = join(root, 'result.json');
            const descendant = `const fs=require('node:fs'); const tmp=process.cwd(); const fd=fs.openSync('held','w'); ${consumer === 'open file' ? "process.chdir('/');" : 'fs.closeSync(fd);'} fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,tmp})); let n=0; setInterval(()=>{${consumer === 'open file' ? "fs.writeSync(fd,'x');" : "fs.writeFileSync('held',String(n));"} fs.writeFileSync(${JSON.stringify(heartbeat)},String(++n));},50);`;
            const parent = `const fs=require('node:fs'); fs.writeFileSync(${JSON.stringify(rootMarker)},String(process.pid)); setTimeout(()=>{const child=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{detached:true,stdio:'ignore',cwd:process.env.TMPDIR,env:{PATH:process.env.PATH}});child.unref();},375); setInterval(()=>{if(fs.existsSync(${JSON.stringify(marker)})&&${scenario === 'parent exit'})process.exit(0)},5);`;
            const options = {
                command: process.execPath,
                args: ['-e', parent],
                profile: 'focused',
                availableMemoryBytes: abundantMemoryBytes,
                maxRssBytes: 512 * 1024 ** 2,
                admissionRoot: root,
                storageRoot: join(root, 'storage'),
                diskReserveBytes: 1,
            };
            const supervisor = spawn(
                process.execPath,
                [
                    '--input-type=module',
                    '-e',
                    `const {writeFileSync}=await import('node:fs');const {runGuardedCommand}=await import(${JSON.stringify(guardPath)});const result=await runGuardedCommand(${JSON.stringify(options)});writeFileSync(${JSON.stringify(resultPath)},JSON.stringify(result));`,
                ],
                { stdio: 'ignore' }
            );
            const supervisorPid = supervisor.pid;
            if (supervisorPid === undefined) {
                throw new Error('hidden temp supervisor did not start');
            }
            childPids.add(supervisorPid);
            await waitUntil(() => existsSync(marker));
            const started: { pid: number; tmp: string } = JSON.parse(readFileSync(marker, 'utf8'));
            childPids.add(started.pid);
            const rootPid = Number(readFileSync(rootMarker, 'utf8'));
            childPids.add(rootPid);
            const owner = scenario === 'parent exit' ? undefined : readOwner(started.tmp);
            if (scenario === 'parent exit') {
                await waitUntil(() => existsSync(resultPath) && !isAlive(supervisorPid));
            } else {
                await kill(supervisorPid);
                await kill(rootPid);
            }
            let currentTemp = started.tmp;
            if (scenario === 'moved claim') {
                if (owner === undefined) {
                    throw new Error('missing owned claim fixture');
                }
                let checks = 0;
                expect(
                    reclaimGuardStorage({
                        root: join(root, 'storage'),
                        owner,
                        reclaimer: fakeReclaimer,
                        canRemove: () => checks++ === 0,
                    })
                ).toBe(false);
                const payloads = claimPayloads(join(root, 'storage'));
                expect(payloads).toHaveLength(1);
                currentTemp = join(payloads[0] ?? '', 'tmp');
            }
            await waitUntil(() => existsSync(heartbeat) && Number(readFileSync(heartbeat, 'utf8')) >= 2);
            expect(isAlive(started.pid)).toBe(true);
            const tick = Number(readFileSync(heartbeat, 'utf8'));
            console.log(
                JSON.stringify({
                    consumer,
                    scenario,
                    pid: started.pid,
                    alive: isAlive(started.pid),
                    tempExists: existsSync(currentTemp),
                    tick,
                })
            );
            expect(existsSync(currentTemp)).toBe(true);
            expect((await guarded(root)).code).toBe(0);
            expect(isAlive(started.pid)).toBe(true);
            expect(existsSync(currentTemp)).toBe(true);
            await waitUntil(() => Number(readFileSync(heartbeat, 'utf8')) > tick);
            await kill(started.pid);
            const recovery = await guarded(root);
            expect(recovery.code).toBe(0);
            if (existsSync(currentTemp)) {
                console.log(
                    JSON.stringify({
                        retainedAfterExit: true,
                        consumer,
                        scenario,
                        evidence: recovery.output.slice(-512),
                    })
                );
            }
            expect(existsSync(currentTemp)).toBe(false);
        },
        20_000
    );

    it('treats an exit-zero empty process census as unavailable monitoring evidence and retains live storage', async () => {
        const root = fixture();
        const marker = join(root, 'empty.json');
        const resultPath = join(root, 'result.json');
        const bin = join(root, 'bin');
        mkdirSync(bin);
        const fakePs = join(bin, 'ps');
        writeFileSync(
            fakePs,
            `#!/bin/sh\ncase "$*" in\n *"pid=,ppid=,pgid=,rss=,command="*) if [ -f '${marker.replaceAll("'", "'\\''")}' ]; then exit 0; fi ;;\nesac\nexec /bin/ps "$@"\n`
        );
        chmodSync(fakePs, 0o700);
        const descendant = `require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,tmp:require('node:os').tmpdir()}));setInterval(()=>{},1000)`;
        const parent = `setTimeout(()=>{const child=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{detached:true,stdio:'ignore',env:{TMPDIR:process.env.TMPDIR,TMP:process.env.TMP,TEMP:process.env.TEMP,PATH:process.env.PATH}});child.unref()},375);setTimeout(()=>process.exit(0),1500)`;
        const options = {
            command: process.execPath,
            args: ['-e', parent],
            profile: 'focused',
            availableMemoryBytes: abundantMemoryBytes,
            maxRssBytes: 512 * 1024 ** 2,
            admissionRoot: root,
            storageRoot: join(root, 'storage'),
            diskReserveBytes: 1,
        };
        const supervisor = spawn(
            process.execPath,
            [
                '--input-type=module',
                '-e',
                `const {writeFileSync}=await import('node:fs');const {runGuardedCommand}=await import(${JSON.stringify(guardPath)});const result=await runGuardedCommand(${JSON.stringify(options)});writeFileSync(${JSON.stringify(resultPath)},JSON.stringify(result));`,
            ],
            { stdio: 'ignore', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } }
        );
        if (supervisor.pid === undefined) {
            throw new Error('empty census supervisor did not start');
        }
        childPids.add(supervisor.pid);
        await waitUntil(() => existsSync(marker));
        const started: { pid: number; tmp: string } = JSON.parse(readFileSync(marker, 'utf8'));
        childPids.add(started.pid);
        // Unknown-tree monitor cleanup includes the guard's 7s wait and two 2s cleanup waits.
        await waitUntil(() => existsSync(resultPath), 15_000);
        const result = JSON.parse(readFileSync(resultPath, 'utf8'));
        console.log(
            JSON.stringify({
                reason: result.reason,
                code: result.code,
                alive: isAlive(started.pid),
                tempExists: existsSync(started.tmp),
            })
        );
        expect(isAlive(started.pid)).toBe(true);
        expect(existsSync(started.tmp)).toBe(true);
        expect(result.reason).toBe('monitor');
        expect(result.code).not.toBe(0);
        await kill(started.pid);
        expect((await guarded(root)).code).toBe(0);
        expect(existsSync(started.tmp)).toBe(false);
    }, 20_000);

    it('gives a nested guard its own temp and reserve without cleaning the live parents temp', async () => {
        const root = fixture();
        const nestedOptions = {
            command: process.execPath,
            args: ['-e', "console.log(require('node:os').tmpdir())"],
            profile: 'focused',
            availableMemoryBytes: abundantMemoryBytes,
            maxRssBytes: 512 * 1024 ** 2,
            admissionRoot: root,
            storageRoot: join(root, 'storage'),
        };
        const result = await guarded(root, {
            diskReserveBytes: 123 * 1024 ** 2,
            args: [
                '--input-type=module',
                '-e',
                `import { tmpdir } from 'node:os'; import { existsSync } from 'node:fs'; const parent = tmpdir(); const { runGuardedCommand } = await import(${JSON.stringify(guardPath)}); const result = await runGuardedCommand(${JSON.stringify(nestedOptions)}); console.log(JSON.stringify({ parent, nested: result.output, nestedCode: result.code, parentExists: existsSync(parent), nestedExists: existsSync(result.output), reserve: process.env.${DISK_RESERVE_ENV} }));`,
            ],
        });
        expect(result.code).toBe(0);
        expect(result.reason).toBeUndefined();
        const observed: {
            parent: string;
            nested: string;
            nestedCode: number;
            parentExists: boolean;
            nestedExists: boolean;
            reserve: string;
        } = JSON.parse(result.output);
        expect(observed.nestedCode).toBe(0);
        expect(observed.nested).not.toBe(observed.parent);
        expect(observed.parentExists).toBe(true);
        expect(observed.nestedExists).toBe(false);
        expect(observed.reserve).toBe('123');
        expect(existsSync(observed.parent)).toBe(false);
    }, 15_000);
});

describe('storage ownership recovery', () => {
    it.skipIf(process.platform !== 'darwin').each([
        { scenario: 'valid replacement reclaims', persistent: false, consumer: false, released: true },
        { scenario: 'live consumer replacement retains', persistent: false, consumer: true, released: false },
        { scenario: 'persistent missing type retains', persistent: true, consumer: false, released: false },
    ])(
        'takes bounded fresh file proof for a missing descriptor type: $scenario',
        async ({ persistent, consumer, released }) => {
            const root = fixture();
            const bin = join(root, 'bin');
            mkdirSync(bin);
            const count = join(root, 'samples');
            const utility = join(bin, 'lsof');
            writeFileSync(
                utility,
                `#!/bin/sh\nif ${persistent ? 'true' : `[ ! -e '${count}' ]`}; then\n echo incomplete >> '${count}'\n printf 'p1\\0\\nf3\\0n/not-owned\\0\\n'\nelse\n echo complete >> '${count}'\n exec /usr/sbin/lsof "$@"\nfi\n`
            );
            chmodSync(utility, 0o700);
            const resultPath = join(root, 'result.json');
            const program = `
            const {writeFileSync,existsSync}=await import('node:fs');
            const {spawn}=await import('node:child_process');
            const {createGuardStorage}=await import(${JSON.stringify(storagePath)});
            const {storageFileState}=await import(${JSON.stringify(guardPath)});
            const ports={identityState:()=> 'dead',sessionState:(_owner,original,current=original)=>storageFileState([original,current],[])};
            const storage=createGuardStorage({root:${JSON.stringify(join(root, 'storage'))},token:${JSON.stringify(randomUUID())},owner:${JSON.stringify(fakeOwner)},ports});
            let holder;let closed;
            try {
                if(${consumer}) {
                    holder=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:storage.tempDirectory,stdio:'ignore'});
                    closed=new Promise(resolve=>holder.once('close',resolve));
                    await new Promise((resolve,reject)=>{holder.once('spawn',resolve);holder.once('error',reject)});
                }
                const released=await storage.release(true);
                writeFileSync(${JSON.stringify(resultPath)},JSON.stringify({released,exists:existsSync(storage.tempDirectory)}));
            } finally {if(holder){holder.kill('SIGKILL');await closed}}
        `;
            const supervisor = spawn(process.execPath, ['--input-type=module', '-e', program], {
                cwd: root,
                stdio: 'ignore',
                env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
            });
            if (supervisor.pid === undefined) {
                throw new Error('missing-type proof fixture did not start');
            }
            childPids.add(supervisor.pid);
            await waitUntil(() => existsSync(resultPath) && !isAlive(supervisor.pid ?? -1));
            expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toEqual({ released, exists: !released });
            const samples = readFileSync(count, 'utf8').trim().split('\n');
            expect(samples.slice(0, 2)).toEqual(persistent ? ['incomplete', 'incomplete'] : ['incomplete', 'complete']);
            expect(samples.length).toBe(released ? 3 : 2);
        },
        15_000
    );

    it.skipIf(process.platform !== 'darwin')(
        'reclaims storage after an unreaped same-UID consumer has exited',
        async () => {
            const root = fixture();
            const ports: StorageRecoveryPorts = {
                identityState: () => 'dead',
                sessionState: (_owner, original, current = original) => storageFileState([original, current], []),
            };
            const storage = ownedStorage(join(root, 'storage'), ports);
            const marker = join(root, 'unreaped.pid');
            const owner = spawn(
                process.execPath,
                [
                    '-e',
                    `const child=require('node:child_process').spawn(process.execPath,['-e',"require('node:fs').openSync('held','w');process.exit(0)"],{cwd:${JSON.stringify(storage.tempDirectory)},stdio:'ignore'});require('node:fs').writeFileSync(${JSON.stringify(marker)},String(child.pid));Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,8000)`,
                ],
                { cwd: root, stdio: 'ignore' }
            );
            if (owner.pid === undefined) {
                throw new Error('unreaped consumer parent did not start');
            }
            childPids.add(owner.pid);
            await waitUntil(() => existsSync(marker));
            const pid = Number(readFileSync(marker, 'utf8'));
            childPids.add(pid);
            await waitUntil(() => {
                const snapshot = execFileSync('ps', ['-p', String(pid), '-o', 'uid=,stat='], { encoding: 'utf8' });
                return new RegExp(`^\\s*${process.getuid?.()}\\s+Z`).test(snapshot);
            });
            expect(isAlive(pid)).toBe(true);
            expect(existsSync(join(storage.tempDirectory, 'held'))).toBe(true);
            expect(await storage.release(true)).toBe(true);
            expect(existsSync(storage.tempDirectory)).toBe(false);
        },
        15_000
    );

    it('admits only complete same-UID evidence and retains ambiguous or observed cross-UID owners', () => {
        const output = '10 501\n11 501\n12 0\n';
        expect(sameUserProcessIds(output, 501, 10, [11])).toEqual([10, 11]);
        expect(sameUserProcessIds(output, 501, 10, [12])).toBeUndefined();
        expect(sameUserProcessIds('10 501\n11 ?\n', 501, 10, [11])).toBeUndefined();
        expect(sameUserProcessIds('11 501\n', 501, 10, [])).toBeUndefined();
        expect(sameUserProcessIds('10 501\n10 501\n', 501, 10, [])).toBeUndefined();
        expect(sameUserProcessIds('', 501, 10, [])).toBeUndefined();
    });

    it('parses complete NUL file records and rejects malformed, truncated or opaque file evidence', () => {
        const valid = 'p10\0\nfcwd\0tDIR\0n/owned/tmp\0\nf3\0tREG\0n/owned/tmp/held\0\n';
        expect(parseLsofCensus(valid)).toEqual({ pids: new Set([10]), paths: ['/owned/tmp', '/owned/tmp/held'] });
        expect(parseLsofCensus('p10\0\nftwd\0tDIR\0n/owned/tmp\0\n')).toEqual({
            pids: new Set([10]),
            paths: ['/owned/tmp'],
        });
        const missingType = 'p10\0\nf3\0n/owned/tmp/held\0\n';
        const reasons: string[] = [];
        expect(parseLsofCensus(missingType, (reason) => reasons.push(reason))).toBeUndefined();
        expect(reasons).toEqual(['descriptor-type-missing']);
        for (const invalid of [
            `${missingType}f4\0tunknown\0n/owned/tmp\0\n`,
            `${missingType}f4\0tREG\0\n`,
            'p10\0\nf3\0\n',
            'p10\0\nf3\0nPermission denied\0\n',
        ]) {
            let reason: string | undefined;
            expect(
                parseLsofCensus(invalid, (value) => {
                    reason = value;
                })
            ).toBeUndefined();
            expect(reason).not.toBe('descriptor-type-missing');
        }
        for (const invalid of [
            '',
            'p10\0\n',
            valid.slice(0, -1),
            'p10\0\nfNOFD\0tDIR\0n/denied\0\n',
            'p10\0\nf3\0tREG\0\n',
            'p10\0\nf3\0tunknown\0n/owned/tmp\0\n',
        ]) {
            expect(parseLsofCensus(invalid)).toBeUndefined();
        }
        expect(referencesStoragePath('/owned/tmp/held', ['/owned/tmp'])).toBe(true);
        expect(referencesStoragePath('/claim/run/tmp/held (deleted)', ['/owned/tmp', '/claim/run/tmp'])).toBe(true);
        expect(referencesStoragePath('/owned/tmp-sibling/held', ['/owned/tmp'])).toBe(false);
    });

    it.skipIf(process.platform !== 'darwin').each([
        { scenario: 'unavailable utility', script: 'exit 127' },
        { scenario: 'malformed output', script: "printf 'malformed'" },
        { scenario: 'partial coverage', script: "printf 'p1\\0\\nfcwd\\0tDIR\\0n/\\0\\n'" },
        { scenario: 'permission diagnostic', script: "printf 'permission denied' >&2; exit 0" },
    ])(
        'retains owned payload for incomplete file census: $scenario',
        async ({ script }) => {
            const root = fixture();
            const bin = join(root, 'bin');
            mkdirSync(bin);
            const utility = join(bin, 'lsof');
            writeFileSync(utility, `#!/bin/sh\n${script}\n`);
            chmodSync(utility, 0o700);
            const marker = join(root, 'utility.json');
            const resultPath = join(root, 'result.json');
            const options = {
                command: process.execPath,
                args: [
                    '-e',
                    `require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({tmp:require('node:os').tmpdir()}))`,
                ],
                profile: 'focused',
                availableMemoryBytes: abundantMemoryBytes,
                maxRssBytes: 512 * 1024 ** 2,
                admissionRoot: root,
                storageRoot: join(root, 'storage'),
                diskReserveBytes: 1,
            };
            const supervisor = spawn(
                process.execPath,
                [
                    '--input-type=module',
                    '-e',
                    `const {writeFileSync}=await import('node:fs');const {runGuardedCommand}=await import(${JSON.stringify(guardPath)});const result=await runGuardedCommand(${JSON.stringify(options)});writeFileSync(${JSON.stringify(resultPath)},JSON.stringify(result));`,
                ],
                { stdio: 'ignore', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } }
            );
            if (supervisor.pid === undefined) {
                throw new Error('file census supervisor did not start');
            }
            childPids.add(supervisor.pid);
            await waitUntil(() => existsSync(resultPath) && !isAlive(supervisor.pid ?? -1));
            const started: { tmp: string } = JSON.parse(readFileSync(marker, 'utf8'));
            const result = JSON.parse(readFileSync(resultPath, 'utf8'));
            expect(result.reason).toBe('leak');
            expect(result.code).toBe(0);
            expect(
                await main(['--profile', 'focused', '--', process.execPath], {
                    cwd: root,
                    detectLane: () => undefined,
                    assertModulesPreflight: () => {},
                    runCommand: async () => result,
                    log: () => {},
                    error: () => {},
                })
            ).not.toBe(0);
            expect(existsSync(started.tmp)).toBe(true);
            expect((await guarded(root)).code).toBe(0);
            expect(existsSync(started.tmp)).toBe(false);
        },
        15_000
    );

    it('vetoes local deletion and crash recovery for temp references on raw census continuation lines', async () => {
        const root = fixture();
        let processOutput: string | undefined;
        const ports: StorageRecoveryPorts = {
            identityState: () => 'dead',
            sessionState: (_owner, tempDirectory) => storageReferenceState(processOutput, tempDirectory),
        };
        const storage = ownedStorage(root, ports);
        processOutput = `123 1 123 4096 node -e firstLine\nsecondLine TMPDIR=${storage.tempDirectory}`;
        expect(processOutput.split('\n')[0]).not.toContain(storage.tempDirectory);
        expect(await storage.release(true)).toBe(false);
        expect(existsSync(storage.tempDirectory)).toBe(true);
        recoverGuardStorage(root, ports, fakeReclaimer);
        expect(existsSync(storage.tempDirectory)).toBe(true);

        processOutput = undefined;
        recoverGuardStorage(root, ports, fakeReclaimer);
        expect(existsSync(storage.tempDirectory)).toBe(true);
        processOutput = '';
        recoverGuardStorage(root, ports, fakeReclaimer);
        expect(existsSync(storage.tempDirectory)).toBe(true);
        processOutput = '123 1 123 4096 node -e completed';
        recoverGuardStorage(root, ports, fakeReclaimer);
        expect(existsSync(storage.tempDirectory)).toBe(false);
    });

    it('keeps crash recovery unknown while allowing local tracked-tree cleanup under explicit platform policy', async () => {
        const root = fixture();
        const ports: StorageRecoveryPorts = {
            identityState: () => 'dead',
            sessionState: () => 'unknown',
            localReleaseAllowed: () => true,
        };
        const storage = ownedStorage(root, ports);
        storage.recordProcesses(fakeReclaimer, new Map());
        const record = readOwner(storage.tempDirectory);

        recoverGuardStorage(root, ports, fakeReclaimer);
        expect(existsSync(storage.tempDirectory)).toBe(true);
        expect(await storage.release(false)).toBe(false);
        expect(existsSync(storage.tempDirectory)).toBe(true);
        expect(await storage.release(true)).toBe(true);
        expect(existsSync(storage.tempDirectory)).toBe(false);
        expect(ports.sessionState(record, storage.tempDirectory)).toBe('unknown');
    });

    it('preserves live owners, live descendants and unavailable census, then reclaims a proven dead run', () => {
        const root = fixture();
        const storage = ownedStorage(root);
        let ownerState: ReturnType<StorageRecoveryPorts['identityState']> = 'alive';
        let sessionState: ReturnType<StorageRecoveryPorts['sessionState']> = 'dead';
        const ports: StorageRecoveryPorts = { identityState: () => ownerState, sessionState: () => sessionState };
        recoverGuardStorage(root, ports, fakeReclaimer);
        expect(existsSync(storage.tempDirectory)).toBe(true);
        ownerState = 'dead';
        sessionState = 'alive';
        recoverGuardStorage(root, ports, fakeReclaimer);
        expect(existsSync(storage.tempDirectory)).toBe(true);
        sessionState = 'unknown';
        recoverGuardStorage(root, ports, fakeReclaimer);
        expect(existsSync(storage.tempDirectory)).toBe(true);
        sessionState = 'dead';
        recoverGuardStorage(root, ports, fakeReclaimer);
        expect(existsSync(storage.tempDirectory)).toBe(false);
    });

    it('preserves unowned, malformed, rebound and symlinked storage plus uncertain PID identity', () => {
        const root = fixture();
        const foreign = join(root, 'foreign');
        mkdirSync(foreign);
        writeFileSync(join(foreign, 'keep'), 'foreign');
        const storage = ownedStorage(root);
        const ownerPath = join(dirname(storage.tempDirectory), 'owner.json');
        const original = readFileSync(ownerPath, 'utf8');
        for (const corrupt of [
            '{',
            JSON.stringify({ ...readOwner(storage.tempDirectory), token: randomUUID() }),
            JSON.stringify({ ...readOwner(storage.tempDirectory), directoryIdentity: '1:1' }),
        ]) {
            writeFileSync(ownerPath, corrupt);
            recoverGuardStorage(root, deadPorts, fakeReclaimer);
            expect(existsSync(storage.tempDirectory)).toBe(true);
            writeFileSync(ownerPath, original);
        }
        recoverGuardStorage(root, { ...deadPorts, identityState: () => 'unknown' }, fakeReclaimer);
        expect(existsSync(storage.tempDirectory)).toBe(true);
        rmSync(ownerPath);
        symlinkSync(join(foreign, 'keep'), ownerPath);
        symlinkSync(foreign, join(root, randomUUID()));
        mkdirSync(join(root, randomUUID()));
        recoverGuardStorage(root, deadPorts, fakeReclaimer);
        expect(existsSync(storage.tempDirectory)).toBe(true);
        expect(readFileSync(join(foreign, 'keep'), 'utf8')).toBe('foreign');
        const rootLink = join(fixture(), 'root-link');
        symlinkSync(foreign, rootLink);
        expect(() => recoverGuardStorage(rootLink, deadPorts, fakeReclaimer)).toThrow(/real directory/);
    });

    it('preserves a live reclaimer and safely recovers the same payload after two reclaimer crashes', () => {
        const root = fixture();
        const storage = ownedStorage(root);
        const owner = readOwner(storage.tempDirectory);
        writeFileSync(join(storage.tempDirectory, 'payload'), 'owned');
        let checks = 0;
        expect(reclaimGuardStorage({ root, owner, reclaimer: fakeReclaimer, canRemove: () => checks++ === 0 })).toBe(
            false
        );
        expect(existsSync(storage.tempDirectory)).toBe(false);
        expect(claimPayloads(root)).toHaveLength(1);
        recoverGuardStorage(
            root,
            { ...deadPorts, identityState: (identity) => (identity.pid === fakeReclaimer.pid ? 'alive' : 'dead') },
            fakeOwner
        );
        expect(claimPayloads(root)).toHaveLength(1);
        let secondChecks = 0;
        recoverGuardStorage(
            root,
            { ...deadPorts, sessionState: () => (secondChecks++ < 2 ? 'dead' : 'unknown') },
            fakeOwner
        );
        expect(claimPayloads(root)).toHaveLength(1);
        recoverGuardStorage(root, deadPorts, fakeReclaimer);
        expect(claimPayloads(root)).toEqual([]);
        expect(readdirSync(join(root, '.claims'))).toEqual([]);
    });

    it('rechecks supervisor liveness immediately before claiming a run', () => {
        const root = fixture();
        const storage = ownedStorage(root);
        let checks = 0;
        recoverGuardStorage(
            root,
            { ...deadPorts, identityState: () => (checks++ === 0 ? 'dead' : 'alive') },
            fakeReclaimer
        );
        expect(existsSync(storage.tempDirectory)).toBe(true);
        expect(claimPayloads(root)).toEqual([]);
    });

    it('serializes competing real scavengers with atomic payload claims and preserves an unowned sibling', async () => {
        const root = fixture();
        const storage = ownedStorage(root);
        const foreign = join(root, 'foreign');
        mkdirSync(foreign);
        writeFileSync(join(foreign, 'keep'), 'foreign');
        const code = `const { recoverGuardStorage } = await import(${JSON.stringify(storagePath)}); recoverGuardStorage(${JSON.stringify(root)}, { identityState: (identity) => { if (identity.pid === ${fakeOwner.pid}) return 'dead'; try { process.kill(identity.pid, 0); return 'alive'; } catch { return 'dead'; } }, sessionState: () => 'dead' }, { pid: process.pid, startedAt: 'test-reclaimer' });`;
        const children: ChildProcess[] = [
            spawn(process.execPath, ['--input-type=module', '-e', code]),
            spawn(process.execPath, ['--input-type=module', '-e', code]),
        ];
        const exits = await Promise.all(
            children.map(
                (child) =>
                    new Promise<number | null>((resolve, reject) => {
                        child.once('error', reject);
                        child.once('close', resolve);
                    })
            )
        );
        expect(exits).toEqual([0, 0]);
        expect(existsSync(storage.tempDirectory)).toBe(false);
        expect(readFileSync(join(foreign, 'keep'), 'utf8')).toBe('foreign');
        expect(claimPayloads(root)).toEqual([]);
    });
});

describe('disk reserve contract', () => {
    it('uses a 20 GiB default and refuses unavailable, invalid and throwing disk samples', () => {
        expect(DEFAULT_DISK_RESERVE_BYTES).toBe(20 * 1024 ** 3);
        for (const sample of [undefined, Number.NaN, -1, Number.POSITIVE_INFINITY]) {
            expect(diskStorageFailure(['/'], 1, () => sample)?.reason).toBe('monitor');
        }
        expect(
            diskStorageFailure(['/'], 1, () => {
                throw new Error('statfs failed');
            })?.reason
        ).toBe('monitor');
        expect(diskStorageFailure(['/'], 100, () => 100)).toBeUndefined();
    });

    it('accepts a bounded CLI reserve and forwards it through normal invocation', async () => {
        expect(parseCliArgs(['--disk-reserve-mib', '123', '--', 'node']).diskReserveBytes).toBe(123 * 1024 ** 2);
        for (const value of ['0', '-1', 'NaN', '1.5', '9007199254740991']) {
            expect(() => parseCliArgs(['--disk-reserve-mib', value, '--', 'node'])).toThrow(/disk-reserve-mib/);
        }
        let observed: number | undefined;
        const code = await main(['--disk-reserve-mib', '123', '--', 'node'], {
            cwd: fixture(),
            detectLane: () => undefined,
            assertModulesPreflight: () => undefined,
            runCommand: async (input) => {
                observed = input.diskReserveBytes;
                return {
                    code: 0,
                    signal: null,
                    output: '',
                    omittedBytes: 0,
                    peakRssBytes: 0,
                    maxRssBytes: 512 * 1024 ** 2,
                    durationMs: 0,
                };
            },
        });
        expect(code).toBe(0);
        expect(observed).toBe(123 * 1024 ** 2);
    });
});
