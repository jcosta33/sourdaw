#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { freemem, platform, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RESOURCE_SESSION_ENV = 'SOURDAW_RESOURCE_SESSION';
export const RESOURCE_ROOT_ENV = 'SOURDAW_RESOURCE_ROOT';
const PROCESS_SESSION_ENV = 'SOURDAW_PROCESS_SESSION';

type ResourceProfile = 'focused' | 'broad' | 'extended';

type LockOwner = {
    token: string;
    pid: number;
    cwd: string;
    command: string;
    startedAt: string;
    processStartedAt: string;
};

type ReservationOwner = LockOwner & {
    reservedRssBytes: number;
    processToken?: string;
    orphanUntil?: number;
};

type ReservationState = {
    recordedAt: number;
    processToken: string;
    childPid?: number;
    childStartedAt?: string;
    trackedProcesses?: Array<{ pid: number; startedAt: string }>;
};

type ReservationRecord = ReservationOwner & Partial<ReservationState>;

export type ResourceLock = {
    path: string;
    token: string;
    release: () => void;
};

export type ResourceSession = {
    root: string;
    reservationPath: string;
    token: string;
    owned: boolean;
    release: () => void;
};

export type GuardedCommandResult = {
    code: number | null;
    signal: NodeJS.Signals | null;
    reason?: 'leak' | 'memory' | 'monitor' | 'pressure' | 'signal' | 'timeout';
    output: string;
    omittedBytes: number;
    peakRssBytes: number;
    durationMs: number;
};

type GuardedCommandInput = {
    command: string;
    args: string[];
    profile: ResourceProfile;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    maxRssBytes?: number;
    timeoutMs?: number;
    outputLimitBytes?: number;
    availableMemoryBytes?: number;
    memorySampler?: () => number | undefined;
    memoryReserveBytes?: number;
    sampleIntervalMs?: number;
    hostSampleIntervalMs?: number;
    admissionRoot?: string;
    admissionWaitIntervalMs?: number;
};

const profiles: Record<ResourceProfile, { maxRssBytes: number; timeoutMs: number }> = {
    focused: { maxRssBytes: 4 * 1024 ** 3, timeoutMs: 10 * 60_000 },
    broad: { maxRssBytes: 4 * 1024 ** 3, timeoutMs: 30 * 60_000 },
    extended: { maxRssBytes: 4 * 1024 ** 3, timeoutMs: 60 * 60_000 },
};

const lockName = 'sourdaw-validation.lock';
const reservationName = 'sourdaw-validation.reservations';
const defaultOutputLimitBytes = 16 * 1024;
const defaultMemoryReserveBytes = 2 * 1024 ** 3;
const minimumCommandBudgetBytes = 512 * 1024 ** 2;
const defaultSampleIntervalMs = 250;
const hostPressureSampleIntervalMs = 2_000;

class OutputTail {
    private value = Buffer.alloc(0);
    private totalBytes = 0;
    private readonly limitBytes: number;

    public constructor(limitBytes: number) {
        this.limitBytes = limitBytes;
    }

    public append(chunk: Buffer): void {
        this.totalBytes += chunk.byteLength;
        this.value = Buffer.concat([this.value, chunk]).subarray(-this.limitBytes);
    }

    public result(): { output: string; omittedBytes: number } {
        return {
            output: this.value.toString('utf8').trim(),
            omittedBytes: Math.max(0, this.totalBytes - this.value.byteLength),
        };
    }
}

function resourceLockPath(root: string): string {
    return join(root, lockName);
}

function resourceReservationRoot(root: string): string {
    return join(root, reservationName);
}

function processStartedAt(pid: number): string | undefined {
    if (platform() === 'win32') {
        const result = spawnSync(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`,
            ],
            { encoding: 'utf8' }
        );
        return result.status === 0 ? result.stdout.trim() || undefined : undefined;
    }
    const result = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' });
    if (result.status !== 0) {
        return undefined;
    }
    return result.stdout.trim() || undefined;
}

function isCurrentProcess(owner: LockOwner): boolean {
    return isSameProcess(owner.pid, owner.processStartedAt);
}

function isSameProcess(pid: number, startedAt: string | undefined): boolean {
    try {
        process.kill(pid, 0);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
            return false;
        }
        return true;
    }
    const currentStart = processStartedAt(pid);
    return currentStart === undefined || startedAt === undefined || currentStart === startedAt;
}

function readOwner(path: string): LockOwner {
    return JSON.parse(readFileSync(join(path, 'owner.json'), 'utf8')) as LockOwner;
}

function withReaper<Result>(path: string, action: () => Result): Result {
    const reaperPath = `${path}.reaper`;
    try {
        mkdirSync(reaperPath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new Error(`validation lock recovery is busy at ${reaperPath}`, { cause: error });
        }
        throw error;
    }
    try {
        return action();
    } finally {
        rmSync(reaperPath, { recursive: true, force: true });
    }
}

export function acquireResourceLock(input: { root?: string; command?: string } = {}): ResourceLock {
    const root = input.root ?? tmpdir();
    const path = resourceLockPath(root);
    const token = randomUUID();
    const candidatePath = `${path}.candidate-${token}`;
    const currentProcessStart = processStartedAt(process.pid);
    if (currentProcessStart === undefined) {
        throw new Error('cannot identify the current process for validation admission');
    }
    const owner: LockOwner = {
        token,
        pid: process.pid,
        cwd: process.cwd(),
        command: input.command ?? process.argv.join(' '),
        startedAt: new Date().toISOString(),
        processStartedAt: currentProcessStart,
    };
    mkdirSync(candidatePath);
    writeFileSync(join(candidatePath, 'owner.json'), `${JSON.stringify(owner, null, 2)}\n`, 'utf8');

    let published = false;
    while (!published) {
        try {
            renameSync(candidatePath, path);
            published = true;
            continue;
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== 'EEXIST' && code !== 'ENOTEMPTY') {
                rmSync(candidatePath, { recursive: true, force: true });
                throw error;
            }
        }

        let current: LockOwner;
        try {
            current = readOwner(path);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                continue;
            }
            try {
                withReaper(path, () => {
                    try {
                        readOwner(path);
                        return;
                    } catch (recheckError) {
                        if ((recheckError as NodeJS.ErrnoException).code === 'ENOENT') {
                            return;
                        }
                    }
                    const corruptPath = `${path}.corrupt-${randomUUID()}`;
                    renameSync(path, corruptPath);
                    rmSync(corruptPath, { recursive: true, force: true });
                });
                continue;
            } catch (recoveryError) {
                rmSync(candidatePath, { recursive: true, force: true });
                throw new Error(`validation lock at ${path} is unreadable and cannot be quarantined`, {
                    cause: recoveryError,
                });
            }
        }
        if (isCurrentProcess(current)) {
            rmSync(candidatePath, { recursive: true, force: true });
            throw new Error(
                `validation is busy: pid ${current.pid} running ${current.command} since ${current.startedAt} from ${current.cwd}`
            );
        }

        try {
            withReaper(path, () => {
                const rechecked = readOwner(path);
                if (rechecked.token !== current.token || isCurrentProcess(rechecked)) {
                    return;
                }
                const stalePath = `${path}.stale-${randomUUID()}`;
                renameSync(path, stalePath);
                rmSync(stalePath, { recursive: true, force: true });
            });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                rmSync(candidatePath, { recursive: true, force: true });
                throw error;
            }
        }
    }

    return {
        path,
        token,
        release: () => {
            try {
                if (readOwner(path).token === token) {
                    rmSync(path, { recursive: true, force: true });
                }
            } catch {
                // Never remove ownership that cannot be proved.
            }
        },
    };
}

type ResourceSessionInput = {
    root?: string;
    command?: string;
    requiredRssBytes?: number;
    availableMemoryBytes?: number;
    memorySampler?: () => number | undefined;
    activeRssSampler?: (owner: ReservationRecord) => number | undefined;
    memoryReserveBytes?: number;
    waitIntervalMs?: number;
    onWait?: (message: string) => void;
    processToken?: string;
    orphanTimeoutMs?: number;
};

function readReservation(path: string): ReservationOwner {
    return JSON.parse(readFileSync(path, 'utf8')) as ReservationOwner;
}

function writeReservation(path: string, owner: ReservationOwner): void {
    const candidate = `${path}.candidate-${randomUUID()}`;
    writeFileSync(candidate, `${JSON.stringify(owner, null, 2)}\n`, 'utf8');
    renameSync(candidate, path);
}

function reservationStatePrefix(path: string): string {
    return `${path.slice(0, -'.json'.length)}.state.`;
}

function readReservationState(path: string): ReservationState | undefined {
    const prefix = reservationStatePrefix(path);
    let latest: ReservationState | undefined;
    for (const name of readdirSync(dirname(path))) {
        const statePath = join(dirname(path), name);
        if (!statePath.startsWith(prefix) || !statePath.endsWith('.json')) {
            continue;
        }
        try {
            const state = JSON.parse(readFileSync(statePath, 'utf8')) as ReservationState;
            if (latest === undefined || state.recordedAt > latest.recordedAt) {
                latest = state;
            }
        } catch {
            // Incomplete candidates never replace the last complete state.
        }
    }
    return latest;
}

function writeReservationState(path: string, state: Omit<ReservationState, 'recordedAt'>): void {
    const statePath = `${reservationStatePrefix(path)}${Date.now()}-${randomUUID()}.json`;
    const candidate = `${statePath}.candidate`;
    writeFileSync(candidate, `${JSON.stringify({ ...state, recordedAt: Date.now() }, null, 2)}\n`, 'utf8');
    renameSync(candidate, statePath);
    const prefix = reservationStatePrefix(path);
    for (const name of readdirSync(dirname(path))) {
        const previousPath = join(dirname(path), name);
        if (previousPath !== statePath && previousPath.startsWith(prefix)) {
            rmSync(previousPath, { force: true });
        }
    }
}

function removeReservation(path: string): void {
    rmSync(path, { force: true });
    const prefix = reservationStatePrefix(path);
    for (const name of readdirSync(dirname(path))) {
        const statePath = join(dirname(path), name);
        if (statePath.startsWith(prefix)) {
            rmSync(statePath, { force: true });
        }
    }
}

function reservationWithState(path: string): ReservationRecord {
    return { ...readReservation(path), ...readReservationState(path) };
}

function reservationRssBytes(owner: ReservationRecord): number | undefined {
    const tracked = new Map<number, string>();
    for (const processIdentity of owner.trackedProcesses ?? []) {
        if (isSameProcess(processIdentity.pid, processIdentity.startedAt)) {
            tracked.set(processIdentity.pid, processIdentity.startedAt);
        }
    }
    if (owner.childPid !== undefined && isSameProcess(owner.childPid, owner.childStartedAt)) {
        tracked.set(owner.childPid, owner.childStartedAt ?? '');
    }
    if (tracked.size > 0) {
        return sampleProcessTree(owner.childPid ?? -1, tracked, owner.processToken ?? 'unowned');
    }
    if (owner.processToken === undefined || platform() === 'win32') {
        return 0;
    }
    const rows = processTable(owner.processToken);
    if (rows === undefined) {
        return undefined;
    }
    return rows.filter((row) => row.sessionOwned).reduce((total, row) => total + row.rssBytes, 0);
}

function reservationIsLive(owner: ReservationRecord): boolean {
    if (isCurrentProcess(owner)) {
        return true;
    }
    if (owner.childPid !== undefined && isSameProcess(owner.childPid, owner.childStartedAt)) {
        return true;
    }
    if ((reservationRssBytes(owner) ?? 0) > 0) {
        return true;
    }
    return owner.processToken !== undefined && (owner.orphanUntil ?? 0) > Date.now();
}

function liveReservations(root: string): Array<{ owner: ReservationRecord; path: string }> {
    mkdirSync(root, { recursive: true });
    const live: Array<{ owner: ReservationRecord; path: string }> = [];
    for (const name of readdirSync(root)) {
        if (!name.endsWith('.json') || name.includes('.state.')) {
            continue;
        }
        const path = join(root, name);
        try {
            const owner = reservationWithState(path);
            if (reservationIsLive(owner)) {
                live.push({ owner, path });
            } else {
                removeReservation(path);
            }
        } catch {
            removeReservation(path);
        }
    }
    return live;
}

function inheritedResourceSession(root: string): ResourceSession | undefined {
    const inheritedToken = process.env[RESOURCE_SESSION_ENV];
    if (inheritedToken === undefined) {
        return undefined;
    }
    const path = join(resourceReservationRoot(root), `${inheritedToken}.json`);
    try {
        const owner = readReservation(path);
        if (owner.token === inheritedToken && isCurrentProcess(owner)) {
            return { root, reservationPath: path, token: inheritedToken, owned: false, release: () => undefined };
        }
    } catch {
        // Invalid inherited state must seek fresh admission.
    }
    return undefined;
}

export async function enterResourceSession(input: ResourceSessionInput = {}): Promise<ResourceSession> {
    const root = input.root ?? process.env[RESOURCE_ROOT_ENV] ?? tmpdir();
    const inherited = inheritedResourceSession(root);
    if (inherited !== undefined) {
        return inherited;
    }

    const reservationsRoot = resourceReservationRoot(root);
    const requiredRssBytes = Math.max(
        input.requiredRssBytes ?? profiles.focused.maxRssBytes,
        minimumCommandBudgetBytes
    );
    const reserveBytes = input.memoryReserveBytes ?? defaultMemoryReserveBytes;
    const readAvailableMemory = input.memorySampler ?? (() => input.availableMemoryBytes ?? availableMemoryBytes());
    const sampleActiveRss = input.activeRssSampler ?? reservationRssBytes;
    const waitIntervalMs = input.waitIntervalMs ?? 1_000;
    const token = randomUUID();
    const reservationPath = join(reservationsRoot, `${token}.json`);
    const processStart = processStartedAt(process.pid);
    if (processStart === undefined) {
        throw new Error('cannot identify the current process for validation admission');
    }
    const owner: ReservationOwner = {
        token,
        pid: process.pid,
        cwd: process.cwd(),
        command: input.command ?? process.argv.join(' '),
        startedAt: new Date().toISOString(),
        processStartedAt: processStart,
        reservedRssBytes: requiredRssBytes,
        ...(input.processToken === undefined ? {} : { processToken: input.processToken }),
        ...(input.processToken === undefined
            ? {}
            : { orphanUntil: Date.now() + (input.orphanTimeoutMs ?? profiles.focused.timeoutMs) }),
    };
    let waitReported = false;

    while (true) {
        let lock: ResourceLock | undefined;
        try {
            lock = acquireResourceLock({ root, command: 'validation admission' });
            const availableBytes = readAvailableMemory();
            if (availableBytes === undefined) {
                throw new Error('available memory could not be measured');
            }
            const reservations = liveReservations(reservationsRoot);
            let activeHeadroomBytes = 0;
            for (const reservation of reservations) {
                const rssBytes = sampleActiveRss(reservation.owner);
                if (rssBytes === undefined) {
                    throw new Error('active validation memory could not be measured');
                }
                activeHeadroomBytes += Math.max(0, reservation.owner.reservedRssBytes - rssBytes);
            }
            const requiredAvailableBytes = reserveBytes + requiredRssBytes + activeHeadroomBytes;
            if (availableBytes >= requiredAvailableBytes) {
                writeReservation(reservationPath, owner);
                return {
                    root,
                    reservationPath,
                    token,
                    owned: true,
                    release: () => removeReservation(reservationPath),
                };
            }
            const message = `waiting for validation capacity: need ${Math.ceil(requiredAvailableBytes / 1024 ** 2)} MiB, ${Math.floor(availableBytes / 1024 ** 2)} MiB available`;
            if (!waitReported) {
                input.onWait?.(message);
                waitReported = true;
            }
        } catch (error) {
            if (!(error instanceof Error) || !error.message.startsWith('validation is busy:')) {
                throw error;
            }
        } finally {
            lock?.release();
        }
        await new Promise((resolve) => setTimeout(resolve, waitIntervalMs));
    }
}

function setSessionProcessIdentity(session: ResourceSession, processToken: string, childPid: number): void {
    if (!session.owned) {
        return;
    }
    const owner = readReservation(session.reservationPath);
    if (owner.token === session.token && isCurrentProcess(owner)) {
        writeReservationState(session.reservationPath, {
            processToken,
            childPid,
            childStartedAt: processStartedAt(childPid),
            trackedProcesses: [],
        });
    }
}

function publishTrackedProcesses(session: ResourceSession, tracked: Map<number, string>): boolean {
    if (!session.owned) {
        return true;
    }
    try {
        const owner = reservationWithState(session.reservationPath);
        if (owner.token !== session.token || !isCurrentProcess(owner)) {
            return false;
        }
        writeReservationState(session.reservationPath, {
            processToken: owner.processToken ?? 'unowned',
            ...(owner.childPid === undefined ? {} : { childPid: owner.childPid }),
            ...(owner.childStartedAt === undefined ? {} : { childStartedAt: owner.childStartedAt }),
            trackedProcesses: [...tracked].map(([pid, startedAt]) => ({ pid, startedAt })),
        });
        return true;
    } catch {
        return false;
    }
}

export function parseCgroupAvailableBytes(limit: string, usage: string): number | undefined {
    if (limit.trim() === 'max') {
        return undefined;
    }
    const limitBytes = Number(limit.trim());
    const usageBytes = Number(usage.trim());
    if (!Number.isFinite(limitBytes) || !Number.isFinite(usageBytes) || limitBytes <= 0 || usageBytes < 0) {
        return undefined;
    }
    if (limitBytes >= 2 ** 60) {
        return undefined;
    }
    return Math.max(0, limitBytes - usageBytes);
}

function cgroupAvailableMemoryBytes(): number | undefined {
    const candidates: Array<readonly [string, string]> = [];
    const addHierarchy = (root: string, relativePath: string, limitName: string, usageName: string) => {
        const segments = relativePath.split('/').filter(Boolean);
        while (true) {
            candidates.push([join(root, ...segments, limitName), join(root, ...segments, usageName)]);
            if (segments.length === 0) {
                break;
            }
            segments.pop();
        }
    };
    try {
        for (const line of readFileSync('/proc/self/cgroup', 'utf8').trim().split('\n')) {
            const [hierarchy, controllers, cgroupPath] = line.split(':');
            if (cgroupPath === undefined) {
                continue;
            }
            const relativePath = cgroupPath.replace(/^\/+/, '');
            if (hierarchy === '0' && controllers === '') {
                addHierarchy('/sys/fs/cgroup', relativePath, 'memory.max', 'memory.current');
            } else if ((controllers ?? '').split(',').includes('memory')) {
                addHierarchy('/sys/fs/cgroup/memory', relativePath, 'memory.limit_in_bytes', 'memory.usage_in_bytes');
            }
        }
    } catch {
        // Standard root paths remain valid outside Linux cgroup namespaces.
    }
    if (candidates.length === 0) {
        candidates.push(
            ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory.current'],
            ['/sys/fs/cgroup/memory/memory.limit_in_bytes', '/sys/fs/cgroup/memory/memory.usage_in_bytes']
        );
    }
    let minimumAvailable: number | undefined;
    for (const [limitPath, usagePath] of candidates) {
        try {
            const available = parseCgroupAvailableBytes(
                readFileSync(limitPath, 'utf8'),
                readFileSync(usagePath, 'utf8')
            );
            if (available !== undefined) {
                minimumAvailable = minimumAvailable === undefined ? available : Math.min(minimumAvailable, available);
            }
        } catch {
            // Try the next cgroup layout.
        }
    }
    return minimumAvailable;
}

export function availableMemoryBytes(): number | undefined {
    if (platform() === 'darwin') {
        const result = spawnSync('memory_pressure', ['-Q'], { encoding: 'utf8' });
        const match = /System-wide memory free percentage:\s*(\d+)%/.exec(`${result.stdout}\n${result.stderr}`);
        if (result.status === 0 && match?.[1] !== undefined) {
            return totalmem() * (Number(match[1]) / 100);
        }
        return undefined;
    }
    if (platform() === 'linux') {
        // freemem() reports MemFree, which the page cache keeps near zero on
        // busy hosts; MemAvailable is the kernel's reclaimable estimate.
        try {
            const memAvailableBytes = parseMemAvailableBytes(readFileSync('/proc/meminfo', 'utf8'));
            if (memAvailableBytes !== undefined) {
                const cgroupAvailableBytes = cgroupAvailableMemoryBytes();
                return cgroupAvailableBytes === undefined
                    ? memAvailableBytes
                    : Math.min(memAvailableBytes, cgroupAvailableBytes);
            }
        } catch {
            // Fall through to freemem() when /proc/meminfo is unreadable.
        }
    }
    return freemem();
}

export function parseMemAvailableBytes(meminfo: string): number | undefined {
    const match = /^MemAvailable:\s*(\d+)\s*kB$/m.exec(meminfo);
    return match?.[1] === undefined ? undefined : Number(match[1]) * 1024;
}

type ProcessRow = {
    pid: number;
    parentPid: number;
    processGroupId: number;
    rssBytes: number;
    sessionOwned: boolean;
    command: string;
};

function processTable(sessionToken?: string): ProcessRow[] | undefined {
    if (platform() === 'win32') {
        const result = spawnSync(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize | ConvertTo-Json -Compress',
            ],
            { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
        );
        if (result.status !== 0 || result.stdout.trim() === '') {
            return undefined;
        }
        try {
            const parsed = JSON.parse(result.stdout) as
                | { ProcessId: number; ParentProcessId: number; WorkingSetSize: number }[]
                | { ProcessId: number; ParentProcessId: number; WorkingSetSize: number };
            return (Array.isArray(parsed) ? parsed : [parsed]).map((row) => ({
                pid: row.ProcessId,
                parentPid: row.ParentProcessId,
                processGroupId: row.ProcessId,
                rssBytes: row.WorkingSetSize,
                sessionOwned: false,
                command: '',
            }));
        } catch {
            return undefined;
        }
    }
    const result = spawnSync(
        'ps',
        sessionToken === undefined
            ? ['-axo', 'pid=,ppid=,pgid=,rss=,command=']
            : ['eww', '-axo', 'pid=,ppid=,pgid=,rss=,command='],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    );
    if (result.status !== 0) {
        return undefined;
    }
    return result.stdout
        .split('\n')
        .map((line) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => ({
            pid: Number(match[1]),
            parentPid: Number(match[2]),
            processGroupId: Number(match[3]),
            rssBytes: Number(match[4]) * 1024,
            sessionOwned:
                sessionToken !== undefined && match[5]?.includes(`${PROCESS_SESSION_ENV}=${sessionToken}`) === true,
            command: match[5] ?? '',
        }));
}

function sessionProcessSummary(sessionToken: string): string {
    return (processTable(sessionToken) ?? [])
        .filter((row) => row.sessionOwned)
        .map((row) => `${row.pid}:${row.command.slice(0, 1_000)}`)
        .join('\n');
}

function sampleProcessTree(rootPid: number, tracked: Map<number, string>, sessionToken: string): number | undefined {
    const rows = processTable(sessionToken);
    if (rows === undefined) {
        return undefined;
    }
    const selected = new Set<number>([
        rootPid,
        ...tracked.keys(),
        ...rows.filter((row) => row.sessionOwned).map((row) => row.pid),
    ]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const row of rows) {
            if (!selected.has(row.pid) && selected.has(row.parentPid)) {
                selected.add(row.pid);
                changed = true;
            }
        }
    }
    let rssBytes = 0;
    for (const row of rows) {
        if (!selected.has(row.pid)) {
            continue;
        }
        rssBytes += row.rssBytes;
        if (!tracked.has(row.pid)) {
            const startedAt = processStartedAt(row.pid);
            if (startedAt !== undefined) {
                tracked.set(row.pid, startedAt);
            }
        }
    }
    return rssBytes;
}

function boundedPositiveInteger(value: string | undefined, cap: number): string {
    const parsed = value === undefined ? Number.NaN : Number(value);
    return String(Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, cap) : cap);
}

function boundedNodeOptions(value: string | undefined): string {
    const pattern = /--max[-_]old[-_]space[-_]size(?:=|\s+)(\d+)/g;
    const limits = [...(value ?? '').matchAll(pattern)].map((match) => Number(match[1]));
    const heapLimit = Math.min(2_048, ...limits.filter((limit) => Number.isFinite(limit) && limit > 0));
    const retained = (value ?? '').replaceAll(pattern, '').trim();
    return `${retained} --max-old-space-size=${heapLimit}`.trim();
}

function boundedEnvironment(
    session: ResourceSession,
    source: NodeJS.ProcessEnv,
    processToken: string
): NodeJS.ProcessEnv {
    return {
        ...source,
        [RESOURCE_SESSION_ENV]: session.token,
        [RESOURCE_ROOT_ENV]: session.root,
        [PROCESS_SESSION_ENV]: processToken,
        NODE_OPTIONS: boundedNodeOptions(source.NODE_OPTIONS),
        CARGO_BUILD_JOBS: boundedPositiveInteger(source.CARGO_BUILD_JOBS, 2),
        RUST_TEST_THREADS: boundedPositiveInteger(source.RUST_TEST_THREADS, 2),
    };
}

function terminateProcessTree(
    pid: number,
    signal: NodeJS.Signals,
    tracked: Map<number, string>,
    sessionToken: string
): void {
    sampleProcessTree(pid, tracked, sessionToken);
    if (platform() === 'win32') {
        spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
        return;
    }
    try {
        process.kill(-pid, signal);
    } catch {
        // The process may exit between the last sample and the signal.
    }
    for (const [trackedPid, startedAt] of [...tracked.entries()].reverse()) {
        if (processStartedAt(trackedPid) !== startedAt) {
            continue;
        }
        try {
            process.kill(trackedPid, signal);
        } catch {
            // The process may exit between identity verification and the signal.
        }
    }
}

function processTreeAlive(pid: number, tracked: Map<number, string>, sessionToken: string): boolean {
    sampleProcessTree(pid, tracked, sessionToken);
    if (platform() !== 'win32') {
        try {
            process.kill(-pid, 0);
            return true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
                return true;
            }
        }
    }
    return [...tracked].some(([trackedPid, startedAt]) => processStartedAt(trackedPid) === startedAt);
}

async function waitForProcessTreeExit(
    pid: number,
    tracked: Map<number, string>,
    sessionToken: string,
    timeoutMs: number
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (processTreeAlive(pid, tracked, sessionToken) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return !processTreeAlive(pid, tracked, sessionToken);
}

export async function runGuardedCommand(input: GuardedCommandInput): Promise<GuardedCommandResult> {
    const profile = profiles[input.profile];
    const timeoutMs = input.timeoutMs ?? profile.timeoutMs;
    const output = new OutputTail(input.outputLimitBytes ?? defaultOutputLimitBytes);
    const memoryReserveBytes = input.memoryReserveBytes ?? defaultMemoryReserveBytes;
    const readAvailableMemory = input.memorySampler ?? (() => input.availableMemoryBytes ?? availableMemoryBytes());
    const maxRssBytes = input.maxRssBytes ?? profile.maxRssBytes;
    const processToken = randomUUID();
    let session: ResourceSession | undefined;
    let recheckWaitReported = false;
    while (session === undefined) {
        const candidate = await enterResourceSession({
            root: input.admissionRoot,
            command: [input.command, ...input.args].join(' '),
            requiredRssBytes: maxRssBytes,
            memorySampler: readAvailableMemory,
            memoryReserveBytes,
            waitIntervalMs: input.admissionWaitIntervalMs,
            onWait: (message) => console.error(message),
            processToken,
            orphanTimeoutMs: timeoutMs,
        });
        const recheckedAvailableBytes = readAvailableMemory();
        if (recheckedAvailableBytes !== undefined && recheckedAvailableBytes >= memoryReserveBytes + maxRssBytes) {
            session = candidate;
            break;
        }
        candidate.release();
        if (!recheckWaitReported) {
            console.error('waiting for validation capacity: memory changed during admission');
            recheckWaitReported = true;
        }
        await new Promise((resolve) => setTimeout(resolve, input.admissionWaitIntervalMs ?? 1_000));
    }
    const ownedSession = session.owned;
    const availableBytes = readAvailableMemory();
    const permittedRssBytes = availableBytes === undefined ? 0 : availableBytes - memoryReserveBytes;
    const requiredBudgetBytes = ownedSession ? maxRssBytes : minimumCommandBudgetBytes;
    if (availableBytes === undefined || permittedRssBytes < requiredBudgetBytes) {
        if (ownedSession) {
            session.release();
        }
        return {
            code: null,
            signal: null,
            reason: 'pressure',
            output:
                availableBytes === undefined
                    ? 'available memory could not be measured'
                    : `available memory leaves less than ${Math.ceil(requiredBudgetBytes / 1024 ** 2)} MiB after the system reserve`,
            omittedBytes: 0,
            peakRssBytes: 0,
            durationMs: 0,
        };
    }
    if (processTable() === undefined) {
        if (ownedSession) {
            session.release();
        }
        return {
            code: null,
            signal: null,
            reason: 'monitor',
            output: 'process memory monitoring is unavailable',
            omittedBytes: 0,
            peakRssBytes: 0,
            durationMs: 0,
        };
    }
    const startedAt = Date.now();
    const tracked = new Map<number, string>();
    const child = spawn(input.command, input.args, {
        cwd: input.cwd ?? process.cwd(),
        env: boundedEnvironment(session, input.env ?? process.env, processToken),
        detached: platform() !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (child.pid !== undefined) {
        const childStartedAt = processStartedAt(child.pid);
        if (childStartedAt !== undefined) {
            tracked.set(child.pid, childStartedAt);
        }
        try {
            setSessionProcessIdentity(session, processToken, child.pid);
        } catch (error) {
            terminateProcessTree(child.pid, 'SIGKILL', tracked, processToken);
            if (ownedSession) {
                session.release();
            }
            throw new Error('validation process identity could not be published', { cause: error });
        }
    }
    child.stdout.on('data', (chunk: Buffer) => output.append(chunk));
    child.stderr.on('data', (chunk: Buffer) => output.append(chunk));

    let peakRssBytes = 0;
    let reason: GuardedCommandResult['reason'];
    let interruptedSignal: NodeJS.Signals | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;
    let processSamplerFailures = 0;
    let hostSamplerFailures = 0;
    let lastHostPressureSample = 0;
    const stop = (nextReason: NonNullable<GuardedCommandResult['reason']>) => {
        const childPid = child.pid;
        if (reason !== undefined || childPid === undefined) {
            return;
        }
        reason = nextReason;
        terminateProcessTree(childPid, 'SIGTERM', tracked, processToken);
        forceKillTimer = setTimeout(() => terminateProcessTree(childPid, 'SIGKILL', tracked, processToken), 5_000);
    };
    const onInterrupt = (signal: NodeJS.Signals) => {
        if (interruptedSignal !== undefined && child.pid !== undefined) {
            terminateProcessTree(child.pid, 'SIGKILL', tracked, processToken);
            return;
        }
        interruptedSignal = signal;
        stop('signal');
    };
    const onSigint = () => onInterrupt('SIGINT');
    const onSigterm = () => onInterrupt('SIGTERM');
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);
    const sample = () => {
        if (child.pid === undefined) {
            return;
        }
        const rssBytes = sampleProcessTree(child.pid, tracked, processToken);
        if (rssBytes === undefined) {
            processSamplerFailures += 1;
            if (processSamplerFailures >= 3) {
                stop('monitor');
            }
            return;
        }
        processSamplerFailures = 0;
        peakRssBytes = Math.max(peakRssBytes, rssBytes);
        if (rssBytes > maxRssBytes) {
            stop('memory');
        }
        const now = Date.now();
        if (now - lastHostPressureSample >= (input.hostSampleIntervalMs ?? hostPressureSampleIntervalMs)) {
            lastHostPressureSample = now;
            if (!publishTrackedProcesses(session, tracked)) {
                stop('monitor');
                return;
            }
            const currentAvailableBytes = readAvailableMemory();
            if (currentAvailableBytes === undefined) {
                hostSamplerFailures += 1;
                if (hostSamplerFailures >= 3) {
                    stop('monitor');
                }
            } else {
                hostSamplerFailures = 0;
                if (currentAvailableBytes < memoryReserveBytes) {
                    stop('pressure');
                }
            }
        }
    };
    sample();
    const sampleTimer = setInterval(sample, input.sampleIntervalMs ?? defaultSampleIntervalMs);
    const timeoutTimer = setTimeout(() => stop('timeout'), timeoutMs);

    try {
        const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
            child.once('error', reject);
            child.once('close', (code, signal) => resolve({ code, signal }));
        });
        if (child.pid !== undefined && reason === undefined) {
            const exitedCleanly = await waitForProcessTreeExit(child.pid, tracked, processToken, 500);
            if (!exitedCleanly) {
                terminateProcessTree(child.pid, 'SIGTERM', tracked, processToken);
                const exitedAfterTerm = await waitForProcessTreeExit(child.pid, tracked, processToken, 1_000);
                if (!exitedAfterTerm) {
                    terminateProcessTree(child.pid, 'SIGKILL', tracked, processToken);
                    const exitedAfterKill = await waitForProcessTreeExit(child.pid, tracked, processToken, 2_000);
                    if (!exitedAfterKill) {
                        output.append(
                            Buffer.from(`\nprocesses survived forced cleanup:\n${sessionProcessSummary(processToken)}`)
                        );
                        reason = 'leak';
                    }
                }
            }
        }
        if (child.pid !== undefined && reason !== undefined) {
            await waitForProcessTreeExit(child.pid, tracked, processToken, 7_000);
        }
        const tail = output.result();
        return {
            ...result,
            signal: interruptedSignal ?? result.signal,
            reason,
            ...tail,
            peakRssBytes,
            durationMs: Date.now() - startedAt,
        };
    } finally {
        clearInterval(sampleTimer);
        clearTimeout(timeoutTimer);
        process.removeListener('SIGINT', onSigint);
        process.removeListener('SIGTERM', onSigterm);
        if (forceKillTimer !== undefined) {
            clearTimeout(forceKillTimer);
        }
        if (ownedSession) {
            session.release();
        }
    }
}

export function emitGuardedResult(label: string, result: GuardedCommandResult, showSuccessOutput = false): number {
    const peakMiB = Math.ceil(result.peakRssBytes / 1024 ** 2);
    const durationSeconds = (result.durationMs / 1000).toFixed(1);
    const succeeded = result.code === 0 && result.reason === undefined;
    if (succeeded) {
        if (showSuccessOutput && result.output !== '') {
            console.log(result.output);
        }
        console.log(`${label}: OK (${durationSeconds}s, peak ${peakMiB} MiB)`);
        return 0;
    }

    const outcome = result.reason ?? `exit ${result.code ?? result.signal ?? 'unknown'}`;
    console.error(`${label}: FAILED (${outcome}, ${durationSeconds}s, peak ${peakMiB} MiB)`);
    if (result.omittedBytes > 0) {
        console.error(`[${result.omittedBytes} earlier output bytes suppressed]`);
    }
    if (result.output !== '') {
        console.error(result.output);
    }
    if (result.reason === 'signal') {
        return result.signal === 'SIGINT' ? 130 : 143;
    }
    return 1;
}

export function hasExplicitTarget(args: string[]): boolean {
    const ignoredRoots = new Set(['.', 'bench', 'check', 'clippy', 'fuzz', 'run', 'scripts', 'src', 'test', 'watch']);
    const scopedOptions = new Set(['--bench', '--bin', '--example', '--package', '--test', '-p']);
    return args.some((argument, index) => {
        if (argument === '--' || argument.startsWith('-') || ignoredRoots.has(argument)) {
            return false;
        }
        const previous = args[index - 1];
        if (previous !== undefined && scopedOptions.has(previous)) {
            return true;
        }
        if (previous !== undefined && previous !== '--' && previous.startsWith('-')) {
            return false;
        }
        return true;
    });
}

type CliInput = {
    profile: ResourceProfile;
    maxRssBytes?: number;
    requireTarget: boolean;
    showOutput: boolean;
    command: string;
    args: string[];
};

export function parseCliArgs(args: string[]): CliInput {
    let profile: ResourceProfile = 'focused';
    let maxRssBytes: number | undefined;
    let requireTarget = false;
    let showOutput = false;
    let index = 0;
    for (; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === '--') {
            index += 1;
            break;
        }
        if (argument === '--profile') {
            const value = args[index + 1];
            if (value !== 'focused' && value !== 'broad' && value !== 'extended') {
                throw new Error('--profile requires focused, broad, or extended');
            }
            profile = value;
            index += 1;
            continue;
        }
        if (argument === '--require-target') {
            requireTarget = true;
            continue;
        }
        if (argument === '--max-rss-mib') {
            const value = Number(args[index + 1]);
            if (!Number.isInteger(value) || value < 512) {
                throw new Error('--max-rss-mib requires an integer of at least 512');
            }
            maxRssBytes = value * 1024 ** 2;
            index += 1;
            continue;
        }
        if (argument === '--show-output') {
            showOutput = true;
            continue;
        }
        throw new Error(`unknown option: ${argument ?? ''}`);
    }
    const command = args[index];
    if (command === undefined) {
        throw new Error('missing command after --');
    }
    const commandArgs = args.slice(index + 1);
    return { profile, maxRssBytes, requireTarget, showOutput, command, args: commandArgs };
}

async function main(): Promise<number> {
    try {
        const input = parseCliArgs(process.argv.slice(2));
        if (input.requireTarget && !hasExplicitTarget(input.args)) {
            throw new Error('target required; specify an affected file, crate, or filter');
        }
        const result = await runGuardedCommand({
            command: input.command,
            args: input.args,
            profile: input.profile,
            maxRssBytes: input.maxRssBytes,
        });
        return emitGuardedResult(input.command, result, input.showOutput);
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        return 1;
    }
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
    process.exit(await main());
}
