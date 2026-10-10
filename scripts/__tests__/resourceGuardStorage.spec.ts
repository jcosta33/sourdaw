import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
    existsSync,
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

import { main, parseCliArgs, runGuardedCommand } from '../resourceGuard';
import {
    createGuardStorage,
    diskStorageFailure,
    reclaimGuardStorage,
    recoverGuardStorage,
    resolveGuardStorageRoot,
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

async function waitUntil(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 10_000;
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
