import { spawn } from 'node:child_process';

import {
    createNativeCommandDiagnostics,
    type OwnershipDiagnostic,
    type ProcessDiagnostic,
} from './nativeCommandDiagnostics.ts';

import type { ProcessGroupSnapshot } from './processSnapshot.ts';

export type NativeTestResult = {
    code: number | null;
    signal: string | null;
    output: string;
    failure?: string;
    ownershipDiagnostic?: OwnershipDiagnostic;
    processDiagnostic?: ProcessDiagnostic;
};

export class NativeCommandOwnershipError extends Error {
    readonly reason: string;
    readonly ownershipDiagnostic?: OwnershipDiagnostic;
    readonly output: string;
    readonly processDiagnostic?: ProcessDiagnostic;

    constructor(
        reason: string,
        cause?: unknown,
        ownershipDiagnostic?: OwnershipDiagnostic,
        output = '',
        processDiagnostic?: ProcessDiagnostic
    ) {
        const details = ownershipDiagnostic === undefined ? '' : `; ${JSON.stringify(ownershipDiagnostic)}`;
        super(
            `Native command ownership unconfirmed after SIGKILL: ${reason}${details}${processDiagnostic === undefined ? '' : `; ${JSON.stringify(processDiagnostic)}`}`,
            { cause }
        );
        this.name = 'NativeCommandOwnershipError';
        this.reason = reason;
        this.ownershipDiagnostic = ownershipDiagnostic;
        this.output = output;
        this.processDiagnostic = processDiagnostic;
    }
}

function spawnNativeCommand(
    command: string,
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv; detached: boolean; stdio: ['ignore', 'pipe', 'pipe'] }
) {
    return spawn(command, args, options);
}

type NativeCommandPorts = {
    spawn: typeof spawnNativeCommand;
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
    process: Pick<NodeJS.Process, 'kill' | 'once' | 'removeListener'>;
    snapshot?: (pid: number) => ProcessGroupSnapshot;
    now?: () => number;
};

function isAbsentProcessGroup(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH';
}

function ownershipDiagnostic(
    error: unknown,
    operation: OwnershipDiagnostic['operation'],
    signal: NodeJS.Signals | 0
): OwnershipDiagnostic {
    const diagnostic: OwnershipDiagnostic = { operation, signal };
    if (typeof error !== 'object' || error === null) {
        return diagnostic;
    }
    if ('code' in error && typeof error.code === 'string' && /^E[A-Z0-9_]{1,31}$/u.test(error.code)) {
        diagnostic.code = error.code;
    }
    if (
        'errno' in error &&
        typeof error.errno === 'number' &&
        Number.isInteger(error.errno) &&
        Math.abs(error.errno) <= 4095
    ) {
        diagnostic.errno = error.errno;
    }
    return diagnostic;
}

function ownedProcessGroup(
    pid: number | undefined,
    processPort: Pick<NodeJS.Process, 'kill'>,
    observe: (event: string, diagnostic?: OwnershipDiagnostic) => void
) {
    const ownsGroup = pid !== undefined && Number.isSafeInteger(pid) && pid > 1;
    let groupAbsent = false;
    let failure: string | undefined;
    let cause: unknown;
    let diagnostic: OwnershipDiagnostic | undefined;
    let provisional: { cause: unknown; diagnostic: OwnershipDiagnostic } | undefined;
    const alive = () => {
        if (pid === undefined || groupAbsent) {
            return false;
        }
        if (!ownsGroup) {
            failure = 'child-pid-invalid';
            return true;
        }
        try {
            processPort.kill(-pid, 0);
            observe('inspect-present');
            return true;
        } catch (error) {
            if (isAbsentProcessGroup(error)) {
                groupAbsent = true;
                provisional = undefined;
                observe('inspect-absent');
                return false;
            }
            observe('inspect-error', ownershipDiagnostic(error, 'inspect', 0));
            // Darwin can retain an all-zombie group until reap; only ESRCH retires its identity.
            if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EPERM') {
                provisional ??= { cause: error, diagnostic: ownershipDiagnostic(error, 'inspect', 0) };
                return true;
            }
            failure = 'child-group-inspection-failed';
            cause = error;
            diagnostic ??= ownershipDiagnostic(error, 'inspect', 0);
            return true;
        }
    };
    const terminate = (signal: NodeJS.Signals) => {
        if (!ownsGroup || !alive() || pid === undefined) {
            return;
        }
        try {
            observe(`signal-${signal}`);
            processPort.kill(-pid, signal);
        } catch (error) {
            if (isAbsentProcessGroup(error)) {
                groupAbsent = true;
                provisional = undefined;
            } else {
                observe('signal-error', ownershipDiagnostic(error, 'terminate', signal));
                failure = 'child-termination-failed';
                cause = error;
                diagnostic ??= ownershipDiagnostic(error, 'terminate', signal);
            }
        }
    };
    const result = (
        closed: Pick<NativeTestResult, 'code' | 'signal'>,
        output: string,
        reason?: string
    ): NativeTestResult => {
        const completed: NativeTestResult = { ...closed, output };
        if (reason !== undefined) {
            completed.failure = failure === undefined ? reason : `${reason}: ${failure}`;
        }
        if (diagnostic !== undefined) {
            completed.ownershipDiagnostic = diagnostic;
        }
        return completed;
    };
    return {
        alive,
        terminate,
        result,
        ownershipError: (reason: string, output: string, processDiagnostic: ProcessDiagnostic) =>
            new NativeCommandOwnershipError(
                reason,
                diagnostic === undefined ? provisional?.cause : cause,
                diagnostic ?? provisional?.diagnostic,
                output,
                processDiagnostic
            ),
    };
}

type NativeCommandObservation = {
    child: ReturnType<typeof spawnNativeCommand>;
    ports: NativeCommandPorts;
    resolve: (result: NativeTestResult) => void;
    reject: (error: NativeCommandOwnershipError) => void;
    timeoutMs: number;
};

function createOutputCollector(isSettled: () => boolean, stop: (reason: string) => void) {
    const buffers: Buffer[] = [];
    let size = 0;
    const collect = (buffer: Buffer) => {
        if (isSettled()) {
            return;
        }
        size += buffer.length;
        if (size > 16 * 1024 * 1024) {
            stop('output-limit');
        } else {
            buffers.push(buffer);
        }
    };
    return { buffers, collect };
}

function observeNativeCommand(input: NativeCommandObservation): void {
    const { child, ports, resolve, reject, timeoutMs } = input;
    const { processDiagnostic, observe, finalUncertainty } = createNativeCommandDiagnostics(child.pid, ports);
    observe('spawn');
    const group = ownedProcessGroup(child.pid, ports.process, observe);
    const { buffers, collect } = createOutputCollector(
        () => settled,
        (reason) => stop(reason)
    );
    let failure: string | undefined;
    let closed: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    let terminating = false;
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let confirmationTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
        ports.clearTimeout(timeout);
        ports.clearTimeout(killTimer);
        ports.clearTimeout(confirmationTimer);
        ports.clearTimeout(pollTimer);
        ports.process.removeListener('SIGINT', interrupt);
        ports.process.removeListener('SIGTERM', interrupt);
    };
    const finish = () => {
        if (settled) {
            return true;
        }
        if (closed === undefined || group.alive()) {
            return false;
        }
        settled = true;
        cleanup();
        const result = group.result(closed, Buffer.concat(buffers).toString('utf8'), failure);
        if (processDiagnostic.firstUncertainty !== undefined) {
            result.processDiagnostic = processDiagnostic;
        }
        resolve(result);
        return true;
    };
    const waitForGroup = () => {
        if (finish() || pollTimer !== undefined) {
            return;
        }
        pollTimer = ports.setTimeout(() => {
            pollTimer = undefined;
            waitForGroup();
        }, 50);
    };
    const stop = (reason: string) => {
        if (settled) {
            return;
        }
        failure ??= reason;
        if (terminating) {
            return;
        }
        terminating = true;
        observe(`stop-${reason}`);
        group.terminate('SIGTERM');
        killTimer = ports.setTimeout(() => {
            observe('escalate');
            group.terminate('SIGKILL');
            if (finish()) {
                return;
            }
            confirmationTimer = ports.setTimeout(() => {
                if (finish()) {
                    return;
                }
                settled = true;
                cleanup();
                observe('confirmation-failed');
                finalUncertainty();
                reject(
                    group.ownershipError(failure ?? reason, Buffer.concat(buffers).toString('utf8'), processDiagnostic)
                );
            }, 5_000);
        }, 5_000);
        waitForGroup();
    };
    const interrupt = () => stop('interrupted');
    ports.process.once('SIGINT', interrupt);
    ports.process.once('SIGTERM', interrupt);
    const timeout = ports.setTimeout(() => stop('timeout'), timeoutMs);
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', () => {
        stop('child-start-failed');
    });
    child.on('close', (code, signal) => {
        observe('close');
        closed = { code, signal };
        if (finish()) {
            return;
        }
        stop('child-descendants-survived');
        waitForGroup();
    });
}

export function runCommand(
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    ports: NativeCommandPorts = { spawn: spawnNativeCommand, setTimeout, clearTimeout, process },
    options: { timeoutMs?: number } = {}
): Promise<NativeTestResult> {
    const timeoutMs = options.timeoutMs ?? 180_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
        throw new Error('Native command timeout must be a positive timer-safe integer');
    }
    return new Promise((resolve, reject) => {
        const child = ports.spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        observeNativeCommand({ child, ports, resolve, reject, timeoutMs });
    });
}
