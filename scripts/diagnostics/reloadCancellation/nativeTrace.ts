import { execFileSync, spawn } from 'node:child_process';
import {
    appendFileSync,
    closeSync,
    constants,
    createReadStream,
    mkdirSync,
    mkdtempSync,
    openSync,
    readFileSync,
    rmdirSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { writeReceipt } from './journal.ts';
import { linuxIdentity } from './linuxProcessIdentity.ts';

// Explicit syscall allowlist: no execve, environment, file contents or network payloads.
export const TRACE_SYSCALLS =
    'wait4,waitid,exit,exit_group,kill,tgkill,mmap,mprotect,munmap,mremap,brk,madvise,pkey_mprotect,clone,clone3,fork,vfork';
const RAW_LIMIT = 8 * 1024 * 1024;
const TAIL_LIMIT = 256 * 1024;
const EVENT_LIMIT = 100_000;

export type NativeEvent = {
    pid: number;
    timestamp: number;
    kind: string;
    detail: string;
    code?: number;
    signal?: string;
    childPid?: number;
};

export function parseNativeLine(line: string): NativeEvent | undefined {
    const match = /^(\d+)\s+(\d+\.\d+)\s+(.*)$/.exec(line);
    if (!match) {
        return undefined;
    }
    const [, pid, timestamp, detail = ''] = match;
    const base = { pid: Number(pid), timestamp: Number(timestamp), detail };
    const exited = /^\+\+\+ exited with (\d+) \+\+\+$/.exec(detail);
    if (exited) {
        return { ...base, kind: 'exit', code: Number(exited[1]) };
    }
    const killed = /^\+\+\+ killed by (SIG[A-Z0-9]+)(?: \(core dumped\))? \+\+\+$/.exec(detail);
    if (killed) {
        return { ...base, kind: 'signal-exit', signal: killed[1] };
    }
    if (/^(?:clone|clone3|fork|vfork)\(|^<\.\.\. (?:clone|clone3|fork|vfork) resumed>/.test(detail)) {
        const child = / = ([1-9][0-9]*)$/.exec(detail);
        const creation: NativeEvent = { ...base, kind: 'process-creation' };
        if (child) {
            creation.childPid = Number(child[1]);
        }
        return creation;
    }
    if (/^(?:mmap|mprotect|munmap|mremap|brk|madvise|pkey_mprotect)\(/.test(detail) && / = -1 [A-Z0-9]+/.test(detail)) {
        return { ...base, kind: 'memory-syscall-failure' };
    }
    if (
        /<\.\.\. (?:mmap|mprotect|munmap|mremap|brk|madvise|pkey_mprotect) resumed>/.test(detail) &&
        / = -1 [A-Z0-9]+/.test(detail)
    ) {
        return { ...base, kind: 'memory-syscall-failure' };
    }
    if (
        /^(?:wait4|waitid|kill|tgkill|exit|exit_group)\(|^<\.\.\. (?:wait4|waitid|kill|tgkill) resumed>|^--- SIG/.test(
            detail
        )
    ) {
        return { ...base, kind: 'native-control' };
    }
    return undefined;
}

export function assertTraceControl(
    events: readonly NativeEvent[],
    producer: { pid: number; code: number | null; signal: string | null },
    capture: { complete: boolean; partialLine: boolean; droppedEvents: number }
): void {
    if (!capture.complete || capture.partialLine || capture.droppedEvents !== 0) {
        throw new Error('Native control trace is incomplete or truncated');
    }
    const exits = events.filter((event) => event.pid === producer.pid && ['exit', 'signal-exit'].includes(event.kind));
    if (
        exits.length !== 1 ||
        exits[0]?.code !== (producer.code ?? undefined) ||
        exits[0]?.signal !== (producer.signal ?? undefined)
    ) {
        throw new Error('Native control producer PID/status/signal differs from actual parent wait result');
    }
}

export function preserveNativeTermination(
    result: { code: number | null; signal: NodeJS.Signals | null },
    ports: { signal: (signal: NodeJS.Signals) => void; code: (code: number) => void; unknown: () => void }
): void {
    if (result.signal) {
        ports.signal(result.signal);
        return;
    }
    if (result.code !== null) {
        ports.code(result.code);
        return;
    }
    ports.unknown();
    ports.code(1);
}

export async function traceCommand(
    command: string,
    args: string[],
    output: string,
    browserPipes: boolean
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    mkdirSync(output, { recursive: true });
    const raw = resolve(output, 'raw-prefix.log');
    writeFileSync(raw, '', { flag: 'wx' });
    const events = resolve(output, 'events.jsonl');
    writeFileSync(events, '', { flag: 'wx' });
    writeReceipt(resolve(output, 'capture.json'), {
        complete: false,
        unknown: 'Trace started; terminal/tail and final drop accounting not yet observed',
    });
    // Keep special files outside the uploaded evidence tree, including after group SIGKILL.
    const fifoDirectory = mkdtempSync(resolve(tmpdir(), 'reload-native-trace-'));
    const fifo = resolve(fifoDirectory, 'trace.fifo');
    execFileSync('/usr/bin/mkfifo', ['-m', '600', fifo]);
    // The anchor prevents an open-reader deadlock if strace refuses before opening
    // its output. Closing it after child close exposes the real final FIFO EOF.
    const anchor = openSync(fifo, constants.O_RDWR | constants.O_NONBLOCK);
    const stream = createReadStream(fifo);
    await new Promise<void>((resolve, reject) => {
        stream.once('open', () => resolve());
        stream.once('error', reject);
    });
    // strace(1): -qq suppresses the very terminal statuses this control must retain.
    // https://man7.org/linux/man-pages/man1/strace.1.html
    const child = spawn(
        '/usr/bin/strace',
        ['-f', '-q', '-ttt', '-e', `trace=${TRACE_SYSCALLS}`, '-o', fifo, '--', command, ...args],
        {
            stdio: browserPipes ? [0, 1, 2, 3, 4] : ['ignore', 'inherit', 'inherit'],
            detached: false,
        }
    );
    if (!child.pid) {
        throw new Error('Native tracer PID unavailable');
    }
    const traceInstance = {
        wrapper: linuxIdentity(process.pid, process.pid),
        tracer: linuxIdentity(child.pid, process.pid),
    };
    writeReceipt(resolve(output, 'capture.json'), {
        complete: false,
        traceInstance,
        unknown: 'Native capture has not reached its terminal EOF',
    });
    let total = 0;
    let retained = 0;
    let tail = Buffer.alloc(0);
    let partial = '';
    let emitted = 0;
    let droppedEvents = 0;
    let streamEnded = false;
    let streamError: string | undefined;
    let spawnError: string | undefined;
    const drained = new Promise<void>((resolve) => {
        stream.once('end', resolve);
        stream.once('error', () => resolve());
    });
    const record = (line: string): void => {
        const event = parseNativeLine(line);
        if (!event) {
            return;
        }
        if (emitted >= EVENT_LIMIT) {
            droppedEvents++;
            return;
        }
        appendFileSync(events, `${JSON.stringify(event)}\n`);
        emitted++;
    };
    stream.on('data', (chunk: Buffer) => {
        total += chunk.length;
        const prefix = chunk.subarray(0, Math.max(0, RAW_LIMIT - retained));
        if (prefix.length > 0) {
            appendFileSync(raw, prefix);
        }
        retained += prefix.length;
        tail = Buffer.concat([tail, chunk]).subarray(-TAIL_LIMIT);
        const lines = (partial + chunk.toString('utf8')).split('\n');
        partial = lines.pop() ?? '';
        for (const line of lines) {
            record(line);
        }
        if (partial.length > 64 * 1024) {
            droppedEvents++;
            partial = '';
        }
    });
    stream.on('end', () => {
        streamEnded = true;
    });
    stream.on('error', (error: Error) => {
        streamError = String(error);
    });
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.once('error', (error) => {
            spawnError = String(error);
        });
        child.once('close', (code, signal) => resolve({ code, signal }));
    });
    closeSync(anchor);
    await drained;
    unlinkSync(fifo);
    rmdirSync(fifoDirectory);
    writeFileSync(resolve(output, 'raw-tail.log'), tail);
    writeReceipt(resolve(output, 'capture.json'), {
        tracerPid: child.pid,
        traceInstance,
        tracerResult: result,
        complete: streamEnded && !streamError && !spawnError,
        partialLine: partial.length > 0,
        streamError,
        spawnError,
        totalBytes: total,
        prefixBytes: retained,
        rawDroppedBytes: Math.max(0, total - retained - tail.length),
        rawTailBytes: tail.length,
        emittedEvents: emitted,
        droppedEvents,
        limits: [
            'Tracer PID is not browser PID.',
            'Missing terminal records remain unknown.',
            'SIGTRAP does not establish OOM.',
            'brk can fail without errno; raw trace remains necessary.',
            'Creation records retain TIDs and clone flags for offline interpretation; unmatched TIDs remain unknown.',
        ],
    });
    return result;
}

export function readNativeEvents(output: string): NativeEvent[] {
    return readFileSync(resolve(output, 'events.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as NativeEvent);
}
