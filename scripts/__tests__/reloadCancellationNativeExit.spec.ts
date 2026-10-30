import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { joinNativeMapping } from '../diagnostics/reloadCancellation/nativeEvidence';
import { runAfterNativeQualification } from '../diagnostics/reloadCancellation/nativePreflight';
import { superviseNativeControl } from '../diagnostics/reloadCancellation/nativeSupervisor';
import {
    assertTraceControl,
    parseNativeLine,
    preserveNativeTermination,
    TRACE_SYSCALLS,
} from '../diagnostics/reloadCancellation/nativeTrace';
import {
    assertRendererIdentity,
    createRendererAssociations,
    rendererPid,
    type ProcessIdentity,
} from '../diagnostics/reloadCancellation/rendererIdentity';
import { admitExecutionParent } from '../diagnostics/reloadCancellation/trigger';

import type { BrowserTraceBinding } from '../diagnostics/reloadCancellation/traceBinding';

const capture = { complete: true, partialLine: false, droppedEvents: 0 };
const identity: ProcessIdentity = {
    pid: 320,
    parent: 300,
    start: '92815',
    namespace: 'pid:[4026531836]',
    observerNamespace: 'pid:[4026531836]',
    owned: true,
};
const types = new Map([[320, 'renderer']]);
const script = { type: 'Script', requestId: '320.7', frameId: 'actual-frame', loaderId: 'actual-loader' };
const binding: BrowserTraceBinding = {
    traceName: 'browser-200',
    wrapper: { ...identity, pid: 200, parent: 100, start: '80000' },
    tracer: { ...identity, pid: 300, parent: 200, start: '80001' },
    browser: { ...identity, pid: 310, parent: 300, start: '80002' },
};

describe('reload diagnostic native evidence negative controls', () => {
    it('validates a thousand same-association Scripts once, including while its CDP query is pending', async () => {
        const records: Array<{ kind: string; data: unknown }> = [];
        let finish!: (value: unknown) => void;
        const processes = vi.fn(
            () =>
                new Promise<unknown>((resolve) => {
                    finish = resolve;
                })
        );
        let start = identity.start;
        const readIdentity = vi.fn((pid: number) => ({ ...identity, pid, start }));
        const bind = vi.fn(() => binding);
        const observer = createRendererAssociations(100, (kind, data) => records.push({ kind, data }), {
            identity: readIdentity,
            processes,
            binding: bind,
        });
        observer.frame({ id: script.frameId, loaderId: script.loaderId });
        for (let index = 0; index < 1000; index++) {
            observer.request({ ...script, requestId: `320.${index}` });
        }
        expect(processes).toHaveBeenCalledTimes(1);
        expect(readIdentity).toHaveBeenCalledTimes(1);
        finish({ processInfo: [{ id: 320, type: 'renderer' }] });
        expect(await observer.settle()).toBe(1);
        expect(readIdentity).toHaveBeenCalledTimes(2);
        expect(bind).toHaveBeenCalledTimes(1);
        expect(records.filter((record) => record.kind === 'page-renderer-identity')).toHaveLength(1);
        processes.mockImplementation(async () => ({ processInfo: [{ id: 320, type: 'renderer' }] }));
        start = '92816';
        observer.frame({ id: script.frameId, loaderId: 'next-loader' });
        for (let index = 0; index < 1000; index++) {
            observer.request({ ...script, loaderId: 'next-loader', requestId: `320.${index}` });
        }
        expect(await observer.settle()).toBe(2);
        expect(processes).toHaveBeenCalledTimes(2);
        expect(readIdentity).toHaveBeenCalledTimes(4);
        expect(records.filter((record) => record.kind === 'renderer-pid-reuse')).toHaveLength(1);
        processes.mockImplementation(async () => ({ processInfo: [{ id: 321, type: 'renderer' }] }));
        for (let index = 0; index < 1000; index++) {
            observer.request({ ...script, loaderId: 'next-loader', requestId: `321.${index}` });
        }
        expect(await observer.settle()).toBe(3);
        expect(processes).toHaveBeenCalledTimes(3);
        expect(readIdentity).toHaveBeenCalledTimes(6);
    });

    it('records a failed or missed association once without retrying on its script burst', async () => {
        const record = vi.fn();
        const processes = vi.fn(async () => {
            throw new Error('CDP unavailable');
        });
        const readIdentity = vi.fn(() => identity);
        const observer = createRendererAssociations(100, record, {
            identity: readIdentity,
            processes,
            binding: () => binding,
        });
        observer.frame({ id: script.frameId, loaderId: script.loaderId });
        for (let index = 0; index < 1000; index++) {
            observer.request({ ...script, requestId: `320.${index}` });
        }
        expect(await observer.settle()).toBe(0);
        expect(processes).toHaveBeenCalledTimes(1);
        expect(record).toHaveBeenCalledTimes(1);
        for (let index = 0; index < 1000; index++) {
            observer.request({ ...script, loaderId: 'missed-loader', requestId: `320.${index}` });
        }
        expect(await observer.settle()).toBe(0);
        expect(processes).toHaveBeenCalledTimes(1);
        expect(record).toHaveBeenCalledTimes(2);
    });

    it('never borrows a reused numeric PID terminal from another browser/tracer instance', () => {
        const observation = { time: '1970-01-01T00:01:40.000Z', data: { identity, traceBinding: binding, ...script } };
        const oldTrace = {
            name: binding.traceName,
            capture: { traceInstance: binding },
            events: [{ pid: 320, timestamp: 101, kind: 'memory-syscall-failure', detail: 'mmap = -1 ENOMEM' }],
        };
        const otherBinding: BrowserTraceBinding = {
            ...binding,
            traceName: 'browser-201',
            wrapper: { ...binding.wrapper, pid: 201 },
            tracer: { ...binding.tracer, pid: 301, parent: 201 },
            browser: { ...binding.browser, pid: 311, parent: 301 },
        };
        const laterTrace = {
            name: otherBinding.traceName,
            capture: { traceInstance: otherBinding },
            events: [{ pid: 320, timestamp: 102, kind: 'exit', code: 99, detail: 'later reused PID' }],
        };
        expect(joinNativeMapping(observation, [oldTrace, laterTrace])).toMatchObject({
            terminal: { unknown: expect.any(String) },
            failedMemorySyscalls: [],
        });
        const ownedExit = {
            pid: 320,
            timestamp: 103,
            kind: 'signal-exit',
            signal: 'SIGTRAP',
            detail: 'owned terminal',
        };
        expect(
            joinNativeMapping(observation, [{ ...oldTrace, events: [...oldTrace.events, ownedExit] }, laterTrace])
        ).toMatchObject({ terminal: { signal: 'SIGTRAP' }, failedMemorySyscalls: [{ pid: 320, timestamp: 101 }] });
        expect(
            joinNativeMapping({ ...observation, data: { ...observation.data, traceBinding: undefined } }, [laterTrace])
        ).toMatchObject({ terminal: { unknown: expect.any(String) } });
        const wrongStart = {
            ...oldTrace,
            capture: { traceInstance: { ...binding, tracer: { ...binding.tracer, start: 'different-start' } } },
        };
        expect(joinNativeMapping(observation, [wrongStart, laterTrace])).toMatchObject({
            terminal: { unknown: expect.any(String) },
        });
        const reusedInsideTrace = {
            pid: 300,
            timestamp: 102,
            kind: 'process-creation',
            childPid: 320,
            detail: 'clone returned reused PID',
        };
        expect(
            joinNativeMapping(observation, [
                { ...oldTrace, events: [...oldTrace.events, reusedInsideTrace, ownedExit] },
            ])
        ).toMatchObject({ terminal: { unknown: expect.any(String) }, failedMemorySyscalls: [] });
    });

    it('bounds an unresponsive synthetic child and never admits original execution', async () => {
        const output = mkdtempSync(resolve(tmpdir(), 'reload-native-supervisor-'));
        const execute = vi.fn(async () => 0);
        const ready = resolve(output, 'unresponsive-control-ready');
        try {
            await expect(
                runAfterNativeQualification(
                    () =>
                        superviseNativeControl(
                            process.cwd(),
                            [
                                'exec',
                                'node',
                                '-e',
                                'require("node:fs").writeFileSync(process.argv[1],"ready");setInterval(()=>{},1000)',
                                ready,
                            ],
                            output,
                            1500
                        ),
                    execute
                )
            ).rejects.toThrow('failed or exceeded its deadline');
            expect(execute).not.toHaveBeenCalled();
            expect(readFileSync(ready, 'utf8')).toBe('ready');
            const receipt = JSON.parse(
                readFileSync(resolve(output, 'native-preflight-supervisor/qualification.json'), 'utf8')
            ) as { observed: boolean; exit: { stopping: boolean } };
            expect(receipt.observed).toBe(false);
            expect(receipt.exit.stopping).toBe(true);
        } finally {
            rmSync(output, { recursive: true, force: true });
        }
    }, 20_000);

    it.each([0, 7])('refuses a control exiting %i without actual Linux qualification proof', async (code) => {
        const output = mkdtempSync(resolve(tmpdir(), 'reload-native-rejected-'));
        const execute = vi.fn(async () => 0);
        try {
            await expect(
                runAfterNativeQualification(
                    () =>
                        superviseNativeControl(
                            process.cwd(),
                            ['exec', 'node', '-e', `process.exit(${code})`],
                            output,
                            5000
                        ),
                    execute
                )
            ).rejects.toThrow('failed or exceeded its deadline');
            expect(execute).not.toHaveBeenCalled();
            expect(
                JSON.parse(
                    readFileSync(resolve(output, 'native-preflight-supervisor/qualification.json'), 'utf8')
                ) as unknown
            ).toMatchObject({ observed: false, childCode: code });
        } finally {
            rmSync(output, { recursive: true, force: true });
        }
    });

    it('preserves the actual wrapper termination signal after capture instead of translating it to exit1', () => {
        const signal = vi.fn();
        const code = vi.fn();
        const unknown = vi.fn();
        preserveNativeTermination({ code: null, signal: 'SIGTRAP' }, { signal, code, unknown });
        expect(signal).toHaveBeenCalledExactlyOnceWith('SIGTRAP');
        expect(code).not.toHaveBeenCalled();
        preserveNativeTermination({ code: 37, signal: null }, { signal, code, unknown });
        expect(code).toHaveBeenCalledExactlyOnceWith(37);
        preserveNativeTermination({ code: null, signal: null }, { signal, code, unknown });
        expect(unknown).toHaveBeenCalledTimes(1);
        expect(code).toHaveBeenLastCalledWith(1);
    });

    it.each([
        ['clone(child_stack=NULL, flags=CLONE_VM|CLONE_THREAD) = 321', 321],
        ['clone3({flags=CLONE_VM|CLONE_THREAD, exit_signal=0}, 88) = 322', 322],
        ['fork() = 323', 323],
        ['vfork() = 324', 324],
        ['clone(child_stack=NULL, flags=CLONE_VM|CLONE_THREAD <unfinished ...>', undefined],
        ['<... clone resumed>) = 325', 325],
        ['<... clone3 resumed>) = 326', 326],
        ['<... fork resumed>) = 327', 327],
        ['<... vfork resumed>) = 328', 328],
    ])('retains creation flags/result or unfinished/resumed part: %s', (detail, childPid) => {
        const event = parseNativeLine(`320 1793350000.123456 ${detail}`);
        expect(event).toMatchObject({ pid: 320, kind: 'process-creation', detail });
        expect(event?.childPid).toBe(childPid);
    });
    it('admits only the first successor of the published preparation head, including shallow commit metadata', () => {
        const prepared = 'a'.repeat(40);
        const enabled = 'b'.repeat(40);
        const commit = `tree ${'c'.repeat(40)}\nparent ${prepared}\nauthor fixture\ncommitter fixture\n\nenable native observation\n`;
        expect(() => admitExecutionParent({ before: prepared }, commit, prepared)).not.toThrow();
        expect(() => admitExecutionParent({ before: enabled }, commit, prepared)).toThrow(
            'event.before/actual first parent'
        );
        expect(() => admitExecutionParent({}, commit, prepared)).toThrow('event.before/actual first parent');
        expect(() =>
            admitExecutionParent(
                { before: prepared },
                commit.replace(`parent ${prepared}`, `parent ${enabled}`),
                prepared
            )
        ).toThrow('event.before/actual first parent');
        expect(() => admitExecutionParent({ before: prepared }, commit, undefined)).toThrow('frozen');
        // The freeze commit follows E, so it cannot launch a second observation.
        expect(() =>
            admitExecutionParent(
                { before: enabled },
                commit.replace(`parent ${prepared}`, `parent ${enabled}`),
                prepared
            )
        ).toThrow('event.before/actual first parent');
    });
    it('does not begin original execution while native qualification is pending or after it fails', async () => {
        let rejectQualification!: (error: Error) => void;
        const qualification = new Promise<string>((_resolve, reject) => {
            rejectQualification = reject;
        });
        const execute = vi.fn(async () => 0);
        const result = runAfterNativeQualification(() => qualification, execute);
        expect(execute).not.toHaveBeenCalled();
        const failed = expect(result).rejects.toThrow('native trace unavailable');
        rejectQualification(new Error('native trace unavailable'));
        await failed;
        expect(execute).not.toHaveBeenCalled();
        await expect(runAfterNativeQualification(async () => '', execute)).rejects.toThrow(
            'qualified native browser wrapper'
        );
        expect(execute).not.toHaveBeenCalled();
        await expect(runAfterNativeQualification(async () => '/qualified-wrapper', execute)).resolves.toBe(0);
        expect(execute).toHaveBeenCalledExactlyOnceWith('/qualified-wrapper');
    });
    it('requires the actual producer PID and parent wait code or signal', () => {
        const exited = parseNativeLine('320 1793350000.123456 +++ exited with 37 +++');
        const trapped = parseNativeLine('320 1793350001.123456 +++ killed by SIGTRAP (core dumped) +++');
        if (!exited || !trapped) {
            throw new Error('Native fixture did not parse');
        }
        expect(() => assertTraceControl([exited], { pid: 320, code: 37, signal: null }, capture)).not.toThrow();
        expect(() => assertTraceControl([trapped], { pid: 320, code: null, signal: 'SIGTRAP' }, capture)).not.toThrow();
        expect(() => assertTraceControl([exited], { pid: 321, code: 37, signal: null }, capture)).toThrow(
            'PID/status/signal'
        );
        expect(() => assertTraceControl([exited], { pid: 320, code: 0, signal: null }, capture)).toThrow(
            'PID/status/signal'
        );
        expect(() => assertTraceControl([trapped], { pid: 320, code: null, signal: 'SIGKILL' }, capture)).toThrow(
            'PID/status/signal'
        );
        expect(() => assertTraceControl([], { pid: 320, code: 37, signal: null }, capture)).toThrow(
            'PID/status/signal'
        );
    });

    it.each([{ complete: false }, { partialLine: true }, { droppedEvents: 1 }])(
        'refuses truncated or incomplete trace %j',
        (change) => {
            const event = parseNativeLine('320 1793350000.123456 +++ exited with 37 +++');
            if (!event) {
                throw new Error('Missing fixture');
            }
            expect(() =>
                assertTraceControl([event], { pid: 320, code: 37, signal: null }, { ...capture, ...change })
            ).toThrow('incomplete or truncated');
        }
    );

    it('keeps terminal signal distinct from failed memory syscall evidence', () => {
        expect(
            parseNativeLine(
                '320 1793350000.123456 mmap(NULL, 4096, PROT_READ, MAP_PRIVATE, -1, 0) = -1 ENOMEM (Cannot allocate memory)'
            )
        ).toMatchObject({ pid: 320, kind: 'memory-syscall-failure' });
        expect(
            parseNativeLine('320 1793350000.123456 <... mprotect resumed>) = -1 EACCES (Permission denied)')
        ).toMatchObject({ pid: 320, kind: 'memory-syscall-failure' });
        expect(
            parseNativeLine('320 1793350000.123456 mmap(NULL, 4096, PROT_READ, MAP_PRIVATE, -1, 0) = 0x1234')
        ).toBeUndefined();
        expect(parseNativeLine('320 1793350000.123456 +++ killed by SIGTRAP +++')).toMatchObject({
            kind: 'signal-exit',
            signal: 'SIGTRAP',
        });
        for (const excluded of ['execve', 'read', 'write', 'recvfrom', 'sendto']) {
            expect(TRACE_SYSCALLS.split(',')).not.toContain(excluded);
        }
    });

    it('admits only page Script prefix with a real frame/loader and a live owned renderer', () => {
        expect(rendererPid(script)).toBe(320);
        expect(() => rendererPid({ ...script, type: 'Document' })).toThrow('page Script');
        expect(() => rendererPid({ ...script, type: 'Worker' })).toThrow('page Script');
        expect(() => rendererPid({ ...script, loaderId: '' })).toThrow('frame/loader');
        expect(() => rendererPid({ ...script, requestId: 'opaque-document-id' })).toThrow('PID prefix');
        expect(() => assertRendererIdentity(320, types, identity, identity)).not.toThrow();
        expect(() => assertRendererIdentity(321, types, identity, identity)).toThrow('owned SystemInfo');
        expect(() => assertRendererIdentity(320, new Map([[320, 'browser']]), identity, identity)).toThrow(
            'owned SystemInfo'
        );
        expect(() => assertRendererIdentity(320, types, identity, { ...identity, owned: false })).toThrow(
            'owned SystemInfo'
        );
        expect(() => assertRendererIdentity(320, types, identity, { ...identity, namespace: 'pid:[other]' })).toThrow(
            'namespace'
        );
        expect(() => assertRendererIdentity(320, types, identity, { ...identity, start: '92816' })).toThrow('reused');
    });

    it('requires actual Linux control and browser mapping qualification before original execution', () => {
        const run = readFileSync('scripts/diagnostics/reloadCancellation/run.ts', 'utf8');
        expect(run.indexOf('await qualifyOriginalHistory')).toBeLessThan(
            run.indexOf('await runAfterNativeQualification')
        );
        expect(run.indexOf('() => qualifyNativeTracing')).toBeLessThan(run.indexOf("phase: 'execution'"));
        const preflight = readFileSync('scripts/diagnostics/reloadCancellation/nativePreflight.ts', 'utf8');
        expect(preflight).toContain("process.platform !== 'linux'");
        expect(preflight).toContain('assertTraceControl(readNativeEvents(trace), wait, capture)');
        expect(preflight).toMatch(/\(await settled\(\)\) < 1/);
        const trace = readFileSync('scripts/diagnostics/reloadCancellation/nativeTrace.ts', 'utf8');
        expect(trace).not.toContain("'-qq'");
        expect(trace).toContain('await drained');
    });
});
