/** Runs one owned Git checkpoint and retains bounded, private diagnostic evidence. */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    appendFileSync,
    chmodSync,
    closeSync,
    fstatSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readFileSync,
    readdirSync,
    readSync,
    writeFileSync,
} from 'node:fs';
import { constants as osConstants, homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkpointSocketRows } from './gitCheckpointSocket.ts';
import { checkpointMountOptions } from './gitCheckpointMount.ts';

const script = fileURLToPath(import.meta.url);
const unavailable = 'unavailable';
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function parseRecord(text: string): Record<string, unknown> | null {
    try {
        const value: unknown = JSON.parse(text);
        return isRecord(value) ? value : null;
    } catch {
        return null;
    }
}
function parseStrings(text: string): string[] | null {
    try {
        const value: unknown = JSON.parse(text);
        if (!Array.isArray(value)) {
            return null;
        }
        const entries: unknown[] = value;
        const paths: string[] = [];
        for (const entry of entries) {
            if (typeof entry !== 'string') {
                return null;
            }
            paths.push(entry);
        }
        return paths;
    } catch {
        return null;
    }
}
function errorCode(error: unknown): string {
    if (isRecord(error) && typeof error.code === 'string') {
        return error.code;
    }
    return unavailable;
}
const diagnosticEnv = {
    ...process.env,
    GIT_TRACE2: '0',
    GIT_TRACE2_EVENT: '0',
    GIT_TRACE2_PERF: '0',
    GIT_OPTIONAL_LOCKS: '0',
};
function command(executable: string, args: string[], env = diagnosticEnv, timeout = 750): string | null {
    const result = spawnSync(executable, args, { encoding: 'utf8', env, timeout, maxBuffer: 256 * 1024 });
    return result.status === 0 ? result.stdout.trim() : null;
}
let hashBudget = 32 * 1024 * 1024;
function hash(path: string): { sha256: string } | { error: string } {
    let fd: number | undefined;
    try {
        fd = openSync(path, 'r');
        const before = fstatSync(fd);
        if (!before.isFile() || before.size > hashBudget) {
            return { error: 'not a regular file or aggregate hash budget exceeded' };
        }
        hashBudget -= before.size;
        const buffer = Buffer.alloc(before.size);
        let offset = 0;
        while (offset < buffer.length) {
            const count = readSync(fd, buffer, offset, buffer.length - offset, offset);
            if (!count) {
                break;
            }
            offset += count;
        }
        const after = fstatSync(fd);
        if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
            return { error: 'file changed while hashing' };
        }
        return { sha256: createHash('sha256').update(buffer).digest('hex') };
    } catch (error) {
        return { error: errorCode(error) };
    } finally {
        if (fd !== undefined) {
            closeSync(fd);
        }
    }
}
function info(path: string): object {
    try {
        const s = lstatSync(path);
        return { mode: s.mode, device: s.dev, inode: s.ino, size: s.size, directory: s.isDirectory() };
    } catch (error) {
        return { error: errorCode(error) };
    }
}
function observe(paths: string[], partialPath: string) {
    const partial: Record<string, unknown> = {};
    const checkpoint = (key: string, value: unknown) => {
        partial[key] = value;
        writeFileSync(partialPath, JSON.stringify(partial), { mode: 0o600 });
    };
    checkpoint('head', command('git', ['rev-parse', '--verify', 'HEAD']));
    const common = command('git', ['rev-parse', '--git-common-dir']);
    checkpoint('common', common);
    const objects = process.env.GIT_OBJECT_DIRECTORY ?? command('git', ['rev-parse', '--git-path', 'objects']);
    checkpoint('objects', objects);
    const index = process.env.GIT_INDEX_FILE ?? command('git', ['rev-parse', '--git-path', 'index']);
    checkpoint('index', index ? hash(index) : { error: unavailable });
    const staged = command('git', [
        'diff',
        '--cached',
        '--no-ext-diff',
        '--no-textconv',
        '--name-only',
        '-z',
        '--diff-filter=ACMR',
    ]);
    const stagedPaths = staged?.split('\0').filter(Boolean) ?? [];
    const discovered = [...new Set([...paths, ...stagedPaths])];
    const selected = discovered.slice(0, 256);
    checkpoint('sourceSelection', {
        selected: selected.length,
        omitted: discovered.length - selected.length,
        stagedDiscovery: staged === null ? unavailable : 'complete',
    });
    const sources = new Map<string, object>();
    for (const path of selected) {
        sources.set(path, hash(path));
        checkpoint('sources', Object.fromEntries(sources));
    }
    let fanouts: object = { error: unavailable };
    if (objects) {
        try {
            const names = readdirSync(objects)
                .filter((name) => /^[0-9a-f]{2}$/.test(name))
                .sort();
            fanouts = { names, entries: Object.fromEntries(names.map((name) => [name, info(join(objects, name))])) };
        } catch (error) {
            fanouts = { error: errorCode(error) };
        }
    }
    checkpoint('fanouts', fanouts);
    let df: string | null = null;
    let mounts: string | null = null;
    if (objects) {
        df = command('df', ['-P', objects]);
        mounts = command('mount', []);
    }
    let trace2 = process.env.SOURDAW_CHECKPOINT_TRACE2_INHERITED;
    if (trace2 === '__unset__') {
        trace2 = command('git', ['config', '--show-origin', '--get-all', 'trace2.eventtarget']) ?? undefined;
    }
    return {
        ...partial,
        sources: Object.fromEntries(sources),
        sourceLimit: 256,
        common,
        objects,
        alternates: process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES ?? null,
        objectMetadata: objects ? info(objects) : null,
        fanouts,
        mount: df,
        mountOptions: checkpointMountOptions(df, mounts) ?? unavailable,
        trace2: trace2 ?? unavailable,
    };
}
function inspect(paths: string[], directory: string, phase: string): Promise<Record<string, unknown>> {
    const partialPath = join(directory, `${phase}-partial.json`);
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [script, '--observe', JSON.stringify(paths), partialPath], {
            env: { ...diagnosticEnv, SOURDAW_CHECKPOINT_TRACE2_INHERITED: process.env.GIT_TRACE2_EVENT ?? '__unset__' },
            stdio: ['ignore', 'pipe', 'ignore'],
            detached: true,
        });
        let output = '';
        let done = false;
        const partial = (): Record<string, unknown> => {
            try {
                const snapshot = parseRecord(readFileSync(partialPath, 'utf8'));
                if (snapshot) {
                    return { ...snapshot, incomplete: 'observer failed or timed out' };
                }
            } catch {
                // The observer may fail before producing a snapshot.
            }
            return { error: 'observer failed or timed out' };
        };
        const stop = () => {
            if (done) {
                return;
            }
            done = true;
            // This process group contains only this invocation's read-only observer and children.
            if (child.pid && child.exitCode === null && child.signalCode === null) {
                try {
                    process.kill(-child.pid, 'SIGKILL');
                } catch {
                    /* already exited */
                }
            }
            child.stdout.destroy();
            child.unref();
            resolve(partial());
        };
        const timer = setTimeout(stop, 4000);
        child.stdout.on('data', (chunk: Buffer) => {
            output += chunk.toString();
            if (output.length > 512 * 1024) {
                stop();
            }
        });
        child.on('error', stop);
        child.on('close', () => {
            if (done) {
                return;
            }
            done = true;
            clearTimeout(timer);
            try {
                resolve(parseRecord(output) ?? partial());
            } catch {
                resolve(partial());
            }
        });
    });
}
function processIdentity(pid: number): string | null {
    return command('ps', ['-p', String(pid), '-o', 'pid=,ppid=,pgid=,state=,lstart=,comm=']);
}
function sameProcess(first: string | null, second: string | null): boolean {
    if (!first || !second) {
        return false;
    }
    const stable = (value: string) =>
        value
            .trim()
            .split(/\s+/)
            .filter((_, index) => index !== 3)
            .join(' ');
    return stable(first) === stable(second);
}
function sample(pid: number, identity: string | null): string | null {
    if (process.platform !== 'darwin' || !sameProcess(identity, processIdentity(pid))) {
        return null;
    }
    return command('/usr/bin/sample', [String(pid), '1'], diagnosticEnv, 2500);
}
function watchForStall(
    child: ChildProcess,
    evidence: Record<string, unknown>,
    before: Record<string, unknown>,
    identity: string | null,
    started: bigint,
    save: () => void
): NodeJS.Timeout {
    return setTimeout(() => {
        if (child.exitCode !== null || child.signalCode !== null) {
            return;
        }
        evidence.stall = {
            elapsedNs: (process.hrtime.bigint() - started).toString(),
            sample: 'observation pending',
            receiver: unavailable,
            queue: unavailable,
        };
        save();
        const observer = spawn(
            process.execPath,
            [
                script,
                '--sample',
                String(child.pid),
                identity ?? '',
                JSON.stringify(typeof before.trace2 === 'string' ? before.trace2 : ''),
            ],
            { stdio: ['ignore', 'pipe', 'ignore'], detached: true }
        );
        let output = '';
        const stopObserver = () => {
            if (observer.pid && observer.exitCode === null && observer.signalCode === null) {
                try {
                    process.kill(-observer.pid, 'SIGKILL');
                } catch {
                    /* already exited */
                }
            }
            observer.stdout.destroy();
            observer.unref();
        };
        observer.stdout.on('data', (chunk: Buffer) => {
            output += chunk.toString();
            if (output.length > 256 * 1024) {
                stopObserver();
            }
        });
        const timeout = setTimeout(stopObserver, 6000);
        observer.on('error', () => clearTimeout(timeout));
        observer.on('close', () => {
            clearTimeout(timeout);
            const stall = isRecord(evidence.stall) ? evidence.stall : {};
            const observation = parseRecord(output);
            if (observation) {
                evidence.stall = { ...stall, ...observation };
            } else {
                evidence.stall = { ...stall, sample: unavailable };
            }
            save();
        });
    }, 5000);
}
async function main(args: string[]) {
    if (args[0] !== 'add' && args[0] !== 'commit') {
        console.error('Usage: node scripts/gitCheckpoint.ts add|commit [git arguments]');
        process.exitCode = 2;
        return;
    }
    const root =
        process.env.SOURDAW_CHECKPOINT_DIR ?? join(homedir(), '.agents', 'artifacts', 'sourdaw', 'git-checkpoints');
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const directory = mkdtempSync(join(root, 'checkpoint-'));
    chmodSync(directory, 0o700);
    const receipt = join(directory, 'receipt.json');
    const separator = args.indexOf('--');
    const paths = args[0] === 'add' && separator >= 0 ? args.slice(separator + 1).filter((p) => !isAbsolute(p)) : [];
    const started = process.hrtime.bigint();
    const before = await inspect(paths, directory, 'before');
    const evidence: Record<string, unknown> = {
        version: 1,
        operation: args[0],
        attempts: 1,
        startedAtMonotonicNs: started.toString(),
        before,
        syscallPath: 'unavailable without prearranged authorized syscall tracing',
        receiver: 'unavailable; shared receiver is not sampled',
        sampleIdentityLimit:
            'best-effort ps identity; second-resolution start and non-atomic recheck can race PID reuse',
        timeline: [],
    };
    let diagnosticFailed = false;
    function diagnostic(action: () => void) {
        try {
            action();
        } catch {
            if (!diagnosticFailed) {
                console.error('checkpoint: diagnostic storage unavailable; Git continues');
            }
            diagnosticFailed = true;
        }
    }
    function save() {
        diagnostic(() => writeFileSync(receipt, JSON.stringify(evidence, null, 2), { mode: 0o600 }));
    }
    writeFileSync(receipt, JSON.stringify(evidence, null, 2), { mode: 0o600 });
    console.error(`checkpoint receipt: ${receipt}`);
    evidence.writerStartedAtMonotonicNs = process.hrtime.bigint().toString();
    const child = spawn('git', args, { env: process.env, stdio: ['inherit', 'inherit', 'pipe'] });
    evidence.pid = child.pid ?? null;
    const identity = child.pid ? processIdentity(child.pid) : null;
    evidence.identity = identity;
    console.error(`checkpoint writer PID: ${child.pid ?? unavailable}`);
    save();
    const stderrPath = join(directory, 'stderr.bin');
    diagnostic(() => writeFileSync(stderrPath, '', { mode: 0o600 }));
    evidence.stderr = { path: stderrPath, omittedBytes: 0 };
    save();
    const stderr: Buffer[] = [];
    let stderrSize = 0;
    let omitted = 0;
    child.stderr.on('data', (chunk: Buffer) => {
        process.stderr.write(chunk);
        const keep = Math.max(0, Math.min(chunk.length, 1024 * 1024 - stderrSize));
        if (keep) {
            stderr.push(chunk.subarray(0, keep));
            diagnostic(() => appendFileSync(stderrPath, chunk.subarray(0, keep)));
        }
        stderrSize += keep;
        omitted += chunk.length - keep;
        evidence.stderr = { path: stderrPath, omittedBytes: omitted };
        save();
    });
    const timer = watchForStall(child, evidence, before, identity, started, save);
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: string }>(
        (resolve) => {
            child.on('error', (error) => resolve({ code: null, signal: null, error: error.message }));
            child.on('close', (code, signal) => resolve({ code, signal }));
        }
    );
    clearTimeout(timer);
    evidence.writerExitedAtMonotonicNs = process.hrtime.bigint().toString();
    evidence.exit = exit;
    evidence.elapsedNs = (process.hrtime.bigint() - started).toString();
    evidence.stderr = { path: stderrPath, base64: Buffer.concat(stderr).toString('base64'), omittedBytes: omitted };
    const beforeSources = isRecord(before.sources) ? before.sources : {};
    try {
        evidence.after = await inspect([...new Set([...paths, ...Object.keys(beforeSources)])], directory, 'after');
    } catch {
        evidence.after = { error: 'observer unavailable' };
    }
    save();
    process.exitCode = exit.code ?? (exit.signal ? 128 + osConstants.signals[exit.signal] : 1);
}
if (process.argv[2] === '--sample') {
    const pid = Number(process.argv[3]);
    const initial = process.argv[4] || null;
    const current = processIdentity(pid);
    const rawTrace: unknown = JSON.parse(process.argv[5]);
    const trace = typeof rawTrace === 'string' ? rawTrace : '';
    const socket = trace.match(/af_unix:(?:stream:|dgram:)?(\/[^\s]+)/)?.[1];
    const capturedAtNs = process.hrtime.bigint().toString();
    let holders: string | null = null;
    if (socket) {
        holders = command('/usr/sbin/lsof', ['-t', '-n', '-a', '-U', socket], diagnosticEnv, 1000);
    }
    const holderPids =
        holders
            ?.split(/\s+/)
            .filter((value) => /^\d+$/.test(value))
            .slice(0, 32) ?? [];
    const holderIdentities = holderPids.map((value) =>
        command('ps', ['-p', value, '-o', 'pid=,ppid=,pgid=,state=,lstart='])
    );
    let netstat: ReturnType<typeof spawnSync> | null = null;
    if (socket && process.platform === 'darwin') {
        netstat = spawnSync('/usr/sbin/netstat', ['-anv', '-f', 'unix'], {
            encoding: 'utf8',
            timeout: 1000,
            maxBuffer: 8 * 1024 * 1024,
        });
    }
    const queue =
        socket && netstat?.status === 0 && typeof netstat.stdout === 'string'
            ? checkpointSocketRows(netstat.stdout, socket, pid)
            : null;
    console.log(
        JSON.stringify({
            capturedAtNs,
            identity: current,
            identityMatches: sameProcess(initial, current),
            sample: sample(pid, initial),
            socket,
            socketHolderIdentities: holderIdentities,
            queue: queue ?? unavailable,
        })
    );
} else if (process.argv[2] === '--observe') {
    const paths = parseStrings(process.argv[3]);
    if (paths) {
        console.log(JSON.stringify(observe(paths, process.argv[4])));
    } else {
        console.error('invalid observer paths');
        process.exitCode = 2;
    }
} else {
    await main(process.argv.slice(2));
}
