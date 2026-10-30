import { readFileSync, readlinkSync } from 'node:fs';
import { resolve } from 'node:path';

import { recordOf } from './journal.ts';
import { linuxIdentity, type ProcessIdentity } from './linuxProcessIdentity.ts';

export type TraceInstance = { wrapper: ProcessIdentity; tracer: ProcessIdentity };
export type BrowserTraceBinding = TraceInstance & { traceName: string; browser: ProcessIdentity };

function sameProcess(left: ProcessIdentity, right: ProcessIdentity): boolean {
    return left.pid === right.pid && left.start === right.start && left.namespace === right.namespace;
}

export function assertTraceBinding(binding: BrowserTraceBinding, instance: TraceInstance): void {
    if (
        !sameProcess(binding.wrapper, instance.wrapper) ||
        !sameProcess(binding.tracer, instance.tracer) ||
        binding.browser.parent !== binding.tracer.pid ||
        binding.tracer.parent !== binding.wrapper.pid ||
        binding.traceName !== `browser-${binding.wrapper.pid}`
    ) {
        throw new Error('Browser mapping does not belong to this tracer/wrapper instance');
    }
    for (const identity of [binding.browser, binding.tracer, binding.wrapper]) {
        if (
            !identity.owned ||
            identity.namespace !== identity.observerNamespace ||
            identity.namespace !== binding.browser.namespace
        ) {
            throw new Error('Browser trace namespace or ownership differs');
        }
    }
}

export function browserTraceBinding(processes: unknown, owner: number, traceRoot: string): BrowserTraceBinding {
    const entries = recordOf(processes, 'process info').processInfo;
    if (!Array.isArray(entries)) {
        throw new Error('Browser process info missing');
    }
    const browsers = entries
        .map((entry: unknown) => recordOf(entry, 'process'))
        .filter((entry) => entry.type === 'browser');
    if (browsers.length !== 1 || typeof browsers[0]?.id !== 'number') {
        throw new Error('Actual browser PID ambiguous');
    }
    const browser = linuxIdentity(browsers[0].id, owner);
    const tracer = linuxIdentity(browser.parent, owner);
    const wrapper = linuxIdentity(tracer.parent, owner);
    if (readlinkSync(`/proc/${tracer.pid}/exe`) !== '/usr/bin/strace') {
        throw new Error('Actual browser parent is not the pinned strace binary');
    }
    const binding = { browser, tracer, wrapper, traceName: `browser-${wrapper.pid}` };
    const capture = recordOf(
        JSON.parse(readFileSync(resolve(traceRoot, binding.traceName, 'capture.json'), 'utf8')) as unknown,
        'active trace capture'
    );
    const instance = capture.traceInstance as TraceInstance;
    if (!instance) {
        throw new Error('Trace instance identity was not captured');
    }
    assertTraceBinding(binding, instance);
    for (const identity of [browser, tracer, wrapper]) {
        if (!sameProcess(identity, linuxIdentity(identity.pid, owner))) {
            throw new Error('Native identity changed during trace binding');
        }
    }
    return binding;
}
