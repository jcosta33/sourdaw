/** Runs one owned Git checkpoint and retains bounded, private diagnostic evidence. */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    appendFileSync,
    constants as fsConstants,
    chmodSync,
    closeSync,
    fstatSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readFileSync,
    readlinkSync,
    readdirSync,
    readSync,
    writeFileSync,
} from 'node:fs';
import { constants as osConstants, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkpointArguments } from './gitCheckpointArguments.ts';
import { checkpointDiscovery, selectCheckpointSources } from './gitCheckpointDiscovery.ts';
import { checkpointMountOptions } from './gitCheckpointMount.ts';
import { command, diagnosticEnv, processIdentity, runCheckpointSample } from './gitCheckpointProcess.ts';

import type { Readable } from 'node:stream';

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
function parseJsonString(text: string | undefined): string | null {
    if (text === undefined) {
        return null;
    }
    try {
        const value: unknown = JSON.parse(text);
        return typeof value === 'string' ? value : null;
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
let hashBudget = 32 * 1024 * 1024;
function hash(path: string, noFollow = false): { sha256: string } | { error: string } {
    let fd: number | undefined;
    try {
        const flags = noFollow ? fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW : fsConstants.O_RDONLY;
        fd = openSync(path, flags);
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
function hashSource(path: string): { sha256: string; kind?: 'symlink' } | { error: string } {
    try {
        const before = lstatSync(path);
        if (!before.isSymbolicLink()) {
            return hash(path, true);
        }
        if (before.size > hashBudget) {
            return { error: 'aggregate hash budget exceeded' };
        }
        const link = readlinkSync(path, { encoding: 'buffer' });
        const after = lstatSync(path);
        if (
            !after.isSymbolicLink() ||
            before.dev !== after.dev ||
            before.ino !== after.ino ||
            before.size !== after.size ||
            before.mtimeMs !== after.mtimeMs ||
            link.length !== before.size
        ) {
            return { error: 'file changed while hashing' };
        }
        if (link.length > hashBudget) {
            return { error: 'aggregate hash budget exceeded' };
        }
        hashBudget -= link.length;
        return { kind: 'symlink', sha256: createHash('sha256').update(link).digest('hex') };
    } catch (error) {
        return { error: errorCode(error) };
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
function observe(
    paths: string[],
    partialPath: string,
    discover: boolean,
    includeIgnored: boolean,
    trackedOnly: boolean,
    conservative: boolean,
    includeUntracked: boolean
) {
    const partial: Record<string, unknown> = {};
    const checkpoint = (key: string, value: unknown) => {
        partial[key] = value;
        writeFileSync(partialPath, JSON.stringify(partial), { mode: 0o600 });
    };
    checkpoint('head', command('git', ['rev-parse', '--verify', 'HEAD']));
    checkpoint('gitVersion', command('git', ['--version']) ?? unavailable);
    const common = command('git', ['rev-parse', '--git-common-dir']);
    checkpoint('common', common);
    const objects = process.env.GIT_OBJECT_DIRECTORY ?? command('git', ['rev-parse', '--git-path', 'objects']);
    checkpoint('objects', objects);
    const index = process.env.GIT_INDEX_FILE ?? command('git', ['rev-parse', '--git-path', 'index']);
    checkpoint('index', index ? hash(index) : { error: unavailable });
    const staged = command(
        'git',
        [
            'diff',
            '--cached',
            '--no-ext-diff',
            '--no-textconv',
            '--no-relative',
            '--name-only',
            '-z',
            '--diff-filter=ACMR',
        ],
        diagnosticEnv,
        750,
        true
    );
    const { selected, sourceSelection } = selectCheckpointSources(
        paths,
        staged,
        discover,
        includeIgnored,
        trackedOnly,
        conservative,
        includeUntracked
    );
    checkpoint('sourceSelection', sourceSelection);
    const sources = new Map<string, object>();
    for (const path of selected) {
        sources.set(path, hashSource(path));
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
function inspect(
    paths: string[],
    directory: string,
    phase: string,
    discover = false,
    includeIgnored = false,
    trackedOnly = false,
    conservative = false,
    includeUntracked = false
): Promise<Record<string, unknown>> {
    const partialPath = join(directory, `${phase}-partial.json`);
    return new Promise((resolve) => {
        const request = JSON.stringify({
            paths,
            discover,
            includeIgnored,
            trackedOnly,
            conservative,
            includeUntracked,
        });
        if (Buffer.byteLength(request) > 4 * 1024 * 1024) {
            resolve({ error: 'observer request exceeds 4 MiB' });
            return;
        }
        const child = spawn(process.execPath, [script, '--observe', partialPath], {
            env: { ...diagnosticEnv, SOURDAW_CHECKPOINT_TRACE2_INHERITED: process.env.GIT_TRACE2_EVENT ?? '__unset__' },
            stdio: ['pipe', 'pipe', 'ignore'],
            detached: true,
        });
        let output = '';
        let done = false;
        child.stdin.on('error', () => {});
        child.stdin.end(request);
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
function readObservation(path: string): Record<string, unknown> | null {
    try {
        return parseRecord(readFileSync(path, 'utf8'));
    } catch {
        return null;
    }
}
function watchForStall(
    child: ChildProcess,
    evidence: Record<string, unknown>,
    before: Record<string, unknown>,
    identity: string | null,
    started: bigint,
    save: () => void,
    partialPath: string
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
        let observer: ReturnType<typeof spawn>;
        try {
            observer = spawn(
                process.execPath,
                [
                    script,
                    '--sample',
                    String(child.pid),
                    identity ?? '',
                    JSON.stringify(typeof before.trace2 === 'string' ? before.trace2 : ''),
                    partialPath,
                ],
                { stdio: ['ignore', 'pipe', 'ignore'], detached: true }
            );
        } catch {
            evidence.stall = { sample: unavailable, reason: 'observer spawn failed' };
            save();
            return;
        }
        if (!observer.stdout) {
            evidence.stall = { sample: unavailable, reason: 'observer output unavailable' };
            save();
            return;
        }
        const observerOutput = observer.stdout;
        let output = '';
        const stopObserver = () => {
            if (observer.pid && observer.exitCode === null && observer.signalCode === null) {
                try {
                    process.kill(-observer.pid, 'SIGKILL');
                } catch {
                    /* already exited */
                }
            }
            observerOutput.destroy();
            observer.unref();
        };
        observerOutput.on('data', (chunk: Buffer) => {
            output += chunk.toString();
            if (output.length > 256 * 1024) {
                stopObserver();
            }
        });
        const timeout = setTimeout(stopObserver, 9000);
        observer.on('error', () => clearTimeout(timeout));
        observer.on('close', () => {
            clearTimeout(timeout);
            const stall = isRecord(evidence.stall) ? evidence.stall : {};
            const observation = parseRecord(output) ?? readObservation(partialPath);
            if (observation) {
                if (observation.sample === 'observation pending') {
                    observation.sample = unavailable;
                    observation.incomplete = 'observer stopped before completion';
                }
                evidence.stall = { ...stall, ...observation };
            } else {
                evidence.stall = { ...stall, sample: unavailable };
            }
            save();
        });
    }, 5000);
}
function captureStderr(
    stream: Readable,
    stderrPath: string,
    evidence: Record<string, unknown>,
    diagnostic: (action: () => void) => void,
    save: () => void
) {
    const stderr: Buffer[] = [];
    let stderrSize = 0;
    let omitted = 0;
    stream.on('data', (chunk: Buffer) => {
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
    return () => ({ path: stderrPath, base64: Buffer.concat(stderr).toString('base64'), omittedBytes: omitted });
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
    const { paths, discover, includeIgnored, trackedOnly, conservative, includeUntracked } = checkpointDiscovery(args);
    const started = process.hrtime.bigint();
    const startedAtUtc = new Date().toISOString();
    const before: Record<string, unknown> = await inspect(
        paths,
        directory,
        'before',
        discover,
        includeIgnored,
        trackedOnly,
        conservative,
        includeUntracked
    ).catch(() => ({ error: 'observer unavailable' }));
    const evidence: Record<string, unknown> = {
        version: 1,
        operation: args[0],
        attempts: 1,
        startedAtMonotonicNs: started.toString(),
        startedAtUtc,
        cwd: process.cwd(),
        runtime: { node: process.version, platform: process.platform, arch: process.arch },
        arguments: checkpointArguments(args),
        before,
        syscallPath: 'unavailable without prearranged authorized syscall tracing',
        receiver: 'unavailable; shared receiver is not sampled',
        sampleIdentityLimit:
            'best-effort ps identity; second-resolution start and non-atomic recheck can race PID reuse',
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
    evidence.writerStartedAtUtc = new Date().toISOString();
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
    const capturedStderr = captureStderr(child.stderr, stderrPath, evidence, diagnostic, save);
    const timer = watchForStall(
        child,
        evidence,
        before,
        identity,
        started,
        save,
        join(directory, 'stall-partial.json')
    );
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: string }>(
        (resolve) => {
            child.on('error', (error) => resolve({ code: null, signal: null, error: error.message }));
            child.on('close', (code, signal) => resolve({ code, signal }));
        }
    );
    clearTimeout(timer);
    evidence.writerExitedAtMonotonicNs = process.hrtime.bigint().toString();
    evidence.writerExitedAtUtc = new Date().toISOString();
    evidence.exit = exit;
    evidence.elapsedNs = (process.hrtime.bigint() - started).toString();
    evidence.stderr = capturedStderr();
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
    const trace = parseJsonString(process.argv[5]);
    if (!Number.isSafeInteger(pid) || pid <= 0 || trace === null || process.argv[4] === undefined) {
        console.error('invalid sample arguments');
        process.exitCode = 2;
    } else {
        console.log(JSON.stringify(runCheckpointSample(pid, initial, trace, process.argv[6])));
    }
} else if (process.argv[2] === '--observe') {
    const partialPath = process.argv[3];
    let input = '';
    for await (const received of process.stdin) {
        const chunk: unknown = received;
        if (!Buffer.isBuffer(chunk) && typeof chunk !== 'string') {
            break;
        }
        input += chunk.toString();
        if (Buffer.byteLength(input) > 4 * 1024 * 1024) {
            break;
        }
    }
    const request = Buffer.byteLength(input) <= 4 * 1024 * 1024 ? parseRecord(input) : null;
    const paths = request && Array.isArray(request.paths) ? parseStrings(JSON.stringify(request.paths)) : null;
    if (
        paths &&
        partialPath &&
        typeof request?.discover === 'boolean' &&
        typeof request.includeIgnored === 'boolean' &&
        typeof request.trackedOnly === 'boolean' &&
        typeof request.conservative === 'boolean' &&
        typeof request.includeUntracked === 'boolean'
    ) {
        console.log(
            JSON.stringify(
                observe(
                    paths,
                    partialPath,
                    request.discover,
                    request.includeIgnored,
                    request.trackedOnly,
                    request.conservative,
                    request.includeUntracked
                )
            )
        );
    } else {
        console.error('invalid observer arguments');
        process.exitCode = 2;
    }
} else {
    await main(process.argv.slice(2));
}
