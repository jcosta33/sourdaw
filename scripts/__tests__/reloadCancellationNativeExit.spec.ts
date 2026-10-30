import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { runAfterNativeQualification } from '../diagnostics/reloadCancellation/nativePreflight';
import { assertTraceControl, parseNativeLine, TRACE_SYSCALLS } from '../diagnostics/reloadCancellation/nativeTrace';
import { admitExecutionParent } from '../diagnostics/reloadCancellation/trigger';
import {
    assertRendererIdentity,
    rendererPid,
    type ProcessIdentity,
} from '../diagnostics/reloadCancellation/rendererIdentity';

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

describe('reload diagnostic native evidence negative controls', () => {
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
        if (!exited || !trapped) throw new Error('Native fixture did not parse');
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
            if (!event) throw new Error('Missing fixture');
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
