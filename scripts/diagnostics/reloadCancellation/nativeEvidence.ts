import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { recordOf } from './journal.ts';
import { readNativeEvents } from './nativeTrace.ts';

export function qualifyNativeEvidence(output: string): Record<string, unknown> {
    const preflight = recordOf(
        JSON.parse(readFileSync(resolve(output, 'native-preflight/qualified.json'), 'utf8')) as unknown,
        'native preflight'
    );
    if (preflight.actualLinuxControls !== true || preflight.pinnedBrowserScriptMapping !== true)
        throw new Error('Actual Linux native trace preflight did not qualify');
    const root = resolve(output, 'run');
    const mappingHealth = recordOf(
        JSON.parse(readFileSync(resolve(root, 'renderer-mapping-health.json'), 'utf8')) as unknown,
        'mapping health'
    );
    if (mappingHealth.observed !== true) throw new Error('Target renderer native mapping was not observed');
    const traces = readdirSync(resolve(root, 'native-traces')).map((name) => {
        const directory = resolve(root, 'native-traces', name);
        const capture = recordOf(
            JSON.parse(readFileSync(resolve(directory, 'capture.json'), 'utf8')) as unknown,
            'native capture'
        );
        if (capture.complete !== true || capture.partialLine !== false || capture.droppedEvents !== 0)
            throw new Error(`Native trace incomplete: ${name}`);
        return { name, capture, events: readNativeEvents(directory) };
    });
    const observations = readFileSync(resolve(root, 'browser-observations.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => recordOf(JSON.parse(line) as unknown, 'observation'));
    const firstRegistrations = new Map<string, Record<string, unknown>>();
    for (const event of observations) {
        if (!['page-renderer-identity', 'browser-native-identity'].includes(String(event.kind))) continue;
        const identity = recordOf(recordOf(event.data, 'mapping').identity, 'identity');
        const key = `${String(identity.pid)}:${String(identity.start)}:${String(identity.namespace)}`;
        if (!firstRegistrations.has(key)) firstRegistrations.set(key, event);
    }
    const native = traces
        .flatMap((trace) => trace.events.map((event) => ({ trace: trace.name, ...event })))
        .sort((a, b) => a.timestamp - b.timestamp);
    const mappings = [...firstRegistrations.values()].map((event) => {
        const data = recordOf(event.data, 'mapping');
        const identity = recordOf(data.identity, 'identity');
        const since = Date.parse(String(event.time)) / 1000;
        const candidates = native.filter((event) => event.pid === identity.pid && event.timestamp >= since);
        const terminal = candidates.find((native) => native.kind === 'exit' || native.kind === 'signal-exit');
        return {
            identity,
            requestId: data.requestId,
            frameId: data.frameId,
            loaderId: data.loaderId,
            since,
            terminal: terminal ?? { unknown: 'No native terminal observed after this live process registration' },
            failedMemorySyscalls: candidates.filter(
                (native) =>
                    native.kind === 'memory-syscall-failure' &&
                    terminal &&
                    native.trace === terminal.trace &&
                    native.timestamp <= terminal.timestamp
            ),
            limits: [
                'Only memory failures after live registration and before its first terminal are attributed. Earlier failures, unmatched TIDs, births and missing exits remain unknown.',
                'No observed failed mmap/mprotect is not proof of memory availability or absence of OOM.',
            ],
        };
    });
    return {
        preflight,
        captures: traces.map(({ name, capture }) => ({ name, capture })),
        mappings,
        advisoryOnly: true,
    };
}
