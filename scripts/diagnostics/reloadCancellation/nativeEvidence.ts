import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { recordOf } from './journal.ts';
import { readNativeEvents, type NativeEvent } from './nativeTrace.ts';
import { assertTraceBinding, type BrowserTraceBinding, type TraceInstance } from './traceBinding.ts';

type NativeCapture = { name: string; capture: Record<string, unknown>; events: NativeEvent[] };

function observationInterval(data: Record<string, unknown>, journalTime: number): { start: number; end: number } {
    const interval = recordOf(data.observationInterval, 'validated observation interval');
    const { startedAtMs, completedAtMs } = interval;
    if (
        !Number.isFinite(journalTime) ||
        typeof startedAtMs !== 'number' ||
        typeof completedAtMs !== 'number' ||
        !Number.isSafeInteger(startedAtMs) ||
        !Number.isSafeInteger(completedAtMs) ||
        startedAtMs < 0 ||
        completedAtMs < startedAtMs ||
        startedAtMs > journalTime ||
        completedAtMs > journalTime + 1
    ) {
        throw new TypeError('Validated observation interval is missing or inconsistent with its journal time');
    }
    return { start: startedAtMs / 1000, end: completedAtMs / 1000 };
}

export function joinNativeMapping(
    event: Record<string, unknown>,
    traces: readonly NativeCapture[]
): Record<string, unknown> {
    const data = recordOf(event.data, 'mapping');
    const identity = recordOf(data.identity, 'identity');
    let since: number | undefined;
    let candidates: NativeEvent[];
    let traceName: string | undefined;
    let unknown: string | undefined;
    try {
        const interval = observationInterval(data, Date.parse(String(event.time)));
        since = interval.end;
        const binding = data.traceBinding as BrowserTraceBinding | undefined;
        if (!binding) {
            throw new Error('Actual browser/tracer instance binding was not observed');
        }
        const matches = traces.filter((trace) => trace.name === binding.traceName);
        if (matches.length !== 1) {
            throw new Error('Bound native trace is missing or ambiguous');
        }
        const trace = matches[0]!;
        assertTraceBinding(binding, trace.capture.traceInstance as TraceInstance);
        if (identity.namespace !== binding.browser.namespace) {
            throw new Error('Renderer namespace differs from bound browser');
        }
        traceName = trace.name;
        candidates = trace.events
            .filter((native) => native.pid === identity.pid && native.timestamp >= interval.end)
            .sort((left, right) => left.timestamp - right.timestamp);
        const terminal = candidates.find((native) => native.kind === 'exit' || native.kind === 'signal-exit');
        // Include the reads/binding window, before the later journal write.
        // A terminal in that window or a reused PID cannot prove this lifetime.
        if (
            trace.events.some(
                (native) =>
                    native.timestamp >= interval.start &&
                    ((native.childPid === identity.pid && (!terminal || native.timestamp <= terminal.timestamp)) ||
                        (native.pid === identity.pid &&
                            native.timestamp < interval.end &&
                            (native.kind === 'exit' || native.kind === 'signal-exit')))
            )
        ) {
            throw new Error('PID creation or terminal during/after observation makes this native lifetime ambiguous');
        }
    } catch (error) {
        unknown = String(error);
        candidates = [];
    }
    const terminal = candidates.find((native) => native.kind === 'exit' || native.kind === 'signal-exit');
    return {
        identity,
        traceName,
        requestId: data.requestId,
        frameId: data.frameId,
        loaderId: data.loaderId,
        observationInterval: data.observationInterval,
        since,
        birth: 'unknown before live registration',
        terminal: terminal ?? {
            unknown: unknown ?? 'No terminal observed in this exact browser/tracer instance after live registration',
        },
        failedMemorySyscalls: candidates.filter(
            (native) => native.kind === 'memory-syscall-failure' && terminal && native.timestamp <= terminal.timestamp
        ),
        limits: [
            'Only this bound browser/tracer instance is searched. Registration time does not establish process birth.',
            'Creation records permit offline TID/TGID analysis; unmatched TIDs and missing native lifetime evidence remain unknown.',
            'No observed failed mmap/mprotect is not proof of memory availability or absence of OOM.',
        ],
    };
}

export function qualifyNativeEvidence(output: string): Record<string, unknown> {
    const preflight = recordOf(
        JSON.parse(readFileSync(resolve(output, 'native-preflight/qualified.json'), 'utf8')) as unknown,
        'native preflight'
    );
    if (preflight.actualLinuxControls !== true || preflight.pinnedBrowserScriptMapping !== true) {
        throw new Error('Actual Linux native trace preflight did not qualify');
    }
    const root = resolve(output, 'run');
    const mappingHealth = recordOf(
        JSON.parse(readFileSync(resolve(root, 'renderer-mapping-health.json'), 'utf8')) as unknown,
        'mapping health'
    );
    if (mappingHealth.observed !== true) {
        throw new Error('Target renderer native mapping was not observed');
    }
    const traces = readdirSync(resolve(root, 'native-traces')).map((name) => {
        const directory = resolve(root, 'native-traces', name);
        const capture = recordOf(
            JSON.parse(readFileSync(resolve(directory, 'capture.json'), 'utf8')) as unknown,
            'native capture'
        );
        if (capture.complete !== true || capture.partialLine !== false || capture.droppedEvents !== 0) {
            throw new Error(`Native trace incomplete: ${name}`);
        }
        return { name, capture, events: readNativeEvents(directory) };
    });
    const observations = readFileSync(resolve(root, 'browser-observations.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => recordOf(JSON.parse(line) as unknown, 'observation'));
    const firstRegistrations = new Map<string, Record<string, unknown>>();
    for (const event of observations) {
        if (!['page-renderer-identity', 'browser-native-identity'].includes(String(event.kind))) {
            continue;
        }
        const identity = recordOf(recordOf(event.data, 'mapping').identity, 'identity');
        const data = recordOf(event.data, 'mapping');
        const binding = data.traceBinding as BrowserTraceBinding | undefined;
        const key = `${String(identity.pid)}:${String(identity.start)}:${String(identity.namespace)}:${binding?.traceName ?? 'unbound'}:${binding?.tracer.start ?? 'unknown'}`;
        if (!firstRegistrations.has(key)) {
            firstRegistrations.set(key, event);
        }
    }
    const mappings = Array.from(firstRegistrations.values(), (event) => joinNativeMapping(event, traces));
    return {
        preflight,
        captures: traces.map(({ name, capture }) => ({ name, capture })),
        mappings,
        advisoryOnly: true,
    };
}
