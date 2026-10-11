import { spawn } from 'node:child_process';

type OwnershipDiagnostic = {
    operation: 'inspect' | 'terminate';
    signal: NodeJS.Signals | 0;
    code?: string;
    errno?: number;
};
export type NativeTestResult = {
    code: number | null;
    signal: string | null;
    output: string;
    failure?: string;
    ownershipDiagnostic?: OwnershipDiagnostic;
};

export class NativeCommandOwnershipError extends Error {
    readonly reason: string;
    readonly ownershipDiagnostic?: OwnershipDiagnostic;

    constructor(reason: string, cause?: unknown, ownershipDiagnostic?: OwnershipDiagnostic) {
        const details = ownershipDiagnostic === undefined ? '' : `; ${JSON.stringify(ownershipDiagnostic)}`;
        super(`Native command ownership unconfirmed after SIGKILL: ${reason}${details}`, { cause });
        this.name = 'NativeCommandOwnershipError';
        this.reason = reason;
        this.ownershipDiagnostic = ownershipDiagnostic;
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

function ownedProcessGroup(pid: number | undefined, processPort: Pick<NodeJS.Process, 'kill'>) {
    const ownsGroup = pid !== undefined && Number.isSafeInteger(pid) && pid > 1;
    let groupAbsent = false;
    let failure: string | undefined;
    let cause: unknown;
    let diagnostic: OwnershipDiagnostic | undefined;
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
            return true;
        } catch (error) {
            if (isAbsentProcessGroup(error)) {
                groupAbsent = true;
                return false;
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
            processPort.kill(-pid, signal);
        } catch (error) {
            if (isAbsentProcessGroup(error)) {
                groupAbsent = true;
            } else {
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
        ownershipError: (reason: string) => new NativeCommandOwnershipError(reason, cause, diagnostic),
    };
}

type NativeCommandObservation = {
    child: ReturnType<typeof spawnNativeCommand>;
    ports: NativeCommandPorts;
    resolve: (result: NativeTestResult) => void;
    reject: (error: NativeCommandOwnershipError) => void;
};

function observeNativeCommand(input: NativeCommandObservation): void {
    const { child, ports, resolve, reject } = input;
    const group = ownedProcessGroup(child.pid, ports.process);
    const buffers: Buffer[] = [];
    let size = 0;
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
        resolve(group.result(closed, Buffer.concat(buffers).toString('utf8'), failure));
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
        group.terminate('SIGTERM');
        killTimer = ports.setTimeout(() => {
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
                reject(group.ownershipError(failure ?? reason));
            }, 5_000);
        }, 5_000);
        waitForGroup();
    };
    const interrupt = () => stop('interrupted');
    ports.process.once('SIGINT', interrupt);
    ports.process.once('SIGTERM', interrupt);
    const timeout = ports.setTimeout(() => stop('timeout'), 180_000);
    const collect = (buffer: Buffer) => {
        if (settled) {
            return;
        }
        size += buffer.length;
        if (size > 16 * 1024 * 1024) {
            stop('output-limit');
        } else {
            buffers.push(buffer);
        }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', () => {
        stop('child-start-failed');
    });
    child.on('close', (code, signal) => {
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
    ports: NativeCommandPorts = { spawn: spawnNativeCommand, setTimeout, clearTimeout, process }
): Promise<NativeTestResult> {
    return new Promise((resolve, reject) => {
        const child = ports.spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        observeNativeCommand({ child, ports, resolve, reject });
    });
}
