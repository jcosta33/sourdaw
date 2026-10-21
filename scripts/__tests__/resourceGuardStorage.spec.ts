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
    statSync,
    writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
    main,
    parseCliArgs,
    runGuardedCommand,
    storageFileState,
    readStorageDescriptor,
    linuxStorageFileState,
    linuxStorageFileCensus,
    linuxFilePorts,
    parseLinuxFileSnapshot,
    parseLinuxStartTicks,
    startTimeExcuseSupervisor,
} from '../resourceGuard';
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
    type StorageProcessIdentity,
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

async function waitForStorageAbandonment(tempDirectories: string[], deadline: number): Promise<void> {
    let lastState = 'unknown';
    let lastReason = 'not sampled';
    try {
        await waitUntil(
            () => {
                if (Date.now() > deadline) {
                    return false;
                }
                lastReason = 'no diagnostic';
                // This test process supervised every fixture run whose storage is checked.
                lastState = storageFileState(
                    tempDirectories,
                    [],
                    (reason) => {
                        lastReason = reason;
                    },
                    process.pid
                );
                if (Date.now() > deadline) {
                    return false;
                }
                return lastState === 'dead';
            },
            Math.max(0, deadline - Date.now())
        );
    } catch (error) {
        const outcome = Date.now() > deadline ? 'timed out' : 'failed';
        throw new Error(`storage fixture abandonment proof ${outcome}: ${lastState}: ${lastReason}`, { cause: error });
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

function proofDiagnostic(result: Awaited<ReturnType<typeof runGuardedCommand>>): string {
    return JSON.stringify({
        reason: result.reason ?? 'none',
        evidence: result.output
            .split('\n')
            .filter((line) => line.startsWith('guard storage'))
            .slice(-4)
            .join('\n')
            .slice(0, 2048),
    });
}

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

async function runMarkedGuard(root: string): Promise<{
    result: Awaited<ReturnType<typeof runGuardedCommand>>;
    tempDirectory: string;
    token: string;
    pid: number;
    supervisorPid: number;
    ownerPid: number;
}> {
    const run = randomUUID();
    const marker = join(root, `guard-${run}.json`);
    const preparedResult = join(root, `guard-${run}.pending`);
    const resultPath = join(root, `guard-${run}.result.json`);
    const options: Parameters<typeof runGuardedCommand>[0] = {
        command: process.execPath,
        args: [
            '-e',
            `const fs=require('node:fs'),path=require('node:path'),tmp=require('node:os').tmpdir();const owner=JSON.parse(fs.readFileSync(path.join(path.dirname(tmp),'owner.json'),'utf8'));fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,tmp,ownerPid:owner.owner.pid}))`,
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
            `const {writeFileSync,renameSync}=await import('node:fs');const {runGuardedCommand}=await import(${JSON.stringify(guardPath)});const result=await runGuardedCommand(${JSON.stringify(options)});writeFileSync(${JSON.stringify(preparedResult)},JSON.stringify(result));renameSync(${JSON.stringify(preparedResult)},${JSON.stringify(resultPath)});`,
        ],
        { stdio: 'ignore' }
    );
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        supervisor.once('error', reject);
        supervisor.once('close', (code, signal) => resolve({ code, signal }));
    });
    const supervisorPid = supervisor.pid;
    if (supervisorPid !== undefined) {
        childPids.add(supervisorPid);
    }
    const exit = await closed;
    let observed: { pid: number; tmp: string; ownerPid: number } | undefined;
    if (existsSync(marker)) {
        observed = JSON.parse(readFileSync(marker, 'utf8'));
    }
    if (observed !== undefined) {
        childPids.add(observed.pid);
    }
    if (supervisorPid === undefined || exit.code !== 0 || exit.signal !== null) {
        throw new Error(
            `marked guard supervisor failed: pid=${supervisorPid ?? 'missing'} code=${exit.code} signal=${exit.signal}`
        );
    }
    if (observed === undefined || !existsSync(resultPath)) {
        throw new Error('marked guard child marker or complete supervisor result is missing');
    }
    const result: Awaited<ReturnType<typeof runGuardedCommand>> = JSON.parse(readFileSync(resultPath, 'utf8'));
    expect(isAlive(observed.pid)).toBe(false);
    expect(isAlive(supervisorPid)).toBe(false);
    const token = basename(dirname(observed.tmp));
    expect(observed.tmp).toBe(join(root, 'storage', token, 'tmp'));
    return {
        result,
        tempDirectory: observed.tmp,
        token,
        pid: observed.pid,
        supervisorPid,
        ownerPid: observed.ownerPid,
    };
}

function retainedStorageTokens(root: string): { direct: string[]; claims: string[] } {
    const storageRoot = join(root, 'storage');
    const direct = readdirSync(storageRoot)
        .filter((name) => name !== '.claims')
        .map((token) => {
            expect(readOwner(join(storageRoot, token, 'tmp')).token).toBe(token);
            return token;
        });
    const claims = claimPayloads(storageRoot).map((payload) => {
        const token = readOwner(join(payload, 'tmp')).token;
        expect(basename(payload)).toBe(token);
        return token;
    });
    return { direct, claims };
}

type PriorMarkedGuard = { tempDirectory: string; token: string; supervisorPid?: number };

function expectMarkedRecovery(
    root: string,
    prior: PriorMarkedGuard[],
    fresh: Awaited<ReturnType<typeof runMarkedGuard>>,
    originalStillLive = false
): void {
    const knownTokens = [...prior.map((run) => run.token), fresh.token];
    expect(new Set(knownTokens).size).toBe(knownTokens.length);
    const diagnostics = fresh.result.output
        .split('\n')
        .filter((line) => line.startsWith('guard storage file-use proof unavailable: '));
    const retained = retainedStorageTokens(root);
    const retainedTokens = [...retained.direct, ...retained.claims];
    console.log(
        JSON.stringify({
            recovery: fresh.result,
            firstDiagnostic: diagnostics[0] ?? null,
            originalToken: prior[0]?.token,
            freshToken: fresh.token,
            freshSupervisorPid: fresh.supervisorPid,
            freshOwnerPid: fresh.ownerPid,
            priorTokens: prior.map((run) => run.token),
            retained,
        })
    );
    expect(fresh.result.code).toBe(0);
    expect(Number.isInteger(fresh.supervisorPid) && fresh.supervisorPid > 0).toBe(true);
    expect(fresh.supervisorPid).not.toBe(process.pid);
    expect(fresh.ownerPid).toBe(fresh.supervisorPid);
    expect(isAlive(fresh.supervisorPid)).toBe(false);
    expect(isAlive(fresh.pid)).toBe(false);
    expect(retainedTokens.every((token) => knownTokens.includes(token))).toBe(true);
    expect(new Set(retainedTokens).size).toBe(retainedTokens.length);
    for (const run of [...prior, fresh]) {
        expect(existsSync(run.tempDirectory)).toBe(retained.direct.includes(run.token));
        if (run.supervisorPid !== undefined) {
            expect(run.supervisorPid).not.toBe(process.pid);
            expect(isAlive(run.supervisorPid)).toBe(false);
        }
    }
    const expectedDiagnostics: unknown[] = [];
    if (diagnostics.length > 0) {
        expectedDiagnostics.push(
            expect.stringMatching(
                /^guard storage file-use proof unavailable: (?:lsof-live-pid-missing:count=[1-9]\d*:pid\/uid\/state=\S+|lsof-fields-unusable:descriptor-type-missing)$/
            )
        );
    }
    expect(diagnostics).toEqual(expectedDiagnostics);
    const freshRetained = retainedTokens.includes(fresh.token);
    if (fresh.result.reason === undefined) {
        expect(freshRetained).toBe(false);
        expect(fresh.result.output).not.toContain('guard storage retained:');
    } else {
        expect(fresh.result.reason).toBe('leak');
        expect(diagnostics).toHaveLength(1);
        expect(fresh.result.output).toContain(
            'guard storage retained: process-tree exit or storage ownership could not be proved'
        );
        // The result records the first failed release; a final cleanup retry can remove its payload.
    }
    if (originalStillLive) {
        expect(retained.direct).toContain(prior[0]?.token);
    } else if (diagnostics.length === 0) {
        expect(fresh.result.reason).toBeUndefined();
        expect(retained.direct).toEqual([]);
        expect(retained.claims).toEqual([]);
    }
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

    it('preserves extensionless require and import scripts in repository-owned temp', async () => {
        expect(JSON.parse(readFileSync(resolve('package.json'), 'utf8')).type).toBe('module');
        const root = fixture();
        const result = await guarded(root, {
            args: [
                '-e',
                `const fs = require('node:fs');
                const path = require('node:path');
                const tmp = require('node:os').tmpdir();
                const scripts = [
                    ['require-probe', 'const fs = require("node:fs"); console.log("require:ok", typeof fs.readFileSync);'],
                    ['import-probe', 'import { readFileSync } from "node:fs"; console.log("import:ok", typeof readFileSync);'],
                ];
                const statuses = scripts.map(([name, source]) => {
                    const file = path.join(tmp, name);
                    fs.writeFileSync(file, '#!/usr/bin/env node\\n' + source + '\\n', { mode: 0o700, flag: 'wx' });
                    const child = require('node:child_process').spawnSync(file, [], { encoding: 'utf8' });
                    process.stdout.write(child.stdout || '');
                    process.stdout.write(child.stderr || '');
                    return child.status;
                });
                const boundary = path.join(tmp, 'package.json');
                console.log(JSON.stringify({ tmp, statuses,
                    package: fs.existsSync(boundary) ? fs.readFileSync(boundary, 'utf8') : null,
                    mode: fs.existsSync(boundary) ? fs.statSync(boundary).mode & 0o777 : null }));
                process.exitCode = statuses.every(status => status === 0) ? 0 : 1;`,
            ],
        });
        expect(result.output).toContain('require:ok function');
        expect(result.output).toContain('import:ok function');
        expect(result.reason).toBeUndefined();
        expect(result.code).toBe(0);
        const observed = JSON.parse(result.output.trim().split('\n').at(-1) ?? '');
        expect(observed.statuses).toEqual([0, 0]);
        expect(observed.package).toBe('{}\n');
        if (process.platform !== 'win32') {
            expect(observed.mode).toBe(0o600);
        }
        expect(observed.tmp.startsWith(`${join(root, 'storage')}/`)).toBe(true);
        expect(existsSync(observed.tmp)).toBe(false);
        expect(existsSync(join(observed.tmp, 'package.json'))).toBe(false);
        expect(existsSync(root)).toBe(true);
    });

    it('contains spawn errors without an unhandled child error and cleans only its run', async () => {
        const root = fixture();
        const foreign = join(root, 'keep');
        writeFileSync(foreign, 'foreign');
        await expect(guarded(root, { command: join(root, 'missing-executable') })).rejects.toThrow(/ENOENT/);
        expect(readdirSync(join(root, 'storage')).filter((name) => !name.startsWith('.'))).toEqual([]);
        expect(readFileSync(foreign, 'utf8')).toBe('foreign');
    });

    it.each([
        {
            scenario: 'successful child and final proof',
            proof: 'complete',
            childExit: 0,
            diskPressure: false,
            reason: undefined,
        },
        {
            scenario: 'nonzero child and final proof',
            proof: 'complete',
            childExit: 7,
            diskPressure: false,
            reason: undefined,
        },
        {
            scenario: 'earlier disk pressure and final proof',
            proof: 'complete',
            childExit: 0,
            diskPressure: true,
            reason: 'pressure',
        },
        {
            scenario: 'persistent incomplete proof',
            proof: 'incomplete',
            childExit: 0,
            diskPressure: false,
            reason: 'leak',
        },
        { scenario: 'persistent thrown proof', proof: 'throws', childExit: 0, diskPressure: false, reason: 'leak' },
    ] as const)(
        'reports final owned-storage disposition for $scenario',
        async ({ proof, childExit, diskPressure, reason }) => {
            const root = fixture();
            const marker = join(root, 'child.json');
            const proofPaths: string[] = [];
            const releases: { treeStopped: boolean; removed?: boolean; threw?: boolean }[] = [];
            const retainedLine = 'guard storage retained: process-tree exit or storage ownership could not be proved';
            let tempExistedWhileAlive = false;
            let tempDirectory: string | undefined;
            let childAction = `process.exitCode=${childExit}`;
            if (diskPressure) {
                childAction = 'setInterval(() => {}, 1000)';
            } else if (childExit === 7) {
                childAction = `process.stdout.write(${JSON.stringify(`${retainedLine}\n`)});${childAction}`;
            }
            const options: Partial<Parameters<typeof runGuardedCommand>[0]> = {
                args: [
                    '-e',
                    `require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,tmp:require('node:os').tmpdir()}));${childAction}`,
                ],
                storageFactory: (input) => {
                    const storage = createGuardStorage({
                        ...input,
                        ports: {
                            ...input.ports,
                            localReleaseAllowed: (_owner, _original, current) => {
                                proofPaths.push(current ?? 'missing');
                                if (proof === 'throws') {
                                    throw new Error('controlled proof unavailable');
                                }
                                return proof === 'complete' && proofPaths.length > 1;
                            },
                        },
                    });
                    tempDirectory = storage.tempDirectory;
                    return {
                        ...storage,
                        release: async (treeStopped) => {
                            try {
                                const removed = await storage.release(treeStopped);
                                releases.push({ treeStopped, removed });
                                return removed;
                            } catch (error) {
                                releases.push({ treeStopped, threw: true });
                                throw error;
                            }
                        },
                    };
                },
            };
            if (diskPressure) {
                options.hostSampleIntervalMs = 20;
                options.sampleIntervalMs = 20;
                options.diskSampler = () => {
                    if (!existsSync(marker)) {
                        return 1000;
                    }
                    const started: { pid: number; tmp: string } = JSON.parse(readFileSync(marker, 'utf8'));
                    tempExistedWhileAlive ||= isAlive(started.pid) && existsSync(started.tmp);
                    return 0;
                };
            }
            const result = await guarded(root, options);
            expect(existsSync(marker)).toBe(true);
            const child: { pid: number; tmp: string } = JSON.parse(readFileSync(marker, 'utf8'));
            childPids.add(child.pid);
            if (diskPressure) {
                expect(tempExistedWhileAlive).toBe(true);
            }
            expect(isAlive(child.pid)).toBe(false);
            expect(child.tmp).toBe(tempDirectory);
            expect(tempDirectory).toBeDefined();
            if (tempDirectory === undefined) {
                throw new Error('guard storage was not created');
            }
            const token = basename(dirname(tempDirectory));
            const retained = proof !== 'complete';
            let expectedReleases: { treeStopped: boolean; removed?: boolean; threw?: boolean }[] = [
                { treeStopped: true, removed: false },
                { treeStopped: true, removed: true },
            ];
            if (proof === 'incomplete') {
                expectedReleases = [
                    { treeStopped: true, removed: false },
                    { treeStopped: true, removed: false },
                ];
            } else if (proof === 'throws') {
                expectedReleases = [
                    { treeStopped: true, threw: true },
                    { treeStopped: true, threw: true },
                ];
            }
            expect(releases).toEqual(expectedReleases);
            expect(proofPaths).toHaveLength(retained ? 2 : 3);
            expect(proofPaths[0]).toBe(join(root, 'storage', token, 'tmp'));
            expect(proofPaths[1]).toBe(proofPaths[0]);
            if (!retained) {
                expect(proofPaths[2]).toContain('/.claims/');
            }
            expect(existsSync(tempDirectory)).toBe(retained);
            const ownerPath = join(dirname(tempDirectory), 'owner.json');
            expect(existsSync(ownerPath)).toBe(retained);
            if (retained) {
                expect(JSON.parse(readFileSync(ownerPath, 'utf8')).token).toBe(token);
            }
            expect(claimPayloads(join(root, 'storage'))).toEqual([]);
            expect(result.code).toBe(diskPressure ? null : childExit);
            expect(result.reason).toBe(reason);
            expect(result.output.split(retainedLine).length - 1).toBe(retained || childExit === 7 ? 1 : 0);
            if (diskPressure) {
                expect(result.output).toContain('disk space below');
            }
        },
        10_000
    );

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
        const deadline = Date.now() + 30_000;
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
        await waitForStorageAbandonment([started.tmp], deadline);
        const recovery = await guarded(root);
        expect(recovery.code, proofDiagnostic(recovery)).toBe(0);
        expect(existsSync(started.tmp), proofDiagnostic(recovery)).toBe(false);
    }, 30_000);

    it.each([
        { scenario: 'parent exit', program: 'single-line program' },
        { scenario: 'supervisor crash', program: 'single-line program' },
        { scenario: 'parent exit', program: 'multiline program' },
        { scenario: 'supervisor crash', program: 'multiline program' },
    ] as const)(
        'retains storage for a detached descendant that replaces its environment: $scenario ($program)',
        async ({ scenario, program }) => {
            const deadline = Date.now() + 15_000;
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
            const originalToken = readOwner(started.tmp).token;
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
            const prior: PriorMarkedGuard[] = [{ tempDirectory: started.tmp, token: originalToken }];
            if (alive) {
                if (scenario === 'parent exit') {
                    expect(JSON.parse(readFileSync(resultPath, 'utf8')).reason).toBe('leak');
                }
                const interim = await runMarkedGuard(root);
                expectMarkedRecovery(root, prior, interim, true);
                prior.push({
                    tempDirectory: interim.tempDirectory,
                    token: interim.token,
                    supervisorPid: interim.supervisorPid,
                });
                expect(isAlive(started.pid)).toBe(true);
                expect(existsSync(started.tmp)).toBe(true);
                await kill(started.pid);
            }
            await waitForStorageAbandonment([started.tmp], deadline);
            const recovery = await runMarkedGuard(root);
            expect(isAlive(started.pid)).toBe(false);
            expectMarkedRecovery(root, prior, recovery);
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
            const deadline = Date.now() + 20_000;
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
            await waitForStorageAbandonment([started.tmp, currentTemp], deadline);
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
            expect(existsSync(currentTemp), proofDiagnostic(recovery)).toBe(false);
        },
        20_000
    );

    async function verifyEmptyProcessCensusAdmission(holdPreparedRecord: boolean): Promise<void> {
        const deadline = Date.now() + 20_000;
        const root = fixture();
        const marker = join(root, 'empty.json');
        const resultPath = join(root, 'result.json');
        const rootMarker = join(root, 'root.pid');
        const childMarker = join(root, 'child.pid');
        const admitted = join(root, 'admission.json');
        const prepared = join(root, 'admission.pending');
        const preparationReady = join(root, 'preparation-ready');
        const publishPrepared = join(root, 'publish-prepared');
        const samplesPath = join(root, 'samples.jsonl');
        const bin = join(root, 'bin');
        mkdirSync(bin);
        const fakePs = join(bin, 'ps');
        writeFileSync(join(bin, 'package.json'), '{}\n');
        writeFileSync(
            fakePs,
            `#!${process.execPath}
const fs=require('node:fs');const {execFileSync}=require('node:child_process');
const args=process.argv.slice(2),marker=${JSON.stringify(marker)},rootMarker=${JSON.stringify(rootMarker)},childMarker=${JSON.stringify(childMarker)};
if(!args.includes('pid=,ppid=,pgid=,rss=,command=')){
 process.stdout.write(execFileSync('/bin/ps',args,{encoding:'utf8'}));
}else if(fs.existsSync(marker)){
 fs.appendFileSync(${JSON.stringify(samplesPath)},JSON.stringify({empty:true})+'\\n');
}else{
 const output=execFileSync('/bin/ps',args,{encoding:'utf8'});
 const rootPid=fs.existsSync(rootMarker)?Number(fs.readFileSync(rootMarker,'utf8')):undefined;
 const rows=output.trimEnd().split('\\n').map(line=>{
  const match=/^\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+/.exec(line);
  if(!match)throw new Error('unusable controlled monitor row');
  return {line,pid:Number(match[1]),parentPid:Number(match[2]),group:Number(match[3])};
 });
 const descendants=new Set();let changed=true;
 while(changed){changed=false;for(const row of rows){if(row.pid!==rootPid&&(row.parentPid===rootPid||descendants.has(row.parentPid))&&!descendants.has(row.pid)){descendants.add(row.pid);changed=true}}}
 const visible=rows.filter(row=>!descendants.has(row.pid));
 const pids=visible.map(row=>row.pid);
 const childPid=fs.existsSync(childMarker)?Number(fs.readFileSync(childMarker,'utf8')):undefined;
 const rootRow=rows.find(row=>row.pid===rootPid);
 const sample={empty:false,rootPid,supervisorPid:process.ppid,rootPresent:pids.includes(rootPid),supervisorPresent:pids.includes(process.ppid),admittedDescendants:visible.filter(row=>descendants.has(row.pid)).map(row=>row.pid),childPid,childPresent:pids.includes(childPid),rootGroup:rootRow?.group};
 fs.appendFileSync(${JSON.stringify(samplesPath)},JSON.stringify(sample)+'\\n');
 const catalog=visible.map(row=>row.line).join('\\n')+'\\n';
 if(childPid!==undefined&&descendants.has(childPid)&&sample.rootPresent&&sample.supervisorPresent&&!fs.existsSync(${JSON.stringify(admitted)})){
  const record=JSON.stringify({childPid,rootPid,rootGroup:rootRow.group});
  if(${holdPreparedRecord}){
   fs.writeFileSync(${JSON.stringify(prepared)},'');
   fs.writeFileSync(${JSON.stringify(preparationReady)},'prepared');
   let published=false;
   const watch=fs.watch(${JSON.stringify(root)},()=>publish());
   function publish(){
    if(published||!fs.existsSync(${JSON.stringify(publishPrepared)}))return;
    published=true;watch.close();
    fs.writeFileSync(${JSON.stringify(prepared)},record);fs.renameSync(${JSON.stringify(prepared)},${JSON.stringify(admitted)});
    process.stdout.write(catalog);
   }
   publish();
  }else{fs.writeFileSync(${JSON.stringify(prepared)},record);fs.renameSync(${JSON.stringify(prepared)},${JSON.stringify(admitted)});process.stdout.write(catalog)}
 }else process.stdout.write(catalog);
}
`
        );
        chmodSync(fakePs, 0o700);
        const descendant = `
const fs=require('node:fs');const {execFileSync}=require('node:child_process');
fs.writeFileSync(${JSON.stringify(childMarker)},String(process.pid));
const watch=fs.watch(${JSON.stringify(root)},()=>ready());
function ready(){
 if(!fs.existsSync(${JSON.stringify(admitted)}))return;
 const admission=JSON.parse(fs.readFileSync(${JSON.stringify(admitted)},'utf8'));
 if(admission.childPid!==process.pid)return;
 watch.close();
 fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,tmp:require('node:os').tmpdir(),group:Number(execFileSync('/bin/ps',['-p',String(process.pid),'-o','pgid='],{encoding:'utf8'})),sessionPresent:process.env.SOURDAW_PROCESS_SESSION!==undefined}));
 setInterval(()=>{},1000);
}
ready();
`;
        const parent = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(rootMarker)},String(process.pid));const child=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{detached:true,stdio:'ignore',env:{TMPDIR:process.env.TMPDIR,TMP:process.env.TMP,TEMP:process.env.TEMP,PATH:process.env.PATH}});child.unref();setInterval(()=>{},1000);`;
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
        if (holdPreparedRecord) {
            await waitUntil(() => existsSync(preparationReady));
            const childPid = Number(readFileSync(childMarker, 'utf8'));
            const rootPid = Number(readFileSync(rootMarker, 'utf8'));
            childPids.add(childPid);
            childPids.add(rootPid);
            try {
                expect(readFileSync(prepared, 'utf8')).toBe('');
                expect(existsSync(admitted)).toBe(false);
                expect(existsSync(marker)).toBe(false);
                expect(isAlive(childPid)).toBe(true);
            } finally {
                writeFileSync(publishPrepared, 'publish');
            }
        }
        await waitUntil(() => existsSync(marker));
        const started: { pid: number; tmp: string; group: number; sessionPresent: boolean } = JSON.parse(
            readFileSync(marker, 'utf8')
        );
        childPids.add(started.pid);
        const admission: { childPid: number; rootPid: number; rootGroup: number } = JSON.parse(
            readFileSync(admitted, 'utf8')
        );
        childPids.add(admission.rootPid);
        const originalToken = readOwner(started.tmp).token;
        const ownerTrackedAtChildReady = readOwner(started.tmp).tracked.map((identity) => identity.pid);
        // Unknown-tree monitor cleanup includes the guard's 7s wait and two 2s cleanup waits.
        await waitUntil(() => existsSync(resultPath), 15_000);
        const result = JSON.parse(readFileSync(resultPath, 'utf8'));
        console.log(
            JSON.stringify({
                reason: result.reason,
                code: result.code,
                alive: isAlive(started.pid),
                tempExists: existsSync(started.tmp),
                admission,
                ownerTrackedAtChildReady,
                ownerTrackedAtGuardReturn: readOwner(started.tmp).tracked.map((identity) => identity.pid),
                sessionPresent: started.sessionPresent,
                childGroup: started.group,
            })
        );
        expect(isAlive(started.pid)).toBe(true);
        expect(existsSync(started.tmp)).toBe(true);
        const samples: {
            empty: boolean;
            childPresent?: boolean;
            rootPid?: number;
            rootPresent?: boolean;
            supervisorPresent?: boolean;
            admittedDescendants?: number[];
        }[] = readFileSync(samplesPath, 'utf8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        const usable = samples.filter((sample) => !sample.empty);
        expect(usable.length).toBeGreaterThan(0);
        expect(usable.every((sample) => sample.supervisorPresent)).toBe(true);
        expect(usable.filter((sample) => sample.rootPid !== undefined).every((sample) => sample.rootPresent)).toBe(
            true
        );
        expect(usable.some((sample) => sample.rootPid === admission.rootPid && sample.rootPresent)).toBe(true);
        expect(
            usable.every((sample) => sample.childPresent === false && sample.admittedDescendants?.length === 0)
        ).toBe(true);
        expect(samples.filter((sample) => sample.empty).length).toBeGreaterThanOrEqual(3);
        expect(ownerTrackedAtChildReady).not.toContain(started.pid);
        expect(readOwner(started.tmp).tracked.map((identity) => identity.pid)).not.toContain(started.pid);
        expect(started.sessionPresent).toBe(false);
        expect(started.group).not.toBe(admission.rootGroup);

        expect(result.reason).toBe('monitor');
        expect(result.code).not.toBe(0);
        await kill(started.pid);
        await waitUntil(() => supervisor.exitCode !== null || supervisor.signalCode !== null);
        await kill(admission.rootPid);
        expect(isAlive(supervisor.pid)).toBe(false);
        expect(isAlive(admission.rootPid)).toBe(false);
        await waitForStorageAbandonment([started.tmp], deadline);
        const recovery = await runMarkedGuard(root);
        expectMarkedRecovery(root, [{ tempDirectory: started.tmp, token: originalToken }], recovery);
    }

    it('treats an exit-zero empty process census as unavailable monitoring evidence and retains live storage', async () => {
        await verifyEmptyProcessCensusAdmission(false);
    }, 20_000);

    it('keeps admission readiness pending until its complete record is published', async () => {
        await verifyEmptyProcessCensusAdmission(true);
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
        expect(result.reason, proofDiagnostic(result)).toBeUndefined();
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
    it.each([
        { scenario: 'unrelated newborn', released: true, state: 'dead' },
        { scenario: 'newborn cwd borrower', released: false, state: 'alive' },
        { scenario: 'newborn descriptor borrower', released: false, state: 'alive' },
        { scenario: 'previously inspected process becomes a borrower', released: false, state: 'alive' },
        { scenario: 'repeated process arrival', released: false, state: 'unknown' },
        { scenario: 'denied replacement census', released: false, state: 'unknown' },
        { scenario: 'incomplete replacement census', released: false, state: 'unknown' },
        { scenario: 'denied newborn inspection', released: false, state: 'unknown' },
        { scenario: 'incomplete newborn descriptors', released: false, state: 'unknown' },
        { scenario: 'expired first census', released: false, state: 'unknown' },
        { scenario: 'expired replacement inspection', released: false, state: 'unknown' },
    ] as const)('bounds complete Linux replacement proof for $scenario', async ({ scenario, released, state }) => {
        const root = fixture();
        const reports: string[] = [];
        const inspections: number[][] = [];
        const states: string[] = [];
        const ports: StorageRecoveryPorts = {
            identityState: () => 'dead',
            sessionState: (_owner, original, current = original) => {
                let sampledAt = 0;
                let lists = 0;
                const inspected: number[] = [];
                const observed = linuxStorageFileCensus(
                    [123],
                    501,
                    [original, current],
                    5_000,
                    (reason) => reports.push(reason),
                    {
                        readProcessUsers: () => {
                            lists++;
                            if (lists === 1) {
                                if (scenario === 'expired first census') {
                                    sampledAt = 5_000;
                                }
                                return [123, 124];
                            }
                            if (scenario === 'denied replacement census') {
                                return 'process-users-unavailable';
                            }
                            if (scenario === 'incomplete replacement census') {
                                return 'process-users-unusable';
                            }
                            return scenario === 'repeated process arrival' ? [123, 124, 125] : [123, 124];
                        },
                        isGone: () => false,
                        now: () => sampledAt,
                        files: {
                            inspectUid: (pid) => {
                                inspected.push(pid);
                                return 501;
                            },
                            readCwd: (pid) => {
                                if (pid === 124 && scenario === 'denied newborn inspection') {
                                    throw Object.assign(new Error('inspection denied'), { code: 'EACCES' });
                                }
                                return (pid === 124 && scenario === 'newborn cwd borrower') ||
                                    (pid === 123 &&
                                        inspected.length === 2 &&
                                        scenario === 'previously inspected process becomes a borrower')
                                    ? current
                                    : '/outside-storage';
                            },
                            listDescriptors: (pid) =>
                                pid === 124 && scenario === 'incomplete newborn descriptors' ? ['malformed'] : ['27'],
                            readDescriptor: (pid) => {
                                if (pid === 124 && scenario === 'expired replacement inspection') {
                                    sampledAt = 5_001;
                                }
                                if (pid === 124 && scenario === 'newborn descriptor borrower') {
                                    return join(original, 'held');
                                }
                                return '/outside-storage/held';
                            },
                            readStatus: () => '',
                            isGone: () => false,
                            now: () => sampledAt,
                        },
                    }
                );
                states.push(observed);
                inspections.push(inspected);
                expect(lists).toBeLessThanOrEqual(2);
                return observed;
            },
        };
        const storage = ownedStorage(root, ports);
        expect(await storage.release(true), reports.join('; ')).toBe(released);
        expect(existsSync(storage.tempDirectory)).toBe(!released);
        expect(states.every((observed) => observed === state)).toBe(true);
        expect(inspections).not.toHaveLength(0);
        let expectedInspection = [123, 123, 124];
        if (scenario === 'expired first census') {
            expectedInspection = [123];
        }
        if (scenario === 'previously inspected process becomes a borrower') {
            expectedInspection = [123, 123];
        }
        for (const observed of inspections) {
            expect(observed).toEqual(expectedInspection);
        }
        if (!released && state === 'unknown') {
            expect(reports).not.toHaveLength(0);
        }
    });

    it.each(['original', 'moved claim'] as const)(
        'requires complete file proof before final recovery of %s storage',
        (payload) => {
            const root = fixture();
            const storage = ownedStorage(root);
            let currentTemp = storage.tempDirectory;
            if (payload === 'moved claim') {
                let checks = 0;
                expect(
                    reclaimGuardStorage({
                        root,
                        owner: readOwner(storage.tempDirectory),
                        reclaimer: fakeReclaimer,
                        canRemove: () => checks++ === 0,
                    })
                ).toBe(false);
                const payloads = claimPayloads(root);
                expect(payloads).toHaveLength(1);
                currentTemp = join(payloads[0] ?? '', 'tmp');
            }
            const reports: string[] = [];
            const states: string[] = [];
            let snapshot = 'Pid:\t123\nTgid:\t123\nUid:\t501\t501\t501\t501\nState:\tZ (zombie)\nThreads:\t2\n';
            const ports: StorageRecoveryPorts = {
                identityState: () => 'dead',
                sessionState: (_owner, original, current = original) => {
                    const state = linuxStorageFileState(
                        [123],
                        501,
                        [original, current],
                        5_000,
                        (reason) => reports.push(reason),
                        {
                            inspectUid: () => 501,
                            readCwd: () => {
                                throw Object.assign(new Error('closed cwd'), { code: 'ENOENT' });
                            },
                            listDescriptors: () => [],
                            readDescriptor: () => undefined,
                            readStatus: () => snapshot,
                            isGone: () => false,
                            now: () => 0,
                        }
                    );
                    states.push(state);
                    return state;
                },
            };
            recoverGuardStorage(root, ports, fakeReclaimer);
            expect(states).toEqual(['unknown']);
            expect(reports[0]).toContain('pid/tgid/uids/state/threads=123/123/501,501,501,501/Z/2');
            expect(existsSync(currentTemp)).toBe(true);
            snapshot = snapshot.replace('Threads:\t2', 'Threads:\t1');
            recoverGuardStorage(root, ports, fakeReclaimer);
            expect(states.at(-1)).toBe('dead');
            expect(existsSync(currentTemp)).toBe(false);
        }
    );

    it('retains Linux storage when the last successful file read exceeds the proof deadline', async () => {
        const root = fixture();
        const ports: StorageRecoveryPorts = {
            identityState: () => 'dead',
            sessionState: (_owner, original, current = original) => {
                let sampledAt = 0;
                return linuxStorageFileState([123], 501, [original, current], 5_000, () => {}, {
                    inspectUid: () => 501,
                    readCwd: () => '/outside-storage',
                    listDescriptors: () => ['27'],
                    readDescriptor: () => {
                        sampledAt = 5_001;
                        return '/outside-storage/held';
                    },
                    readStatus: () => {
                        throw new Error('successful inspection must not request terminal proof');
                    },
                    isGone: () => false,
                    now: () => sampledAt,
                });
            },
        };
        const storage = ownedStorage(root, ports);
        expect(await storage.release(true)).toBe(false);
        expect(existsSync(storage.tempDirectory)).toBe(true);
    });

    const terminalStatus = 'Pid:\t123\nTgid:\t123\nUid:\t501\t501\t501\t501\nState:\tZ (zombie)\nThreads:\t1\n';
    it.each([
        { scenario: 'terminal thread group', status: terminalStatus, released: true },
        { scenario: 'runnable process', status: terminalStatus.replace('Z (zombie)', 'R (running)'), released: false },
        {
            scenario: 'zombie leader with another thread',
            status: terminalStatus.replace('Threads:\t1', 'Threads:\t2'),
            released: false,
        },
        {
            scenario: 'changed UID',
            status: terminalStatus.replace('501\t501\t501\t501', '501\t0\t501\t501'),
            released: false,
        },
        { scenario: 'different PID', status: terminalStatus.replace('Pid:\t123', 'Pid:\t124'), released: false },
        {
            scenario: 'different thread group',
            status: terminalStatus.replace('Tgid:\t123', 'Tgid:\t124'),
            released: false,
        },
        { scenario: 'unknown status', status: '', released: false },
        { scenario: 'truncated status', status: terminalStatus.slice(0, -1), released: false },
        { scenario: 'duplicate status field', status: `${terminalStatus}Threads:\t1\n`, released: false },
        { scenario: 'missing status field', status: terminalStatus.replace('Threads:\t1\n', ''), released: false },
        {
            scenario: 'malformed thread count',
            status: terminalStatus.replace('Threads:\t1', 'Threads:\tNaN'),
            released: false,
        },
        { scenario: 'denied status inspection', status: terminalStatus, released: false, statusDenied: true },
        { scenario: 'denied cwd inspection', status: terminalStatus, released: false, cwdDenied: true },
        { scenario: 'expired status sample', status: terminalStatus, released: false, expired: true },
    ])(
        'requires complete Linux file-release proof for a $scenario',
        async ({ status, released, statusDenied, cwdDenied, expired }) => {
            const root = fixture();
            const reports: string[] = [];
            const denied = Object.assign(new Error('private path must not be emitted'), { code: 'EPERM' });
            const missing = Object.assign(new Error('private path must not be emitted'), { code: 'ENOENT' });
            let sampledAt = 0;
            const ports: StorageRecoveryPorts = {
                identityState: () => 'dead',
                sessionState: (_owner, tempDirectory, currentTempDirectory) =>
                    linuxStorageFileState(
                        [123],
                        501,
                        [tempDirectory, currentTempDirectory ?? tempDirectory],
                        5_000,
                        (reason) => reports.push(reason),
                        {
                            inspectUid: () => 501,
                            readCwd: () => {
                                throw cwdDenied ? denied : missing;
                            },
                            listDescriptors: () => {
                                throw new Error('cwd failure must precede FD enumeration');
                            },
                            readDescriptor: () => {
                                throw new Error('cwd failure must precede FD inspection');
                            },
                            isGone: () => false,
                            readStatus: () => {
                                if (statusDenied) {
                                    throw denied;
                                }
                                if (expired) {
                                    sampledAt = 5_001;
                                }
                                return status;
                            },
                            now: () => sampledAt,
                        }
                    ),
            };
            const storage = ownedStorage(root, ports);
            expect(await storage.release(true)).toBe(released);
            expect(existsSync(storage.tempDirectory)).toBe(!released);
            if (!released) {
                expect(reports).toHaveLength(1);
                expect(reports[0]).toContain(`pid=123:phase=cwd:error=${cwdDenied ? 'EPERM' : 'ENOENT'}`);
                expect(reports[0]).not.toContain('private path');
            }
        }
    );

    it.each([
        { scenario: 'denied cwd predating the supervisor', code: 'EACCES', predates: true, consumer: false },
        { scenario: 'denied cwd predating the supervisor (EPERM)', code: 'EPERM', predates: true, consumer: false },
        { scenario: 'denied cwd started after the supervisor', code: 'EACCES', predates: false, consumer: false },
        { scenario: 'unreadable cwd predating the supervisor', code: 'EIO', predates: true, consumer: false },
        { scenario: 'later consumer beside an excused process', code: 'EACCES', predates: true, consumer: true },
    ])(
        'excuses only uninspectable same-UID processes older than the supervisor: $scenario',
        ({ code, predates, consumer }) => {
            const temp = '/owned/run/tmp';
            const reports: string[] = [];
            const failure = Object.assign(new Error('private path must not be emitted'), { code });
            const excused = code !== 'EIO' && predates;
            const state = linuxStorageFileState([123, 124], 501, [temp], 5_000, (reason) => reports.push(reason), {
                inspectUid: () => 501,
                readCwd: (pid) => {
                    if (pid === 123) {
                        throw failure;
                    }
                    return consumer ? temp : '/elsewhere';
                },
                listDescriptors: () => [],
                readDescriptor: () => undefined,
                readStatus: () =>
                    'Pid:\t123\nTgid:\t123\nUid:\t501\t501\t501\t501\nState:\tS (sleeping)\nThreads:\t1\n',
                isGone: () => false,
                startedBeforeSupervisor: (pid) => pid === 123 && predates,
                now: () => 0,
            });
            if (consumer) {
                expect(state).toBe('alive');
            } else {
                expect(state).toBe(excused ? 'dead' : 'unknown');
            }
            const expectedReports: string[] = [];
            if (!excused) {
                expectedReports.push(
                    `proc-inspection-unavailable:pid=123:phase=cwd:error=${code}:pid/tgid/uids/state/threads=123/123/501,501,501,501/S/1`
                );
            }
            expect(reports).toEqual(expectedReports);
        }
    );

    it('reads the proc start time after a command name holding spaces and parentheses', () => {
        const fields = ['S', '1', '42', '42', '0', '-1', '4194560', '100', '0', '0', '0', '1', '2', '0', '0', '20'];
        const stat = `42 (a) b (c) ${[...fields, '0', '1', '0', '98765', '1000', '10'].join(' ')}\n`;
        expect(parseLinuxStartTicks(stat)).toBe(98765);
        expect(parseLinuxStartTicks(stat.slice(0, -1))).toBeUndefined();
        expect(parseLinuxStartTicks(`42 (a) ${fields.join(' ')}\n`)).toBeUndefined();
        expect(parseLinuxStartTicks(stat.replace('98765', '9x765'))).toBeUndefined();
    });

    it.skipIf(process.platform !== 'linux')('orders real processes against the supervisor start time', async () => {
        const later = spawn('sleep', ['5'], { stdio: 'ignore' });
        if (later.pid === undefined) {
            throw new Error('later process did not start');
        }
        childPids.add(later.pid);
        const ports = linuxFilePorts(process.pid);
        expect(ports.startedBeforeSupervisor?.(1)).toBe(true);
        expect(ports.startedBeforeSupervisor?.(later.pid)).toBe(false);
        expect(ports.startedBeforeSupervisor?.(process.pid)).toBe(false);
        expect(linuxFilePorts().startedBeforeSupervisor?.(1)).toBe(false);
    });

    const supervisorIdentity = { pid: 4242, startedAt: 'supervisor-start' };
    it.each([
        { scenario: 'this live supervisor on Linux', owner: supervisorIdentity, live: [], host: 'linux', bound: 4242 },
        {
            scenario: 'a crashed owner',
            owner: { pid: 4141, startedAt: 'crashed-start' },
            live: [],
            host: 'linux',
            bound: undefined,
        },
        {
            scenario: 'a foreign live owner',
            owner: { pid: 4343, startedAt: 'foreign-start' },
            live: [{ pid: 4343, startedAt: 'foreign-start' }],
            host: 'linux',
            bound: undefined,
        },
        {
            scenario: 'a reused PID whose start identity differs',
            owner: { pid: 4242, startedAt: 'earlier-start' },
            live: [],
            host: 'linux',
            bound: undefined,
        },
        {
            scenario: 'this live supervisor on macOS',
            owner: supervisorIdentity,
            live: [],
            host: 'darwin',
            bound: undefined,
        },
        {
            scenario: 'this live supervisor on Windows',
            owner: supervisorIdentity,
            live: [],
            host: 'win32',
            bound: undefined,
        },
    ] satisfies {
        scenario: string;
        owner: StorageProcessIdentity;
        live: StorageProcessIdentity[];
        host: NodeJS.Platform;
        bound: number | undefined;
    }[])(
        'bounds the start-time excuse only by the live supervisor itself: $scenario',
        ({ owner, live, host, bound }) => {
            const table = [supervisorIdentity, ...live];
            // Mirrors storage identity liveness: a matching PID with another start time is a reuse.
            const identityState = (identity: StorageProcessIdentity) => {
                if (table.some((entry) => entry.pid === identity.pid && entry.startedAt === identity.startedAt)) {
                    return 'alive';
                }
                return table.some((entry) => entry.pid === identity.pid) ? 'unknown' : 'dead';
            };
            expect(startTimeExcuseSupervisor(owner, supervisorIdentity.pid, host, identityState)).toBe(bound);
        }
    );

    it.each([
        { scenario: 'a recovered crashed owner retains its storage', recovered: true },
        { scenario: 'this live supervisor releases its own storage', recovered: false },
    ])(
        'excuses an uninspectable process predating the current process end to end only for the live supervisor: $scenario',
        async ({ recovered }) => {
            const root = fixture();
            const supervisor = { pid: process.pid, startedAt: 'supervisor-start' };
            const reports: string[] = [];
            const denied = Object.assign(new Error('private path must not be emitted'), { code: 'EACCES' });
            // pid 123 started before the current process and holds the storage beyond inspection.
            const startTicks = (pid: number) => (pid === 123 ? 1 : 2);
            const identityState = (identity: StorageProcessIdentity) =>
                !recovered && identity.pid === supervisor.pid && identity.startedAt === supervisor.startedAt
                    ? 'alive'
                    : 'dead';
            const ports: StorageRecoveryPorts = {
                identityState,
                sessionState: (owner, original, current = original) =>
                    linuxStorageFileState([123], 501, [original, current], 5_000, (reason) => reports.push(reason), {
                        inspectUid: () => 501,
                        readCwd: () => {
                            throw denied;
                        },
                        listDescriptors: () => [],
                        readDescriptor: () => undefined,
                        readStatus: () =>
                            'Pid:\t123\nTgid:\t123\nUid:\t501\t501\t501\t501\nState:\tS (sleeping)\nThreads:\t1\n',
                        isGone: () => false,
                        startedBeforeSupervisor: linuxFilePorts(
                            startTimeExcuseSupervisor(owner.owner, process.pid, 'linux', identityState),
                            startTicks
                        ).startedBeforeSupervisor,
                        now: () => 0,
                    }),
            };
            const storage = createGuardStorage({
                root,
                token: randomUUID(),
                owner: recovered ? fakeOwner : supervisor,
                ports,
            });
            if (recovered) {
                recoverGuardStorage(root, ports, fakeReclaimer);
                expect(existsSync(storage.tempDirectory)).toBe(true);
                expect(reports).toEqual([
                    'proc-inspection-unavailable:pid=123:phase=cwd:error=EACCES:pid/tgid/uids/state/threads=123/123/501,501,501,501/S/1',
                ]);
                return;
            }
            expect(await storage.release(true)).toBe(true);
            expect(existsSync(storage.tempDirectory)).toBe(false);
            expect(reports).toEqual([]);
        }
    );

    it.each([
        {
            scenario: 'closed enumeration descriptor',
            recreated: false,
            removed: true,
            rootMissing: false,
            denied: false,
        },
        {
            scenario: 'genuinely recreated live descriptor',
            recreated: true,
            removed: false,
            rootMissing: false,
            denied: false,
        },
        {
            scenario: 'unavailable descriptor directory',
            recreated: false,
            removed: false,
            rootMissing: true,
            denied: false,
        },
        {
            scenario: 'permission-denied descriptor',
            recreated: false,
            removed: false,
            rootMissing: false,
            denied: true,
        },
    ])('uses current file evidence for a $scenario', async ({ recreated, removed, rootMissing, denied }) => {
        const root = fixture();
        const missing = Object.assign(new Error('descriptor closed'), { code: 'ENOENT' });
        const permission = Object.assign(new Error('inspection denied'), { code: 'EPERM' });
        const inspections: string[] = [];
        const ports: StorageRecoveryPorts = {
            identityState: () => 'dead',
            sessionState: () => {
                try {
                    const path = readStorageDescriptor('/proc/123/fd/27', {
                        readLink: () => {
                            throw denied ? permission : missing;
                        },
                        inspectLink: (path) => {
                            inspections.push(path);
                            if (path === '/proc/123/fd' && rootMissing) {
                                throw missing;
                            }
                            if (path.endsWith('/27') && !recreated) {
                                throw missing;
                            }
                        },
                    });
                    return path === undefined ? 'dead' : 'alive';
                } catch {
                    return 'unknown';
                }
            },
        };
        const storage = ownedStorage(root, ports);
        expect(await storage.release(true)).toBe(removed);
        expect(existsSync(storage.tempDirectory)).toBe(!removed);
        let expectedInspections: string[] = [];
        if (removed) {
            expectedInspections = ['/proc/123/fd/27', '/proc/123/fd', '/proc/123/fd/27', '/proc/123/fd'];
        } else if (rootMissing) {
            expectedInspections = ['/proc/123/fd/27', '/proc/123/fd'];
        } else if (!denied) {
            expectedInspections = ['/proc/123/fd/27'];
        }
        expect(inspections).toEqual(expectedInspections);
    });

    it.skipIf(process.getuid === undefined).each([
        { scenario: 'third complete census', omissions: 2, state: 'dead', samples: 3, reason: undefined },
        {
            scenario: 'persistent omission',
            omissions: 3,
            state: 'unknown',
            samples: 3,
            reason: 'lsof-fields-unusable:descriptor-type-missing',
        },
        { scenario: 'third live borrower', omissions: 2, state: 'alive', samples: 3, reason: undefined },
        {
            scenario: 'descriptor omission then complete PID coverage',
            omissions: 1,
            state: 'dead',
            samples: 3,
            processSamples: 5,
            reason: undefined,
        },
        {
            scenario: 'descriptor omission then live borrower',
            omissions: 1,
            state: 'alive',
            samples: 3,
            processSamples: 4,
            reason: undefined,
        },
        {
            scenario: 'descriptor omission then persistent PID gap',
            omissions: 1,
            state: 'unknown',
            samples: 3,
            processSamples: 5,
            reason: 'lsof-live-pid-missing:count=1',
        },
        {
            scenario: 'descriptor omission then another new PID',
            omissions: 1,
            state: 'unknown',
            samples: 3,
            processSamples: 5,
            reason: 'lsof-live-pid-missing:count=1',
        },
        {
            scenario: 'expired second observation',
            omissions: 2,
            state: 'unknown',
            samples: 2,
            reason: 'file-census-time-bound',
        },
        {
            scenario: 'third missing live PID',
            omissions: 2,
            state: 'unknown',
            samples: 3,
            reason: 'lsof-live-pid-missing:count=1',
        },
        {
            scenario: 'persistent first PID gap despite another newborn',
            omissions: 0,
            state: 'unknown',
            samples: 2,
            reason: 'lsof-live-pid-missing:count=2',
        },
        {
            scenario: 'unknown descriptor type',
            omissions: 0,
            state: 'unknown',
            samples: 1,
            reason: 'lsof-fields-unusable:unknown-file-type',
        },
        {
            scenario: 'post-death recovery live PID gap',
            omissions: 0,
            state: 'unknown',
            samples: 2,
            reason: 'lsof-live-pid-missing:count=1',
        },
    ])(
        'bounds Darwin census observations for $scenario',
        ({ scenario, omissions, state, samples, processSamples, reason }) => {
            const root = fixture();
            // Isolate builtin substitutions in a child; the real parser, census and
            // private-storage checks run without changing the test worker's globals.
            const program = `
            import childProcess from 'node:child_process';
            import os from 'node:os';
            import {syncBuiltinESMExports} from 'node:module';
            const scenario=${JSON.stringify(scenario)},omissions=${omissions};
            const mixedOmission=scenario.startsWith('descriptor omission then ');
            const uid=process.getuid(),pid=process.pid,newPid=pid+100000,newerPid=pid+100001;
            let samples=0,processSamples=0,now=0;
            const timeouts=[];
            os.platform=()=> 'darwin';
            Date.now=()=>now;
            process.kill=()=>true;
            childProcess.spawnSync=(command,args,options)=>{
                timeouts.push({command,timeout:options.timeout});
                let stdout;
                if(command==='ps'){
                    if(args[0]==='-p')stdout=uid+' S\\n';
                    else {
                        processSamples++;
                        let pids=[pid];
                        if(scenario==='third missing live PID')pids.push(newPid);
                        if(scenario==='post-death recovery live PID gap'&&processSamples>=3)pids.push(newPid);
                        if(scenario==='persistent first PID gap despite another newborn'){
                            if(processSamples>=2)pids.push(newPid);
                            if(processSamples>=4)pids.push(newerPid);
                        }
                        if(mixedOmission&&processSamples>=3)pids.push(newPid);
                        if(scenario==='descriptor omission then another new PID'&&processSamples>=5)pids.push(newerPid);
                        stdout=pids.map(pid=>pid+' '+uid).join('\\n')+'\\n';
                    }
                }else if(command==='lsof'){
                    samples++;
                    now+=scenario==='expired second observation'?2500:100;
                    if(samples<=omissions){
                        stdout='p'+pid+'\\0\\nf3\\0nFD unavailable\\0\\n';
                        if(mixedOmission)stdout='p'+pid+'\\0\\nfcwd\\0tDIR\\0n'+${JSON.stringify(join(root, 'tmp'))}+'\\0\\np'+newPid+'\\0\\nf3\\0nFD unavailable\\0\\n';
                    }
                    else {
                        const type=scenario==='unknown descriptor type'?'UNKNOWN':'DIR';
                        const path=scenario==='third live borrower'?${JSON.stringify(join(root, 'tmp'))}:'/outside';
                        stdout='p'+pid+'\\0\\nfcwd\\0t'+type+'\\0n'+path+'\\0\\n';
                        if(mixedOmission&&samples>=3&&scenario!=='descriptor omission then persistent PID gap'){
                            const borrowed=scenario==='descriptor omission then live borrower'?${JSON.stringify(join(root, 'tmp'))}:'/outside';
                            stdout+='p'+newPid+'\\0\\nfcwd\\0tDIR\\0n'+borrowed+'\\0\\n';
                        }
                    }
                }else throw new Error('unexpected command '+command);
                return {status:0,stdout,stderr:''};
            };
            syncBuiltinESMExports();
            const {storageFileState}=await import(${JSON.stringify(guardPath)});
            const reasons=[];
            let state,retained,proofBeforeRecovery,claimPayloadCount;
            if(scenario==='post-death recovery live PID gap'){
                const {createGuardStorage}=await import(${JSON.stringify(storagePath)});
                const {randomUUID}=await import('node:crypto');
                const {existsSync,readdirSync}=await import('node:fs');
                const storageRoot=${JSON.stringify(join(root, 'storage'))};
                const ports={identityState:()=> 'dead',sessionState:(_owner,original,current=original)=>state=storageFileState([original,current],[],reason=>reasons.push(reason))};
                const storage=createGuardStorage({root:storageRoot,token:randomUUID(),owner:${JSON.stringify(fakeOwner)},ports});
                proofBeforeRecovery=storageFileState([storage.tempDirectory],[]);
                createGuardStorage({root:storageRoot,token:randomUUID(),owner:${JSON.stringify(fakeReclaimer)},ports});
                retained=existsSync(storage.tempDirectory);
                claimPayloadCount=readdirSync(storageRoot+'/.claims').length;
            }else state=storageFileState([${JSON.stringify(join(root, 'tmp'))}],[],reason=>reasons.push(reason));
            console.log(JSON.stringify({state,reasons,samples,processSamples,timeouts,retained,proofBeforeRecovery,claimPayloadCount}));
        `;
            chmodSync(root, 0o700);
            const observed: {
                state: string;
                reasons: string[];
                samples: number;
                processSamples: number;
                timeouts: { command: string; timeout: number }[];
                retained?: boolean;
                proofBeforeRecovery?: string;
                claimPayloadCount?: number;
            } = JSON.parse(
                execFileSync(process.execPath, ['--input-type=module', '-e', program], {
                    cwd: root,
                    encoding: 'utf8',
                    timeout: 10_000,
                })
            );
            expect(observed.state).toBe(state);
            expect(observed.samples).toBe(samples);
            expect(observed.reasons).toEqual(reason === undefined ? [] : [expect.stringContaining(reason)]);
            const censusTimeouts = observed.timeouts.filter((sample) => sample.command === 'lsof');
            expect(censusTimeouts.map((sample) => sample.timeout)).toEqual(
                Array.from({ length: samples }, (_, index) => {
                    if (scenario === 'post-death recovery live PID gap') {
                        return 5000;
                    }
                    const elapsedPerObservation = scenario === 'expired second observation' ? 2500 : 100;
                    return 5000 - index * elapsedPerObservation;
                })
            );
            if (processSamples !== undefined) {
                expect(observed.processSamples).toBe(processSamples);
            } else if (state === 'dead') {
                expect(observed.processSamples).toBe(4);
            }
            if (scenario === 'post-death recovery live PID gap') {
                expect(observed.proofBeforeRecovery).toBe('dead');
                expect(observed.claimPayloadCount).toBe(0);
                expect(observed.retained).toBe(true);
            }
        }
    );

    it.skipIf(process.getuid === undefined).each([
        {
            scenario: 'successive newborns reach complete third catalog',
            ending: 'complete',
            secondSnapshot: 'live',
            state: 'dead',
            samples: 3,
            processSamples: 6,
        },
        {
            scenario: 'successive newborns reveal protected third-catalog borrower',
            ending: 'borrower',
            secondSnapshot: 'live',
            state: 'alive',
            samples: 3,
            processSamples: 5,
        },
        {
            scenario: 'successive newborns exhaust third catalog with another newborn',
            ending: 'third newborn',
            secondSnapshot: 'live',
            state: 'unknown',
            samples: 3,
            processSamples: 6,
        },
        {
            scenario: 'successive newborns reach the original deadline',
            ending: 'deadline',
            secondSnapshot: 'live',
            state: 'unknown',
            samples: 3,
            processSamples: 5,
        },
        {
            scenario: 'second newborn has another UID',
            ending: 'complete',
            secondSnapshot: 'wrong UID',
            state: 'unknown',
            samples: 2,
            processSamples: 4,
        },
        {
            scenario: 'second newborn has unknown state',
            ending: 'complete',
            secondSnapshot: 'unknown state',
            state: 'unknown',
            samples: 2,
            processSamples: 4,
        },
        {
            scenario: 'second newborn snapshot is denied',
            ending: 'complete',
            secondSnapshot: 'denied',
            state: 'unknown',
            samples: 2,
            processSamples: 4,
        },
    ] as const)(
        'bounds successive Darwin PID arrivals for $scenario',
        ({ ending, secondSnapshot, state, samples, processSamples }) => {
            const root = fixture();
            chmodSync(root, 0o700);
            const temp = join(root, 'tmp');
            const program = `
                import childProcess from 'node:child_process';
                import os from 'node:os';
                import {syncBuiltinESMExports} from 'node:module';
                const ending=${JSON.stringify(ending)},secondSnapshot=${JSON.stringify(secondSnapshot)};
                const uid=process.getuid(),pid=process.pid,firstPid=pid+100000,secondPid=pid+100001,thirdPid=pid+100002;
                const temp=${JSON.stringify(temp)};
                let fileSamples=0,processSamples=0,now=0;
                const timeouts=[],accountPids=[],catalogPids=[],snapshotPids=[];
                os.platform=()=> 'darwin';
                Date.now=()=>now;
                process.kill=()=>true;
                childProcess.spawnSync=(command,args,options)=>{
                    timeouts.push({command,timeout:options.timeout});
                    if(command==='ps'&&args[0]==='-p'){
                        const inspected=Number(args[1]);
                        snapshotPids.push(inspected);
                        if(inspected===secondPid&&secondSnapshot==='denied')return {status:1,stdout:'',stderr:'denied'};
                        const user=inspected===secondPid&&secondSnapshot==='wrong UID'?uid+1:uid;
                        const state=inspected===secondPid&&secondSnapshot==='unknown state'?'?':'S';
                        return {status:0,stdout:user+' '+state+'\\n',stderr:''};
                    }
                    if(command==='ps'){
                        processSamples++;
                        const accounts=[
                            [pid],[pid,firstPid],[pid,firstPid],[pid,firstPid,secondPid],
                            [pid,firstPid,secondPid],
                            ending==='third newborn'?[pid,firstPid,secondPid,thirdPid]:[pid,firstPid,secondPid],
                        ];
                        const pids=accounts[processSamples-1];
                        if(pids===undefined)throw new Error('account observation exceeded six samples');
                        accountPids.push(pids);
                        return {status:0,stdout:pids.map(value=>value+' '+uid).join('\\n')+'\\n',stderr:''};
                    }
                    if(command==='lsof'){
                        fileSamples++;
                        now+=ending==='deadline'&&fileSamples===3?4800:100;
                        const pids=fileSamples===1?[pid]:fileSamples===2?[pid,firstPid]:[pid,firstPid,secondPid];
                        catalogPids.push(pids);
                        const stdout=pids.map(value=>{
                            const path=ending==='borrower'&&fileSamples===3&&value===secondPid?temp:'/outside';
                            return 'p'+value+'\\0\\nfcwd\\0tDIR\\0n'+path+'\\0\\n';
                        }).join('');
                        return {status:0,stdout,stderr:''};
                    }
                    throw new Error('unexpected command '+command);
                };
                syncBuiltinESMExports();
                const {storageFileState}=await import(${JSON.stringify(guardPath)});
                const reasons=[];
                const result=storageFileState([temp],[],reason=>reasons.push(reason));
                console.log(JSON.stringify({result,reasons,fileSamples,processSamples,timeouts,accountPids,catalogPids,snapshotPids,pid,firstPid,secondPid,thirdPid,uid}));
            `;
            const observed: {
                result: string;
                reasons: string[];
                fileSamples: number;
                processSamples: number;
                timeouts: { command: string; timeout: number }[];
                accountPids: number[][];
                catalogPids: number[][];
                snapshotPids: number[];
                pid: number;
                firstPid: number;
                secondPid: number;
                thirdPid: number;
                uid: number;
            } = JSON.parse(
                execFileSync(process.execPath, ['--input-type=module', '-e', program], {
                    cwd: root,
                    encoding: 'utf8',
                    timeout: 10_000,
                })
            );
            const { pid, firstPid, secondPid, thirdPid, uid } = observed;
            const thirdAccounts =
                ending === 'third newborn' ? [pid, firstPid, secondPid, thirdPid] : [pid, firstPid, secondPid];
            const expectedAccounts = [
                [pid],
                [pid, firstPid],
                [pid, firstPid],
                [pid, firstPid, secondPid],
                [pid, firstPid, secondPid],
                thirdAccounts,
            ];
            expect(observed.result).toBe(state);
            expect(observed.fileSamples).toBe(samples);
            expect(observed.processSamples).toBe(processSamples);
            expect(observed.accountPids).toEqual(expectedAccounts.slice(0, processSamples));
            expect(observed.catalogPids).toEqual(
                [[pid], [pid, firstPid], [pid, firstPid, secondPid]].slice(0, samples)
            );
            expect(observed.snapshotPids).toEqual(
                ending === 'third newborn' ? [firstPid, secondPid, thirdPid] : [firstPid, secondPid]
            );
            expect(
                observed.timeouts.filter((sample) => sample.command === 'lsof').map((sample) => sample.timeout)
            ).toEqual([5000, 4900, 4800].slice(0, samples));
            let expectedReason: string | undefined;
            if (ending === 'deadline') {
                expectedReason = 'file-census-time-bound';
            }
            if (ending === 'third newborn') {
                expectedReason = `lsof-live-pid-missing:count=1:pid/uid/state=${thirdPid}/${uid}/S`;
            }
            if (secondSnapshot === 'wrong UID') {
                expectedReason = `lsof-live-pid-missing:count=1:pid/uid/state=${secondPid}/${uid + 1}/S`;
            }
            if (secondSnapshot === 'unknown state') {
                expectedReason = `lsof-live-pid-missing:count=1:pid/uid/state=${secondPid}/${uid}/?`;
            }
            if (secondSnapshot === 'denied') {
                expectedReason = `lsof-live-pid-missing:count=1:pid/uid/state=${secondPid}/unknown/unknown`;
            }
            expect(observed.reasons).toEqual(expectedReason === undefined ? [] : [expectedReason]);
        }
    );

    it.skipIf(process.getuid === undefined).each([
        { scenario: 'complete current coverage', gap: false, expectedStates: ['dead', 'dead', 'dead'] },
        { scenario: 'new uncovered live PID', gap: true, expectedStates: ['unknown'] },
    ] as const)('requires fresh startup recovery proof for $scenario', ({ gap, expectedStates }) => {
        const root = fixture();
        const program = `
            import childProcess from 'node:child_process';
            import os from 'node:os';
            import {syncBuiltinESMExports} from 'node:module';
            import {randomUUID} from 'node:crypto';
            import {existsSync,readFileSync,readdirSync} from 'node:fs';
            import {join} from 'node:path';
            const gap=${gap},uid=process.getuid(),pid=process.pid,newPid=pid+100000,newerPid=pid+100001;
            const storageRoot=${JSON.stringify(join(root, 'storage'))};
            let fileSamples=0,processSamples=0,now=0;
            const timeouts=[],proofPaths=[],accountPids=[],catalogPids=[];
            os.platform=()=> 'darwin';
            Date.now=()=>now;
            process.kill=()=>true;
            childProcess.spawnSync=(command,args,options)=>{
                timeouts.push({command,timeout:options.timeout});
                let stdout;
                if(command==='ps'){
                    if(args[0]==='-p')stdout=uid+' S\\n';
                    else {
                        processSamples++;
                        const pids=[pid];
                        if((gap&&processSamples>=3)||(!gap&&processSamples>=4))pids.push(newPid);
                        if(!gap&&processSamples>=6)pids.push(newerPid);
                        accountPids.push(pids);
                        stdout=pids.map(value=>value+' '+uid).join('\\n')+'\\n';
                    }
                }else if(command==='lsof'){
                    fileSamples++;
                    now+=100;
                    const covered=gap||fileSamples<=2?[pid]:fileSamples===3?[pid,newPid]:[pid,newPid,newerPid];
                    catalogPids.push(covered);
                    stdout=covered.map(value=>'p'+value+'\\0\\nfcwd\\0tDIR\\0n/outside\\0\\n').join('');
                }else throw new Error('unexpected command '+command);
                return {status:0,stdout,stderr:''};
            };
            syncBuiltinESMExports();
            const {storageFileState}=await import(${JSON.stringify(guardPath)});
            const {createGuardStorage,recoverGuardStorage}=await import(${JSON.stringify(storagePath)});
            const reasons=[],states=[];
            const ports={
                identityState:()=> 'dead',
                sessionState:(_owner,original,current=original)=>{
                    proofPaths.push({original,current});
                    const state=storageFileState([original,current],[],reason=>reasons.push(reason));
                    states.push(state);
                    return state;
                },
            };
            const originalToken=randomUUID();
            const storage=createGuardStorage({root:storageRoot,token:originalToken,owner:${JSON.stringify(fakeOwner)},ports});
            const proofBeforeRecovery=storageFileState([storage.tempDirectory],[]);
            recoverGuardStorage(storageRoot,ports,${JSON.stringify(fakeReclaimer)});
            const originalRetained=existsSync(storage.tempDirectory);
            const ownerPath=join(storageRoot,originalToken,'owner.json');
            const originalOwner=existsSync(ownerPath)?JSON.parse(readFileSync(ownerPath,'utf8')):undefined;
            const claims=readdirSync(join(storageRoot,'.claims')).flatMap(token=>{
                const claim=join(storageRoot,'.claims',token);
                return readdirSync(claim).filter(name=>name!=='claim.json').map(name=>{
                    const path=join(claim,name);
                    return {name,owner:JSON.parse(readFileSync(join(path,'owner.json'),'utf8'))};
                });
            });
            console.log(JSON.stringify({proofBeforeRecovery,states,reasons,fileSamples,processSamples,timeouts,proofPaths,accountPids,catalogPids,originalRetained,originalOwner,claims,pid,newPid,newerPid,uid,originalToken}));
        `;
        const observed: {
            proofBeforeRecovery: string;
            states: string[];
            reasons: string[];
            fileSamples: number;
            processSamples: number;
            timeouts: { command: string; timeout: number }[];
            proofPaths: { original: string; current: string }[];
            accountPids: number[][];
            catalogPids: number[][];
            originalRetained: boolean;
            originalOwner?: { token: string };
            claims: { name: string; owner: { token: string } }[];
            pid: number;
            newPid: number;
            newerPid: number;
            uid: number;
            originalToken: string;
        } = JSON.parse(
            execFileSync(process.execPath, ['--input-type=module', '-e', program], {
                cwd: root,
                encoding: 'utf8',
                timeout: 10_000,
            })
        );
        expect(observed.proofBeforeRecovery).toBe('dead');
        expect(observed.states).toEqual(expectedStates);
        expect(observed.reasons).toEqual(
            gap ? [`lsof-live-pid-missing:count=1:pid/uid/state=${observed.newPid}/${observed.uid}/S`] : []
        );
        expect(observed.fileSamples).toBe(gap ? 2 : 6);
        expect(observed.processSamples).toBe(gap ? 4 : 12);
        const { pid, newPid, newerPid } = observed;
        let expectedAccountPids = [
            [pid],
            [pid],
            [pid],
            [pid, newPid],
            [pid, newPid],
            [pid, newPid, newerPid],
            ...Array.from({ length: 6 }, () => [pid, newPid, newerPid]),
        ];
        let expectedCatalogPids = [
            [pid],
            [pid],
            [pid, newPid],
            [pid, newPid, newerPid],
            [pid, newPid, newerPid],
            [pid, newPid, newerPid],
        ];
        if (gap) {
            expectedAccountPids = [[pid], [pid], [pid, newPid], [pid, newPid]];
            expectedCatalogPids = [[pid], [pid]];
        }
        expect(observed.accountPids).toEqual(expectedAccountPids);
        expect(observed.catalogPids).toEqual(expectedCatalogPids);
        expect(observed.timeouts.filter((sample) => sample.command === 'lsof').map((sample) => sample.timeout)).toEqual(
            gap ? [5000, 5000] : [5000, 5000, 4900, 4800, 5000, 5000]
        );
        expect(observed.proofPaths).toHaveLength(gap ? 1 : 3);
        expect(observed.proofPaths[0]?.current).toBe(observed.proofPaths[0]?.original);
        if (!gap) {
            expect(observed.proofPaths[1]?.current).toBe(observed.proofPaths[1]?.original);
            expect(observed.proofPaths[2]?.current).toContain('/.claims/');
            expect(observed.proofPaths[2]?.current).not.toBe(observed.proofPaths[2]?.original);
        }
        expect(observed.originalRetained).toBe(gap);
        expect(observed.originalOwner?.token).toBe(gap ? observed.originalToken : undefined);
        expect(observed.claims).toEqual([]);
    });

    it.skipIf(process.platform !== 'darwin').each([
        { scenario: 'valid replacement reclaims', omissions: 1, persistent: false, consumer: false, released: true },
        { scenario: 'third observation reclaims', omissions: 2, persistent: false, consumer: false, released: true },
        { scenario: 'third live consumer retains', omissions: 2, persistent: false, consumer: true, released: false },
        {
            scenario: 'live consumer replacement retains',
            omissions: 1,
            persistent: false,
            consumer: true,
            released: false,
        },
        {
            scenario: 'persistent missing type retains',
            omissions: 3,
            persistent: true,
            consumer: false,
            released: false,
        },
    ])(
        'takes bounded fresh file proof for a missing descriptor type: $scenario',
        async ({ omissions, persistent, consumer, released }) => {
            const root = fixture();
            const bin = join(root, 'bin');
            mkdirSync(bin);
            const count = join(root, 'samples');
            const utility = join(bin, 'lsof');
            writeFileSync(
                utility,
                `#!/bin/sh\nif ${persistent ? 'true' : `[ ! -e '${count}' ] || [ $(/usr/bin/wc -l < '${count}') -lt ${omissions} ]`}; then\n echo incomplete >> '${count}'\n printf 'p1\\0\\nf3\\0n/not-owned\\0\\n'\nelse\n echo complete >> '${count}'\n exec /usr/sbin/lsof "$@"\nfi\n`
            );
            chmodSync(utility, 0o700);
            const resultPath = join(root, 'result.json');
            const diagnosticPath = join(root, 'proof-diagnostic.json');
            const program = `
            const {writeFileSync,existsSync,readdirSync}=await import('node:fs');
            const {join}=await import('node:path');
            const {spawn}=await import('node:child_process');
            const {createGuardStorage}=await import(${JSON.stringify(storagePath)});
            const {storageFileState}=await import(${JSON.stringify(guardPath)});
            const reasons=[];const ports={identityState:()=> 'dead',sessionState:(_owner,original,current=original)=>storageFileState([original,current],[],reason=>reasons.push(reason))};
            const storage=createGuardStorage({root:${JSON.stringify(join(root, 'storage'))},token:${JSON.stringify(randomUUID())},owner:${JSON.stringify(fakeOwner)},ports});
            let holder;let closed;
            try {
                if(${consumer}) {
                    holder=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:storage.tempDirectory,stdio:'ignore'});
                    closed=new Promise(resolve=>holder.once('close',resolve));
                    await new Promise((resolve,reject)=>{holder.once('spawn',resolve);holder.once('error',reject)});
                }
                const released=await storage.release(true);
                const claimsRoot=${JSON.stringify(join(root, 'storage', '.claims'))};
                const claimPayloads=readdirSync(claimsRoot).flatMap(claim=>readdirSync(join(claimsRoot,claim)).filter(name=>name!=='claim.json')).length;
                writeFileSync(${JSON.stringify(resultPath)},JSON.stringify({released,exists:existsSync(storage.tempDirectory),claimPayloads}));
                writeFileSync(${JSON.stringify(diagnosticPath)},JSON.stringify(reasons));
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
            expect(JSON.parse(readFileSync(resultPath, 'utf8')), readFileSync(diagnosticPath, 'utf8')).toEqual({
                released,
                exists: !released,
                claimPayloads: 0,
            });
            const samples = readFileSync(count, 'utf8').trim().split('\n');
            expect(samples.slice(0, omissions)).toEqual(Array.from({ length: omissions }, () => 'incomplete'));
            if (!persistent) {
                expect(samples[omissions]).toBe('complete');
            }
            if (released) {
                expect(samples.length).toBeGreaterThanOrEqual(omissions + 2);
                expect(samples.length).toBeLessThanOrEqual(omissions + 3);
                expect(samples.slice(omissions).every((sample) => sample === 'complete')).toBe(true);
            } else {
                expect(samples.length).toBe(persistent ? 3 : omissions + 1);
            }
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

    it.skipIf(process.platform !== 'linux')(
        'reclaims native Linux storage after the last file-using thread exits unreaped',
        async () => {
            const root = fixture();
            const ports: StorageRecoveryPorts = {
                identityState: () => 'dead',
                sessionState: (_owner, original, current = original) =>
                    storageFileState([original, current], [], () => {}, process.pid),
            };
            const storage = ownedStorage(join(root, 'storage'), ports);
            const program = [
                'import os, sys',
                'temp = sys.stdin.readline().rstrip("\\n")',
                'pid = os.fork()',
                'if pid == 0:',
                '    os.chdir(temp)',
                '    fd = os.open("held", os.O_CREAT | os.O_WRONLY, 0o600)',
                '    os.write(fd, b"released on exit")',
                '    os._exit(0)',
                'print(pid, flush=True)',
                'sys.stdin.readline()',
                'os.waitpid(pid, 0)',
            ].join('\n');
            const owner = spawn('python3', ['-c', program], {
                cwd: root,
                env: { PATH: process.env.PATH },
                stdio: ['pipe', 'pipe', 'ignore'],
            });
            let startupError: Error | undefined;
            owner.on('error', (error) => {
                startupError = error;
            });
            let closed = false;
            owner.on('close', () => {
                closed = true;
            });
            owner.stdin.on('error', () => {});
            let output = '';
            owner.stdout.on('data', (chunk: Buffer) => {
                output += chunk.toString();
            });
            if (owner.pid !== undefined) {
                childPids.add(owner.pid);
            }
            try {
                owner.stdin.write(`${storage.tempDirectory}\n`);
                await waitUntil(() => {
                    if (startupError !== undefined) {
                        throw startupError;
                    }
                    return /^\d+\n$/.test(output);
                });
                expect(startupError).toBeUndefined();
                expect(owner.pid).toBeDefined();
                const pid = Number(output.trim());
                expect(Number.isSafeInteger(pid)).toBe(true);
                await waitUntil(() => {
                    const snapshot = parseLinuxFileSnapshot(readFileSync(`/proc/${pid}/status`, 'utf8'));
                    return snapshot?.state === 'Z' && snapshot.threads === 1;
                });
                const snapshot = parseLinuxFileSnapshot(readFileSync(`/proc/${pid}/status`, 'utf8'));
                expect(snapshot).toEqual({
                    pid,
                    tgid: pid,
                    state: 'Z',
                    threads: 1,
                    uids: Array(4).fill(process.getuid?.()),
                });
                expect(isAlive(pid)).toBe(true);
                expect(existsSync(join(storage.tempDirectory, 'held'))).toBe(true);
                expect(await storage.release(true)).toBe(true);
                expect(existsSync(storage.tempDirectory)).toBe(false);
            } finally {
                owner.stdin.end('reap\n');
                await waitUntil(() => closed);
                if (owner.pid !== undefined) {
                    childPids.delete(owner.pid);
                }
            }
        },
        20_000
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

    it.skipIf(process.platform !== 'darwin').each([
        { route: 'local release', consumer: true, missing: false },
        { route: 'startup recovery', consumer: true, missing: false },
        { route: 'unrelated newborn', consumer: false, missing: false },
        { route: 'missing replacement', consumer: false, missing: true },
    ])(
        'checks a borrower born during final file inspection: $route',
        async ({ route, consumer, missing }) => {
            const root = fixture();
            const storageRoot = join(root, 'storage');
            const bin = join(root, 'bin');
            const marker = join(root, 'borrower.json');
            const count = join(root, 'catalog-count');
            const processSamples = join(root, 'process-samples.jsonl');
            mkdirSync(bin, { mode: 0o700 });
            const outside = join(root, 'outside');
            mkdirSync(outside, { mode: 0o700 });
            writeFileSync(join(bin, 'package.json'), '{}\n', { mode: 0o600 });
            // Owner identity is controlled; same-UID process discovery and the detached
            // writer are real. The catalog intentionally freezes before the writer starts.
            const borrowerProgram = `const fs=require('node:fs');const fd=fs.openSync('held','w');fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,cwd:process.cwd()}));setInterval(()=>fs.writeSync(fd,'x'),20);`;
            writeFileSync(
                join(bin, 'lsof'),
                `#!${process.execPath}
const {execFileSync,spawn}=require('node:child_process');
const fs=require('node:fs');const {join}=require('node:path');
const countPath=${JSON.stringify(count)},marker=${JSON.stringify(marker)};
const count=fs.existsSync(countPath)?Number(fs.readFileSync(countPath,'utf8'))+1:1;
fs.writeFileSync(countPath,String(count));
const uid=process.getuid();let catalog='';
for(const row of execFileSync('/bin/ps',['-axo','pid=,uid='],{encoding:'utf8'}).trim().split('\\n')){
 const [pid,user]=row.trim().split(/\\s+/).map(Number);
 if(user===uid){let path='/';if(fs.existsSync(marker)){const borrower=JSON.parse(fs.readFileSync(marker,'utf8'));if(pid===borrower.pid){if(${missing})continue;path=borrower.cwd;}}
 catalog+='p'+pid+'\\0\\nfcwd\\0tDIR\\0n'+path+'\\0\\n';}
}
if(count===${route === 'startup recovery' ? 3 : 2}){
 const claims=join(${JSON.stringify(storageRoot)},'.claims');
 const claim=join(claims,fs.readdirSync(claims)[0]);
 const run=fs.readdirSync(claim).find(name=>name!=='claim.json');
 const child=spawn(process.execPath,['-e',${JSON.stringify(borrowerProgram)}],{cwd:${consumer ? "join(claim,run,'tmp')" : JSON.stringify(outside)},detached:true,stdio:'ignore',env:{PATH:process.env.PATH}});child.unref();
 const deadline=Date.now()+3000;while(!fs.existsSync(marker)&&Date.now()<deadline)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
 if(!fs.existsSync(marker))process.exit(88);
}
process.stdout.write(catalog);
`,
                { mode: 0o700 }
            );
            writeFileSync(
                join(bin, 'ps'),
                `#!${process.execPath}
const {execFileSync}=require('node:child_process');const fs=require('node:fs');
if(process.argv[2]==='-axo'){
 const marker=${JSON.stringify(marker)};const ids=[${process.pid}];
 if(fs.existsSync(marker))ids.push(JSON.parse(fs.readFileSync(marker,'utf8')).pid);
 const output=execFileSync('/bin/ps',['-p',ids.join(','),'-o','pid=,uid='],{encoding:'utf8'});
 fs.appendFileSync(${JSON.stringify(processSamples)},JSON.stringify({catalogCount:fs.existsSync(${JSON.stringify(count)})?Number(fs.readFileSync(${JSON.stringify(count)},'utf8')):0,pids:output.trim().split('\\n').map(row=>Number(row.trim().split(/\\s+/)[0]))})+'\\n');
 process.stdout.write(output);
}else process.stdout.write(execFileSync('/bin/ps',process.argv.slice(2),{encoding:'utf8'}));
`,
                { mode: 0o700 }
            );
            const ports: StorageRecoveryPorts = {
                identityState: () => 'dead',
                sessionState: (_owner, original, current = original) => storageFileState([original, current], []),
            };
            const storage = ownedStorage(storageRoot, ports);
            const identity = statSync(dirname(storage.tempDirectory)).ino;
            const previousPath = process.env.PATH;
            process.env.PATH = `${bin}:${previousPath}`;
            try {
                let released = false;
                if (route !== 'startup recovery') {
                    released = await storage.release(true);
                } else {
                    recoverGuardStorage(storageRoot, ports, fakeReclaimer);
                }
                const borrower: { pid: number; cwd: string } = JSON.parse(readFileSync(marker, 'utf8'));
                childPids.add(borrower.pid);
                expect(isAlive(borrower.pid)).toBe(true);
                const samples: { catalogCount: number; pids: number[] }[] = readFileSync(processSamples, 'utf8')
                    .trim()
                    .split('\n')
                    .map((line) => JSON.parse(line));
                expect(samples[0]?.pids).toEqual([process.pid]);
                expect(
                    samples.find((sample) => sample.catalogCount === (route === 'startup recovery' ? 3 : 2))?.pids
                ).toContain(borrower.pid);
                const reclaimable = !consumer && !missing;
                expect(released).toBe(reclaimable);
                const observedCatalogs = Number(readFileSync(count, 'utf8'));
                if (route !== 'startup recovery') {
                    expect(observedCatalogs).toBe(3);
                }
                const held = join(borrower.cwd, 'held');
                await waitUntil(() => existsSync(held) && statSync(held).size > 0);
                const written = statSync(held).size;
                await waitUntil(() => statSync(held).size > written);
                const payloads = claimPayloads(storageRoot);
                if (reclaimable) {
                    expect(payloads).toHaveLength(0);
                    expect(existsSync(storage.tempDirectory)).toBe(false);
                    await kill(borrower.pid);
                    return;
                }
                expect(payloads).toHaveLength(1);
                const payload = payloads[0];
                if (payload === undefined) {
                    throw new Error('retained claim payload missing');
                }
                expect(statSync(payload).ino).toBe(identity);
                if (consumer) {
                    expect(borrower.cwd).toBe(join(payload, 'tmp'));
                } else {
                    expect(borrower.cwd).toBe(outside);
                }
                recoverGuardStorage(storageRoot, ports, fakeReclaimer);
                expect(existsSync(held)).toBe(true);
                await kill(borrower.pid);
                recoverGuardStorage(storageRoot, ports, fakeReclaimer);
                expect(existsSync(payload)).toBe(false);
            } finally {
                process.env.PATH = previousPath;
            }
        },
        20_000
    );

    it('accepts complete Darwin fileport records without bypassing uncertain fields', async () => {
        const catalog = 'p10\0\nffp.\0tREG\0n/outside/held\0\n';
        expect(parseLsofCensus(catalog)).toEqual({ pids: new Set([10]), paths: ['/outside/held'] });
        for (const fields of [
            'ffp',
            'ffp..',
            'ffp.1',
            'ffpX',
            'ffp.\0tREG',
            'ffp.\0tREG\0nPermission denied',
            'ffp.\0tunknown\0n/outside/held',
            'ffp.\0n/outside/held',
        ]) {
            const output = `p10\0\n${fields}\0\n`;
            expect(parseLsofCensus(output)).toBeUndefined();
            const root = fixture();
            const storage = ownedStorage(root, {
                identityState: () => 'dead',
                sessionState: () => (parseLsofCensus(output) === undefined ? 'unknown' : 'dead'),
            });
            expect(await storage.release(true)).toBe(false);
            expect(existsSync(storage.tempDirectory)).toBe(true);
        }
    });

    it.skipIf(process.platform !== 'darwin').each([
        { payload: 'outside', type: 'REG', expected: 'dead' },
        { payload: 'original', type: 'REG', expected: 'alive' },
        { payload: 'moved claim', type: 'REG', expected: 'alive' },
        { payload: 'original', type: 'DIR', expected: 'alive' },
        { payload: 'moved claim', type: 'DIR', expected: 'alive' },
    ])(
        'inspects complete Darwin fileport paths: $type $payload',
        async ({ payload, type, expected }) => {
            const root = fixture();
            const bin = join(root, 'bin');
            mkdirSync(bin);
            const catalogPath = join(root, 'catalog.json');
            const utility = join(bin, 'lsof');
            writeFileSync(
                utility,
                `#!${process.execPath}\nimport {execFileSync} from 'node:child_process';import {readFileSync} from 'node:fs';const {path,type}=JSON.parse(readFileSync(${JSON.stringify(catalogPath)},'utf8'));const users=execFileSync('ps',['-axo','pid=,uid='],{encoding:'utf8'});for(const row of users.trim().split('\\n')){const [pid,uid]=row.trim().split(/\\s+/).map(Number);if(uid===process.getuid())process.stdout.write('p'+pid+'\\0\\nffp.\\0t'+type+'\\0n'+path+'\\0\\n')}\n`,
                { mode: 0o700 }
            );
            const resultPath = join(root, 'result.json');
            const diagnosticPath = join(root, 'proof-diagnostic.json');
            const program = `
                const {writeFileSync,existsSync}=await import('node:fs');
                const {join}=await import('node:path');
                const {createGuardStorage,reclaimGuardStorage,recoverGuardStorage}=await import(${JSON.stringify(storagePath)});
                const {storageFileState}=await import(${JSON.stringify(guardPath)});
                const root=${JSON.stringify(join(root, 'storage'))};
                const reasons=[];const ports={identityState:()=> 'dead',sessionState:(_owner,original,current=original)=>storageFileState([original,current],[],reason=>reasons.push(reason))};
                writeFileSync(${JSON.stringify(catalogPath)},JSON.stringify({path:${JSON.stringify(root)},type:'REG'}));
                const storage=createGuardStorage({root,token:${JSON.stringify(randomUUID())},owner:${JSON.stringify(fakeOwner)},ports});
                let current=storage.tempDirectory;
                if(${JSON.stringify(payload)}==='moved claim') {
                    const {readFileSync,readdirSync}=await import('node:fs');
                    const {dirname}=await import('node:path');
                    let checks=0;
                    const owner=JSON.parse(readFileSync(join(dirname(current),'owner.json'),'utf8'));
                    if(await reclaimGuardStorage({root,owner,reclaimer:${JSON.stringify(fakeReclaimer)},canRemove:()=>checks++===0}))throw Error('claim unexpectedly removed');
                    const claims=join(root,'.claims');const claim=join(claims,readdirSync(claims)[0]);
                    current=join(claim,readdirSync(claim).find(name=>name!=='claim.json'),'tmp');
                }
                const path=${JSON.stringify(payload)}==='outside'?${JSON.stringify(root)}:${JSON.stringify(type)}==='DIR'?current:join(current,'held');
                writeFileSync(${JSON.stringify(catalogPath)},JSON.stringify({path,type:${JSON.stringify(type)}}));
                const state=storageFileState([storage.tempDirectory,current],[]);
                let released;
                if(${JSON.stringify(payload)}==='moved claim'){await recoverGuardStorage(root,ports,${JSON.stringify(fakeReclaimer)});released=!existsSync(current)}
                else released=await storage.release(true);
                const retained=existsSync(current);
                writeFileSync(${JSON.stringify(catalogPath)},JSON.stringify({path:${JSON.stringify(root)},type:'REG'}));
                await recoverGuardStorage(root,ports,${JSON.stringify(fakeReclaimer)});
                writeFileSync(${JSON.stringify(resultPath)},JSON.stringify({state,released,retained,reclaimed:!existsSync(current)}));
                writeFileSync(${JSON.stringify(diagnosticPath)},JSON.stringify(reasons));
            `;
            const supervisor = spawn(process.execPath, ['--input-type=module', '-e', program], {
                cwd: root,
                stdio: 'ignore',
                env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
            });
            if (supervisor.pid === undefined) {
                throw new Error('fileport proof fixture did not start');
            }
            childPids.add(supervisor.pid);
            await waitUntil(() => existsSync(resultPath) && !isAlive(supervisor.pid ?? -1));
            expect(JSON.parse(readFileSync(resultPath, 'utf8')), readFileSync(diagnosticPath, 'utf8')).toEqual({
                state: expected,
                released: expected === 'dead',
                retained: expected === 'alive',
                reclaimed: true,
            });
        },
        15_000
    );

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
            const recovery = await guarded(root);
            expect(recovery.code, proofDiagnostic(recovery)).toBe(0);
            expect(existsSync(started.tmp), proofDiagnostic(recovery)).toBe(false);
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
