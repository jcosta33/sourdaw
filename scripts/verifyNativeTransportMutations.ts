import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'crates/sourdaw-native/src/commands/engine_transport.rs';
const PREFIX = 'commands::engine_transport::tests::';
type TransportMutation = {
    name: string;
    replacements: ReadonlyArray<readonly [string, string]>;
    cases: ReadonlyArray<readonly [string, string]>;
};
const MUTATIONS: readonly TransportMutation[] = [
    {
        name: 'adjacent-keep-first',
        replacements: [['=> *previous = segment,', '=> {},']],
        cases: [
            ['tempo_segments_under_one_frame_apart_install_as_the_later_one', 'assertion `left == right` failed'],
            ['meter_segments_under_one_frame_apart_install_as_the_later_one', 'assertion `left == right` failed'],
            ['every_projected_map_installs_with_the_last_change_governing_each_frame', 'tempo at frame'],
        ],
    },
    {
        name: 'malformed-hidden-by-collapse',
        replacements: [
            ['if beats_per_minute <= 0.0 {', 'if false {'],
            ['if segment.numerator == 0 || segment.denominator == 0 {', 'if false {'],
        ],
        cases: [
            ['a_malformed_tempo_sharing_a_frame_is_still_refused', 'a tempo of 0 is refused'],
            ['a_malformed_meter_sharing_a_frame_is_still_refused', 'a 0/4 meter is refused'],
        ],
    },
    {
        name: 'nonadjacent-frame-fold',
        replacements: [
            ['kept.last_mut()', 'kept.iter_mut().find(|previous| start_frame(previous) == start_frame(&segment))'],
        ],
        cases: [
            ['a_tempo_frame_repeated_after_a_later_one_is_still_refused', 'a repeat is refused'],
            ['a_meter_frame_repeated_after_a_later_one_is_still_refused', 'a repeat is refused'],
        ],
    },
];

export type NativeTestResult = { code: number | null; signal: string | null; output: string; failure?: string };
type CaseRecord = { phase: string; spec: string; code: number | null; signal: string | null; log: string };

function digest(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

export function assertNativeSourceBinding(input: {
    head: string | undefined;
    base: string | undefined;
    integration: string | undefined;
    checkout: string;
    status: string;
}): { head: string; base: string } {
    if (
        input.head === undefined ||
        input.base === undefined ||
        input.integration === undefined ||
        !/^[a-f0-9]{40}$/u.test(input.head) ||
        !/^[a-f0-9]{40}$/u.test(input.base) ||
        !/^[a-f0-9]{40}$/u.test(input.integration) ||
        input.checkout !== input.integration ||
        input.status !== ''
    ) {
        throw new Error('Expected clean native integration checkout and immutable event SHAs');
    }
    return { head: input.head, base: input.base };
}

export function assertNativeWarmGraph(candidate: string, warm: string): void {
    if (candidate !== warm) {
        throw new Error('Candidate graph differs from the already-warm native integration graph');
    }
}

export function mutateTransportSource(source: string, mutation: string): string {
    const selected = MUTATIONS.find((entry) => entry.name === mutation);
    const boundary = source.indexOf('#[cfg(test)]');
    if (selected === undefined || boundary < 0) {
        throw new Error('Unknown mutation or missing owning test boundary');
    }
    let production = source.slice(0, boundary);
    for (const [from, to] of selected.replacements) {
        if (production.split(from).length !== 2) {
            throw new Error(`Mutation ${mutation}: source anchor must occur exactly once`);
        }
        production = production.replace(from, to);
    }
    return production + source.slice(boundary);
}

export function assertNativeTestResult(result: NativeTestResult, spec: string, panic?: string): void {
    const output = result.output.replaceAll('\r', '');
    if (result.failure !== undefined || result.signal !== null || !/^running 1 test$/mu.test(output)) {
        throw new Error(`Incomplete owning test execution: ${spec}`);
    }
    if (panic === undefined) {
        if (
            result.code !== 0 ||
            !output.includes(`test ${PREFIX}${spec} ... ok`) ||
            !/^test result: ok\. 1 passed; 0 failed;/mu.test(output)
        ) {
            throw new Error(`Original owning case did not pass: ${spec}`);
        }
        return;
    }
    if (
        result.code !== 101 ||
        !output.includes(`test ${PREFIX}${spec} ... FAILED`) ||
        !/^test result: FAILED\. 0 passed; 1 failed;/mu.test(output) ||
        !output.includes(`---- ${PREFIX}${spec} stdout ----`) ||
        !output.includes('panicked at ') ||
        !output.includes(panic) ||
        /^error(?:\[E\d+\])?: (?:could not compile|linking|failed to|cannot)/mu.test(output)
    ) {
        throw new Error(`Mutation did not produce its owning assertion failure: ${spec}`);
    }
}

/** This runner owns only the fixed transport contract; the host supplies isolated exact-head source. */
export async function verifyTransportMutations(options: {
    sourcePath: string;
    evidencePath: string;
    runCase: (spec: string) => Promise<NativeTestResult>;
}): Promise<{ sourceDigest: string; restoredDigest: string; cases: CaseRecord[] }> {
    const original = readFileSync(options.sourcePath, 'utf8');
    const cases: CaseRecord[] = [];
    const restoreSource = () => {
        writeFileSync(options.sourcePath, original);
        if (readFileSync(options.sourcePath, 'utf8') !== original) {
            throw new Error('Owning source restoration failed');
        }
    };
    const allCases = MUTATIONS.flatMap((entry) => entry.cases);
    mkdirSync(options.evidencePath, { recursive: true });
    for (const [spec] of allCases) {
        if (!original.includes(`fn ${spec}()`)) {
            throw new Error(`Missing owning case: ${spec}`);
        }
    }
    for (const mutation of MUTATIONS) {
        mutateTransportSource(original, mutation.name);
    }
    const run = async (phase: string, spec: string, panic?: string) => {
        const result = await options.runCase(spec);
        const log = `${phase}-${spec}.log`;
        writeFileSync(join(options.evidencePath, log), result.output);
        cases.push({ phase, spec: `${PREFIX}${spec}`, code: result.code, signal: result.signal, log });
        writeFileSync(join(options.evidencePath, 'cases.json'), `${JSON.stringify(cases, null, 2)}\n`);
        assertNativeTestResult(result, spec, panic);
    };
    try {
        for (const [spec] of allCases) {
            await run('baseline', spec);
        }
        for (const mutation of MUTATIONS) {
            const mutated = mutateTransportSource(original, mutation.name);
            writeFileSync(join(options.evidencePath, `${mutation.name}.source.sha256`), `${digest(mutated)}\n`);
            writeFileSync(options.sourcePath, mutated);
            try {
                for (const [spec, panic] of mutation.cases) {
                    await run(mutation.name, spec, panic);
                }
            } finally {
                restoreSource();
            }
            console.log(`native-transport-mutation ${mutation.name}: mutation-detected`);
        }
        for (const [spec] of allCases) {
            await run('restored', spec);
        }
        if (readFileSync(options.sourcePath, 'utf8') !== original) {
            throw new Error('Final owning source differs from the reviewed source');
        }
        return {
            sourceDigest: digest(original),
            restoredDigest: digest(readFileSync(options.sourcePath, 'utf8')),
            cases,
        };
    } finally {
        restoreSource();
    }
}

function childEnvironment(): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {};
    for (const name of [
        'PATH',
        'HOME',
        'TMPDIR',
        'SDKROOT',
        'DEVELOPER_DIR',
        'RUSTUP_HOME',
        'CARGO_HOME',
        'CARGO_INCREMENTAL',
    ]) {
        if (process.env[name] !== undefined) {
            environment[name] = process.env[name];
        }
    }
    return environment;
}

function runCommand(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<NativeTestResult> {
    return new Promise((resolve) => {
        const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        const buffers: Buffer[] = [];
        let size = 0;
        let failure: string | undefined;
        let killTimer: ReturnType<typeof setTimeout> | undefined;
        const stop = (reason: string) => {
            if (failure !== undefined) {
                return;
            }
            failure = reason;
            const kill = (signal: NodeJS.Signals) => {
                if (child.pid !== undefined) {
                    try {
                        process.kill(-child.pid, signal);
                    } catch (error) {
                        if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
                            failure = `${reason}: child termination failed`;
                        }
                    }
                }
            };
            kill('SIGTERM');
            killTimer = setTimeout(() => kill('SIGKILL'), 5_000);
        };
        const interrupt = () => stop('interrupted');
        process.once('SIGINT', interrupt);
        process.once('SIGTERM', interrupt);
        const timeout = setTimeout(() => stop('timeout'), 180_000);
        const collect = (buffer: Buffer) => {
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
            failure = 'child-start-failed';
        });
        child.on('close', (code, signal) => {
            clearTimeout(timeout);
            clearTimeout(killTimer);
            process.removeListener('SIGINT', interrupt);
            process.removeListener('SIGTERM', interrupt);
            const result: NativeTestResult = {
                code,
                signal,
                output: Buffer.concat(buffers).toString('utf8'),
            };
            if (failure !== undefined) {
                result.failure = failure;
            }
            resolve(result);
        });
    });
}

type GitCommand = (...args: string[]) => Promise<string>;

async function nativeGraphDigest(git: GitCommand, sha: string): Promise<string> {
    const files = (await git('ls-tree', '-r', '--name-only', sha))
        .split('\n')
        .filter(
            (path) =>
                path === 'Cargo.lock' ||
                path === '.cargo/config.toml' ||
                path === 'rust-toolchain.toml' ||
                path === 'Cargo.toml' ||
                path.endsWith('/Cargo.toml')
        );
    const blobs: string[] = [];
    for (const path of files) {
        blobs.push(`${path}:${await git('rev-parse', `${sha}:${path}`)}`);
    }
    return digest(blobs.join('\n'));
}

async function proveIsolatedTransport(context: {
    root: string;
    head: string;
    target: string;
    evidencePath: string;
    env: NodeJS.ProcessEnv;
    git: GitCommand;
    record: Record<string, unknown>;
}): ReturnType<typeof verifyTransportMutations> {
    const { root, head, target, evidencePath, env, git, record } = context;
    const candidate = join(root, '.agents/review-worktrees', `native-transport-${head}`);
    if (existsSync(candidate)) {
        throw new Error('Candidate worktree already exists');
    }
    await git('worktree', 'add', '--detach', candidate, head);
    await git('worktree', 'lock', '--reason', 'hosted native transport mutation probe', candidate);
    const sourcePath = join(candidate, SOURCE);
    record.sourceBlob = await git('rev-parse', `${head}:${SOURCE}`);
    const original = readFileSync(sourcePath, 'utf8');
    record.sourceDigest = digest(original);
    record.testDigest = digest(original.slice(original.indexOf('#[cfg(test)]')));
    const toolchain = await runCommand('rustc', ['-vV'], candidate, env);
    if (toolchain.code !== 0 || toolchain.failure !== undefined || toolchain.signal !== null) {
        throw new Error('Pinned native toolchain unavailable');
    }
    record.toolchain = toolchain.output.trim();
    for (const mutation of MUTATIONS) {
        try {
            writeFileSync(sourcePath, mutateTransportSource(original, mutation.name));
            writeFileSync(
                join(evidencePath, `${mutation.name}.patch`),
                await git('-C', candidate, 'diff', '--', SOURCE)
            );
        } finally {
            writeFileSync(sourcePath, original);
        }
    }
    const proof = await verifyTransportMutations({
        sourcePath,
        evidencePath,
        runCase: (spec) =>
            runCommand(
                'cargo',
                [
                    'test',
                    '--locked',
                    '--offline',
                    '--package',
                    'sourdaw-native',
                    '--lib',
                    `${PREFIX}${spec}`,
                    '--',
                    '--exact',
                    '--test-threads=1',
                ],
                candidate,
                { ...env, CARGO_TARGET_DIR: target, CARGO_NET_OFFLINE: 'true' }
            ),
    });
    if ((await git('-C', candidate, 'status', '--porcelain')) !== '') {
        throw new Error('Candidate tree differs after restoration');
    }
    return proof;
}

async function hostedProbe(): Promise<void> {
    const root = resolvePath(import.meta.dirname, '..');
    const evidencePath = join(root, '.agents/artifacts/native-transport-mutations');
    mkdirSync(evidencePath, { recursive: true });
    const record: Record<string, unknown> = {
        format: 'native-transport-mutations-v1',
        headSha: process.env.HEAD_SHA,
        integrationSha: process.env.GITHUB_SHA,
        runId: process.env.GITHUB_RUN_ID,
        runAttempt: process.env.GITHUB_RUN_ATTEMPT,
        result: 'incomplete',
        restored: false,
    };
    const save = () => writeFileSync(join(evidencePath, 'summary.json'), `${JSON.stringify(record, null, 2)}\n`);
    const output = (value: string) => {
        if (process.env.GITHUB_OUTPUT === undefined) {
            throw new Error('Missing GitHub output file');
        }
        appendFileSync(process.env.GITHUB_OUTPUT, `${value}\n`);
    };
    const env = childEnvironment();
    const git = async (...args: string[]) => {
        const result = await runCommand('git', args, root, env);
        if (result.code !== 0 || result.signal !== null || result.failure !== undefined) {
            throw new Error(`Git source admission failed: ${args[0]}`);
        }
        return result.output.trim();
    };
    save();
    try {
        if (
            process.env.GITHUB_ACTIONS !== 'true' ||
            process.platform !== 'darwin' ||
            process.env.GITHUB_JOB !== 'native-macos' ||
            process.env.GITHUB_WORKSPACE === undefined ||
            realpathSync(process.env.GITHUB_WORKSPACE) !== realpathSync(root)
        ) {
            throw new Error('Expected clean native-macos integration checkout and immutable event SHAs');
        }
        const { head, base } = assertNativeSourceBinding({
            head: process.env.HEAD_SHA,
            base: process.env.BASE_SHA,
            integration: process.env.GITHUB_SHA,
            checkout: await git('rev-parse', 'HEAD'),
            status: await git('status', '--porcelain'),
        });
        if (
            (await git('rev-parse', `${head}^{commit}`)) !== head ||
            (await git('rev-parse', `${base}^{commit}`)) !== base
        ) {
            throw new Error('Event commits were not fetched by the isolated checkout');
        }
        if ((await git('diff', '--name-only', base, head, '--', SOURCE)) === '') {
            record.result = 'not-scheduled';
            record.reason = 'owning source unchanged';
            record.restored = true;
            save();
            output('restored=true');
            console.log('native-transport-mutations: not-scheduled; owning source unchanged');
            return;
        }
        const graphDigest = await nativeGraphDigest(git, head);
        record.graphDigest = graphDigest;
        assertNativeWarmGraph(graphDigest, await nativeGraphDigest(git, 'HEAD'));
        const target = join(root, 'target');
        if (!existsSync(join(target, 'debug/deps')) || realpathSync(target) !== target) {
            throw new Error('Missing job-private already-warm native target');
        }
        record.target = target;
        const proof = await proveIsolatedTransport({ root, head, target, evidencePath, env, git, record });
        record.proof = proof;
        record.result = 'mutation-detected';
        record.restored = true;
        save();
        output('restored=true');
        console.log(`native-transport-mutations: mutation-detected; source-restored ${proof.restoredDigest}`);
    } catch (error) {
        record.error = error instanceof Error ? error.message : 'Native transport probe failed';
        save();
        throw error;
    }
}

if (process.argv[1] !== undefined && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
    hostedProbe().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : 'Native transport probe failed');
        process.exitCode = 1;
    });
}
