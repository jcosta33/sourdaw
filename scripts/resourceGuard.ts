#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { freemem, platform, tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RESOURCE_SESSION_ENV = 'SOURDAW_RESOURCE_SESSION';
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

export type ResourceLock = {
    path: string;
    token: string;
    release: () => void;
};

export type ResourceSession = {
    lockPath: string;
    token: string;
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
    session?: ResourceSession;
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
};

const profiles: Record<ResourceProfile, { maxRssBytes: number; timeoutMs: number }> = {
    focused: { maxRssBytes: 4 * 1024 ** 3, timeoutMs: 10 * 60_000 },
    broad: { maxRssBytes: 4 * 1024 ** 3, timeoutMs: 30 * 60_000 },
    extended: { maxRssBytes: 4 * 1024 ** 3, timeoutMs: 60 * 60_000 },
};

const lockName = 'sourdaw-validation.lock';
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
    try {
        process.kill(owner.pid, 0);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
            return false;
        }
        return true;
    }
    const currentStart = processStartedAt(owner.pid);
    return (
        currentStart === undefined ||
        typeof owner.processStartedAt !== 'string' ||
        currentStart === owner.processStartedAt
    );
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

export function enterResourceSession(input: { root?: string; command?: string } = {}): ResourceSession {
    const path = resourceLockPath(input.root ?? tmpdir());
    const inheritedToken = process.env[RESOURCE_SESSION_ENV];
    if (inheritedToken !== undefined) {
        try {
            const owner = readOwner(path);
            if (owner.token === inheritedToken && isCurrentProcess(owner)) {
                return { lockPath: path, token: inheritedToken, release: () => undefined };
            }
        } catch {
            // Invalid inherited state must compete for the lock normally.
        }
    }

    const lock = acquireResourceLock(input);
    return { lockPath: lock.path, token: lock.token, release: lock.release };
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
    return freemem();
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
    const ownedSession = input.session === undefined;
    const session = input.session ?? enterResourceSession({ command: [input.command, ...input.args].join(' ') });
    const profile = profiles[input.profile];
    const timeoutMs = input.timeoutMs ?? profile.timeoutMs;
    const output = new OutputTail(input.outputLimitBytes ?? defaultOutputLimitBytes);
    const memoryReserveBytes = input.memoryReserveBytes ?? defaultMemoryReserveBytes;
    const readAvailableMemory = input.memorySampler ?? (() => input.availableMemoryBytes ?? availableMemoryBytes());
    const availableBytes = readAvailableMemory();
    const permittedRssBytes = availableBytes === undefined ? 0 : availableBytes - memoryReserveBytes;
    if (availableBytes === undefined || permittedRssBytes < minimumCommandBudgetBytes) {
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
                    : `available memory leaves less than ${Math.ceil(minimumCommandBudgetBytes / 1024 ** 2)} MiB after the system reserve`,
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
    const maxRssBytes = Math.min(input.maxRssBytes ?? profile.maxRssBytes, permittedRssBytes);

    const startedAt = Date.now();
    const processToken = randomUUID();
    const child = spawn(input.command, input.args, {
        cwd: input.cwd ?? process.cwd(),
        env: boundedEnvironment(session, input.env ?? process.env, processToken),
        detached: platform() !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk: Buffer) => output.append(chunk));
    child.stderr.on('data', (chunk: Buffer) => output.append(chunk));

    let peakRssBytes = 0;
    let reason: GuardedCommandResult['reason'];
    let interruptedSignal: NodeJS.Signals | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;
    let processSamplerFailures = 0;
    let hostSamplerFailures = 0;
    let lastHostPressureSample = 0;
    const tracked = new Map<number, string>();
    if (child.pid !== undefined) {
        const childStartedAt = processStartedAt(child.pid);
        if (childStartedAt !== undefined) {
            tracked.set(child.pid, childStartedAt);
        }
    }
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
    requireTarget: boolean;
    showOutput: boolean;
    command: string;
    args: string[];
};

export function parseCliArgs(args: string[]): CliInput {
    let profile: ResourceProfile = 'focused';
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
    return { profile, requireTarget, showOutput, command, args: commandArgs };
}

async function main(): Promise<number> {
    try {
        const input = parseCliArgs(process.argv.slice(2));
        if (input.requireTarget && !hasExplicitTarget(input.args)) {
            throw new Error('target required; specify an affected file, crate, or filter');
        }
        const result = await runGuardedCommand({ command: input.command, args: input.args, profile: input.profile });
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
