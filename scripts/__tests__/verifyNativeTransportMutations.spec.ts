import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    assertNativeSourceBinding,
    assertNativeTestResult,
    assertNativeWarmGraph,
    mutateTransportSource,
    NativeCommandOwnershipError,
    runCommand,
    verifyTransportMutations,
} from '../verifyNativeTransportMutations';

import type { NativeTestResult } from '../verifyNativeTransportMutations';

const source = readFileSync(
    join(import.meta.dirname, '../../crates/sourdaw-native/src/commands/engine_transport.rs'),
    'utf8'
);
const roots: string[] = [];
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

function passing(spec: string): NativeTestResult {
    return {
        code: 0,
        signal: null,
        output: `running 1 test\ntest commands::engine_transport::tests::${spec} ... ok\ntest result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 900 filtered out\n`,
    };
}

function failing(spec: string, panic: string): NativeTestResult {
    return {
        code: 101,
        signal: null,
        output: `running 1 test\ntest commands::engine_transport::tests::${spec} ... FAILED\n---- commands::engine_transport::tests::${spec} stdout ----\nthread '${spec}' panicked at crates/sourdaw-native/src/commands/engine_transport.rs:1:1:\n${panic}\ntest result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 900 filtered out\n`,
    };
}

function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-native-probe-control-'));
    roots.push(root);
    const sourcePath = join(root, 'source.rs');
    const evidencePath = join(root, 'evidence');
    writeFileSync(sourcePath, source);
    return { sourcePath, evidencePath };
}

describe('native transport source mutations', () => {
    it('changes the production equal-frame arm and preserves all owning test bytes', () => {
        const mutated = mutateTransportSource(source, 'adjacent-keep-first');
        expect(mutated).not.toBe(source);
        expect(mutated).not.toContain('=> *previous = segment,');
        expect(mutated.split('#[cfg(test)]')[1]).toBe(source.split('#[cfg(test)]')[1]);
    });

    it('disables both raw-value guards before collapse', () => {
        const mutated = mutateTransportSource(source, 'malformed-hidden-by-collapse');
        expect(mutated).not.toContain('if beats_per_minute <= 0.0 {');
        expect(mutated).not.toContain('if segment.numerator == 0 || segment.denominator == 0 {');
        expect(mutated.match(/if false \{/gu)).toHaveLength(2);
    });

    it('searches earlier kept frames without changing tests or engine constructors', () => {
        const mutated = mutateTransportSource(source, 'nonadjacent-frame-fold');
        expect(mutated).toContain('kept.iter_mut().find(');
        expect(mutated).toContain('TempoMap::new(&tempo_segments');
        expect(mutated.split('#[cfg(test)]')[1]).toBe(source.split('#[cfg(test)]')[1]);
    });

    it('refuses absent or ambiguous source anchors and unknown mutations', () => {
        expect(() => mutateTransportSource('', 'adjacent-keep-first')).toThrow();
        expect(() =>
            mutateTransportSource(source.replace('=> *previous = segment,', '=> {}'), 'adjacent-keep-first')
        ).toThrow();
        expect(() =>
            mutateTransportSource(
                source.replace('=> *previous = segment,', '=> *previous = segment, => *previous = segment,'),
                'adjacent-keep-first'
            )
        ).toThrow();
        expect(() => mutateTransportSource(source, 'arbitrary')).toThrow();
    });
});

describe('source and warm-graph admission', () => {
    const input = {
        head: 'a'.repeat(40),
        base: 'b'.repeat(40),
        integration: 'c'.repeat(40),
        checkout: 'c'.repeat(40),
        status: '',
    };
    it('binds immutable event commits to the clean integration checkout', () => {
        expect(assertNativeSourceBinding(input)).toEqual({ head: input.head, base: input.base });
    });
    it.each([
        { head: undefined },
        { base: undefined },
        { integration: undefined },
        { head: 'main' },
        { base: '--help' },
        { integration: 'HEAD' },
        { checkout: 'd'.repeat(40) },
        { status: ' M source.rs' },
    ])('refuses incomplete, redirected or dirty source %j', (change) => {
        expect(() => assertNativeSourceBinding({ ...input, ...change })).toThrow();
    });
    it('rejects a candidate whose graph differs from the warm owning graph', () => {
        expect(() => assertNativeWarmGraph('same', 'same')).not.toThrow();
        expect(() => assertNativeWarmGraph('candidate-graph', 'integration-graph')).toThrow('already-warm');
    });
});

describe('owning Rust assertion admission', () => {
    const spec = 'a_malformed_tempo_sharing_a_frame_is_still_refused';
    const panic = 'a tempo of 0 is refused';

    it('accepts exactly one original pass and the named expected assertion failure', () => {
        expect(() => assertNativeTestResult(passing(spec), spec)).not.toThrow();
        expect(() => assertNativeTestResult(failing(spec, panic), spec, panic)).not.toThrow();
    });

    it.each([
        ['still green', passing(spec)],
        ['successful exit with expected panic', { ...failing(spec, panic), code: 0 }],
        ['no case', { ...passing(spec), output: 'running 0 tests\ntest result: ok. 0 passed; 0 failed;' }],
        [
            'compiler error 101',
            {
                code: 101,
                signal: null,
                output: 'error[E0308]: mismatched types\nerror: could not compile sourdaw-native',
            },
        ],
        ['linker error 101', { code: 101, signal: null, output: 'error: linking with cc failed' }],
        ['network error', { code: 101, signal: null, output: 'error: failed to get serde as a dependency' }],
        ['wrong case', failing('some_other_test', panic)],
        ['different panic', failing(spec, 'unrelated panic')],
        ['timeout', { ...failing(spec, panic), failure: 'timeout' }],
        ['truncated output', { ...failing(spec, panic), failure: 'output-limit' }],
        ['killed', { ...failing(spec, panic), signal: 'SIGKILL' }],
        ['unexecuted', { ...failing(spec, panic), code: null }],
    ] satisfies Array<[string, NativeTestResult]>)('refuses %s as mutation evidence', (_label, result) => {
        expect(() => assertNativeTestResult(result, spec, panic)).toThrow();
    });

    it('does not admit a mutated failure as an original pass', () => {
        expect(() => assertNativeTestResult(failing(spec, panic), spec)).toThrow();
    });
});

function processIsAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
            return false;
        }
        throw error;
    }
}

async function waitForProcessExit(pid: number): Promise<void> {
    while (processIsAlive(pid)) {
        await wait(10);
    }
}

function fileReceipt(root: string, name: string) {
    const path = join(root, name);
    const observer = watch(root);
    const completed = new Promise<void>((resolve) => {
        const inspect = () => {
            if (existsSync(path)) {
                observer.close();
                resolve();
            }
        };
        observer.on('change', inspect);
        inspect();
    });
    return { completed, close: () => observer.close() };
}

describe('owned command process-group completion', () => {
    it.each(['interrupted', 'timeout', 'output-limit'])(
        'waits past direct-child close for a TERM-resistant descendant after %s',
        async (reason) => {
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-native-command-'));
            roots.push(root);
            const ready = fileReceipt(root, 'ready');
            const term = fileReceipt(root, 'descendant-term');
            const unrelated = spawn(
                process.execPath,
                [
                    '-e',
                    "process.on('SIGTERM', () => process.exit(55)); process.send('ready'); setInterval(() => {}, 1000)",
                ],
                { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }
            );
            const unrelatedClosed = once(unrelated, 'close');
            let descendantPid: number | undefined;
            const owned: { child?: ChildProcess; closed?: Promise<unknown> } = {};
            const signals = vi.spyOn(process, 'kill');
            try {
                await once(unrelated, 'message');
                console.info(`native-command-fixture ${reason}: unrelated ready; runtime ${process.execPath}`);
                vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
                const descendant = `
                    const fs = require('node:fs');
                    fs.closeSync(1);
                    fs.closeSync(2);
                    process.on('SIGTERM', () => fs.writeFileSync(${JSON.stringify(join(root, 'descendant-term'))}, 'TERM resisted'));
                    process.send('ready', () => process.disconnect());
                    setInterval(() => {}, 1000);
                `;
                const parent = `
                    const fs = require('node:fs');
                    const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {
                        stdio: ['ignore', 'inherit', 'inherit', 'ipc']
                    });
                    process.on('SIGTERM', () => process.exit(0));
                    process.on('SIGUSR1', () => process.stdout.write(Buffer.alloc(17 * 1024 * 1024, 'x')));
                    child.once('message', () => {
                        fs.writeFileSync(${JSON.stringify(join(root, 'ready.tmp'))}, String(process.pid) + ',' + String(child.pid));
                        fs.renameSync(${JSON.stringify(join(root, 'ready.tmp'))}, ${JSON.stringify(join(root, 'ready'))});
                    });
                `;
                const completed = runCommand(process.execPath, ['-e', parent], root, process.env, {
                    spawn: (command, args, options) => {
                        const child = spawn(command, args, options);
                        owned.child = child;
                        owned.closed = once(child, 'close');
                        return child;
                    },
                    setTimeout,
                    clearTimeout,
                    process,
                });
                const directChild = owned.child;
                const directClosed = owned.closed;
                if (
                    directChild === undefined ||
                    directChild.pid === undefined ||
                    directClosed === undefined ||
                    unrelated.pid === undefined
                ) {
                    throw new Error('Owned fixture did not start');
                }
                let settled = false;
                void completed.then(() => {
                    settled = true;
                });
                await ready.completed;
                const [parentPid, recordedDescendantPid] = readFileSync(join(root, 'ready'), 'utf8')
                    .split(',')
                    .map(Number);
                if (
                    recordedDescendantPid === undefined ||
                    !Number.isSafeInteger(recordedDescendantPid) ||
                    recordedDescendantPid <= 1
                ) {
                    throw new Error('Missing owned descendant PID');
                }
                descendantPid = recordedDescendantPid;
                expect(directChild.pid).toBe(parentPid);
                console.info(
                    `native-command-fixture ${reason}: descendant ready ${descendantPid}; parent ${directChild.pid}`
                );
                expect(Number.isSafeInteger(descendantPid) && descendantPid > 1).toBe(true);
                if (reason === 'interrupted') {
                    process.emit('SIGINT');
                } else if (reason === 'timeout') {
                    vi.advanceTimersByTime(180_000);
                } else {
                    process.kill(directChild.pid, 'SIGUSR1');
                }
                await Promise.all([directClosed, term.completed]);
                console.info(`native-command-fixture ${reason}: parent closed; descendant TERM received`);
                expect(processIsAlive(directChild.pid)).toBe(false);
                expect(processIsAlive(descendantPid)).toBe(true);
                expect(settled).toBe(false);
                vi.advanceTimersByTime(5_000);
                await waitForProcessExit(descendantPid);
                vi.advanceTimersByTime(50);
                const result = await completed;
                expect(result.failure).toBe(reason);
                expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(16 * 1024 * 1024);
                expect(() => process.kill(-directChild.pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
                expect(processIsAlive(unrelated.pid)).toBe(true);
                expect(signals.mock.calls.filter(([pid, signal]) => pid < 0 && signal !== 0)).toEqual([
                    [-directChild.pid, 'SIGTERM'],
                    [-directChild.pid, 'SIGKILL'],
                ]);
                const calls = signals.mock.calls.length;
                vi.advanceTimersByTime(180_000);
                expect(signals.mock.calls).toHaveLength(calls);
            } finally {
                console.info(`native-command-fixture ${reason}: cleanup`);
                ready.close();
                term.close();
                vi.useRealTimers();
                if (descendantPid !== undefined && processIsAlive(descendantPid)) {
                    process.kill(descendantPid, 'SIGKILL');
                    await waitForProcessExit(descendantPid);
                }
                if (owned.child?.pid !== undefined && processIsAlive(owned.child.pid)) {
                    owned.child.kill('SIGKILL');
                    await owned.closed;
                }
                unrelated.kill('SIGKILL');
                await unrelatedClosed;
            }
        }
    );

    it('completes a normal exit without signaling an absent group', async () => {
        const signals = vi.spyOn(process, 'kill');
        const result = await runCommand(
            process.execPath,
            ['-e', "process.stdout.write('complete')"],
            tmpdir(),
            process.env
        );
        expect(result).toEqual({ code: 0, signal: null, output: 'complete' });
        expect(signals.mock.calls.filter(([, signal]) => signal !== 0)).toEqual([]);
    });

    it('refuses a start failure without signaling any process group', async () => {
        const signals = vi.spyOn(process, 'kill');
        const result = await runCommand(join(tmpdir(), 'absent-native-command'), [], tmpdir(), process.env);
        expect(result.failure).toBe('child-start-failed');
        expect(signals).not.toHaveBeenCalled();
    });

    it('recognizes an ESRCH code across error prototypes and retires the group without signaling it', async () => {
        const observed: { pid?: number } = {};
        const signal = vi.fn((_pid: number, _signal: number | NodeJS.Signals | undefined) => {
            throw { code: 'ESRCH' };
        });
        const result = await runCommand(
            process.execPath,
            ['-e', "process.stdout.write('complete')"],
            tmpdir(),
            process.env,
            {
                spawn: (command, args, options) => {
                    const child = spawn(command, args, options);
                    observed.pid = child.pid;
                    return child;
                },
                setTimeout,
                clearTimeout,
                process: {
                    kill: signal,
                    once: process.once.bind(process),
                    removeListener: process.removeListener.bind(process),
                },
            }
        );
        if (observed.pid === undefined) {
            throw new Error('Owned command did not start');
        }
        expect(result).toEqual({ code: 0, signal: null, output: 'complete' });
        expect(signal.mock.calls).toEqual([[-observed.pid, 0]]);
    });
});

describe('source restoration and completed observable', () => {
    it('retains the mutated source and refuses proof when bounded ownership confirmation is exhausted', async () => {
        const options = fixture();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        let groupPresent = true;
        const signal = vi.fn((_pid: number, requested: number | NodeJS.Signals | undefined) => {
            if (requested === 0 && !groupPresent) {
                throw Object.assign(new Error('absent group'), { code: 'ESRCH' });
            }
            return true;
        });
        let commandClosed: (() => void) | undefined;
        const closed = new Promise<void>((resolve) => {
            commandClosed = resolve;
        });
        let calls = 0;
        let settled = false;
        const completed = verifyTransportMutations({
            ...options,
            runCase: async (spec) => {
                calls += 1;
                if (calls <= 7) {
                    return passing(spec);
                }
                return runCommand(process.execPath, ['-e', 'process.exit(0)'], tmpdir(), process.env, {
                    spawn: (command, args, configuration) => {
                        const child = spawn(command, args, configuration);
                        child.once('close', () => commandClosed?.());
                        return child;
                    },
                    setTimeout,
                    clearTimeout,
                    process: {
                        kill: signal,
                        once: process.once.bind(process),
                        removeListener: process.removeListener.bind(process),
                    },
                });
            },
        }).then(
            () => {
                settled = true;
                return undefined;
            },
            (error: unknown) => {
                settled = true;
                return error;
            }
        );
        try {
            await closed;
            const mutated = readFileSync(options.sourcePath, 'utf8');
            expect(mutated).toBe(mutateTransportSource(source, 'adjacent-keep-first'));
            await vi.advanceTimersByTimeAsync(10_000);
            expect(settled).toBe(true);
            const error = await completed;
            expect(error).toBeInstanceOf(NativeCommandOwnershipError);
            expect(error).toMatchObject({ reason: 'child-descendants-survived' });
            expect(readFileSync(options.sourcePath, 'utf8')).toBe(mutated);
            expect(existsSync(join(options.evidencePath, 'adjacent-keep-first.source.sha256'))).toBe(true);
            const cases = readFileSync(join(options.evidencePath, 'cases.json'), 'utf8');
            expect(cases.match(/"phase": "baseline"/gu)).toHaveLength(7);
            expect(cases).not.toContain('restored');
            expect(calls).toBe(8);
            expect(vi.getTimerCount()).toBe(0);
            const observed = signal.mock.calls.length;
            vi.advanceTimersByTime(180_000);
            expect(signal.mock.calls).toHaveLength(observed);
        } finally {
            groupPresent = false;
            await vi.advanceTimersByTimeAsync(50);
            await completed;
        }
    });

    it('runs seven original cases, seven mutant failures and seven restored cases before completing', async () => {
        const options = fixture();
        let calls = 0;
        const proof = await verifyTransportMutations({
            ...options,
            runCase: async (spec) => {
                calls += 1;
                const current = readFileSync(options.sourcePath, 'utf8');
                if (current === source) {
                    return passing(spec);
                }
                if (current.includes('if false {')) {
                    return failing(spec, spec.includes('tempo') ? 'a tempo of 0 is refused' : 'a 0/4 meter is refused');
                }
                if (current.includes('kept.iter_mut().find(')) {
                    return failing(spec, 'a repeat is refused');
                }
                return failing(spec, spec.startsWith('every_') ? 'tempo at frame' : 'assertion `left == right` failed');
            },
        });
        expect(calls).toBe(21);
        expect(proof.cases.map((entry) => entry.phase)).toEqual([
            ...Array<string>(7).fill('baseline'),
            ...Array<string>(3).fill('adjacent-keep-first'),
            ...Array<string>(2).fill('malformed-hidden-by-collapse'),
            ...Array<string>(2).fill('nonadjacent-frame-fold'),
            ...Array<string>(7).fill('restored'),
        ]);
        expect(proof.sourceDigest).toBe(proof.restoredDigest);
        expect(readFileSync(options.sourcePath, 'utf8')).toBe(source);
        for (const entry of proof.cases) {
            expect(readFileSync(join(options.evidencePath, entry.log), 'utf8')).toContain(entry.spec);
        }
    });

    it.each(['green-mutant', 'timeout', 'child-reject', 'restored-failure', 'altered-source'])(
        'restores and refuses completion after %s',
        async (failure) => {
            const options = fixture();
            let calls = 0;
            await expect(
                verifyTransportMutations({
                    ...options,
                    runCase: async (spec) => {
                        calls += 1;
                        if (calls <= 7) {
                            return passing(spec);
                        }
                        if (failure === 'child-reject') {
                            throw new Error('child-start-failed');
                        }
                        if (failure === 'timeout') {
                            return { ...failing(spec, ''), failure: 'timeout' };
                        }
                        if (failure === 'green-mutant') {
                            return passing(spec);
                        }
                        if (calls <= 14) {
                            const current = readFileSync(options.sourcePath, 'utf8');
                            if (current.includes('if false {')) {
                                return failing(
                                    spec,
                                    spec.includes('tempo') ? 'a tempo of 0 is refused' : 'a 0/4 meter is refused'
                                );
                            }
                            if (current.includes('kept.iter_mut().find(')) {
                                return failing(spec, 'a repeat is refused');
                            }
                            return failing(
                                spec,
                                spec.startsWith('every_') ? 'tempo at frame' : 'assertion `left == right` failed'
                            );
                        }
                        if (failure === 'altered-source') {
                            writeFileSync(options.sourcePath, `${source}\n// unexpected test change\n`);
                            return passing(spec);
                        }
                        return failing(spec, 'original assertion failed');
                    },
                })
            ).rejects.toThrow();
            expect(readFileSync(options.sourcePath, 'utf8')).toBe(source);
        }
    );

    it('refuses missing owning cases before executing a child', async () => {
        const options = fixture();
        writeFileSync(
            options.sourcePath,
            source.replace('fn a_malformed_meter_sharing_a_frame_is_still_refused()', 'fn renamed_case()')
        );
        let called = false;
        await expect(
            verifyTransportMutations({
                ...options,
                runCase: async (spec) => {
                    called = true;
                    return passing(spec);
                },
            })
        ).rejects.toThrow('Missing owning case');
        expect(called).toBe(false);
    });
});
