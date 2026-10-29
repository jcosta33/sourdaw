import { basename } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { recordOf, requiredText } from './journal.ts';

export type CaseIdentity = { project: string; file: string; title: string };
export type HistoricalCase = CaseIdentity & { workerIndex: number };
export type RuntimeCase = CaseIdentity & { workerIndex: number; retry: number; status?: string };
export type HistoryEvent = { kind: string; data: RuntimeCase };

export function caseIdentity(value: unknown): CaseIdentity {
    const entry = recordOf(value, 'case');
    return {
        project: requiredText(entry.project, 'project'),
        file: basename(requiredText(entry.file, 'file')),
        title: requiredText(entry.title, 'title'),
    };
}

export function historicalCases(value: unknown): HistoricalCase[] {
    if (!Array.isArray(value) || value.length !== 91) {
        throw new Error('Original history must contain exactly91 cases');
    }
    return value.map((item: unknown) => {
        const entry = recordOf(item, 'history case');
        if (entry.workerIndex !== 0 && entry.workerIndex !== 1) {
            throw new Error('Original history has an invalid worker');
        }
        return { ...caseIdentity(entry), workerIndex: entry.workerIndex };
    });
}

export function assertCollectedHistory(expected: readonly HistoricalCase[], actual: unknown): void {
    if (!Array.isArray(actual)) {
        throw new TypeError('Collected cases must be an array');
    }
    const names = actual.map((item: unknown) => caseIdentity(item));
    const original = expected.map(({ project, file, title }) => ({ project, file, title }));
    if (!isDeepStrictEqual(names, original)) {
        throw new Error('Collected names/project/order differ from original shard history');
    }
}

function runtimeCase(value: unknown): RuntimeCase {
    const entry = recordOf(value, 'runtime case');
    if (typeof entry.workerIndex !== 'number' || !Number.isInteger(entry.workerIndex) || entry.retry !== 0) {
        throw new TypeError('Runtime worker/retry evidence is invalid');
    }
    return {
        ...caseIdentity(entry),
        workerIndex: entry.workerIndex,
        retry: 0,
        status: typeof entry.status === 'string' ? entry.status : undefined,
    };
}

export function parseHistoryEvents(lines: string): HistoryEvent[] {
    return lines
        .split('\n')
        .filter(Boolean)
        .map((line) => {
            const value: unknown = JSON.parse(line);
            const event = recordOf(value, 'history event');
            const kind = requiredText(event.kind, 'kind');
            if (kind !== 'test-begin' && kind !== 'test-end') {
                throw new Error(`Unexpected runtime history event: ${kind}`);
            }
            return { kind, data: runtimeCase(event.data) };
        });
}

export function assertRuntimePrefix(expected: readonly HistoricalCase[], events: readonly HistoryEvent[]): void {
    const begun: RuntimeCase[] = [];
    const ended: RuntimeCase[] = [];
    for (const event of events) {
        if (event.kind === 'test-begin') {
            if (begun.length !== ended.length) {
                throw new Error('Runtime cases overlap or a predecessor did not finish');
            }
            begun.push(event.data);
        } else {
            const current = begun.at(-1);
            if (
                ended.length + 1 !== begun.length ||
                !isDeepStrictEqual(caseIdentity(current), caseIdentity(event.data)) ||
                current?.workerIndex !== event.data.workerIndex ||
                event.data.retry !== 0
            ) {
                throw new Error('Runtime completion is missing, duplicate or out of order');
            }
            ended.push(event.data);
        }
    }
    assertCollectedHistory(expected, begun);
    if (ended.length !== 90 || ended.some((entry) => entry.status !== 'passed')) {
        throw new Error('Original90 successful predecessors were not observed before the target');
    }
    if (begun.some((entry, index) => entry.workerIndex !== expected[index]?.workerIndex || entry.retry !== 0)) {
        throw new Error('Original worker transition or retry0 was not preserved');
    }
}

export function assertRuntimeOrder(expected: readonly HistoricalCase[], events: readonly HistoryEvent[]): void {
    const begins = events.filter((event) => event.kind === 'test-begin').map((event) => event.data);
    const ends = events.filter((event) => event.kind === 'test-end').map((event) => event.data);
    assertCollectedHistory(expected, begins);
    assertCollectedHistory(expected, ends);
    if (
        events.length !== expected.length * 2 ||
        events.some((event, index) => event.kind !== (index % 2 === 0 ? 'test-begin' : 'test-end'))
    ) {
        throw new Error('Completed runtime history is missing, overlapping or out of order');
    }
    if (
        [...begins, ...ends].some(
            (entry, index) => entry.workerIndex !== expected[index % expected.length]?.workerIndex || entry.retry !== 0
        )
    ) {
        throw new Error('Completed worker/retry history differs');
    }
    assertRuntimePrefix(expected, events.slice(0, -1));
    const target = events.at(-1);
    if (
        target?.kind !== 'test-end' ||
        !['passed', 'failed', 'timedOut', 'interrupted'].includes(target.data.status ?? '')
    ) {
        throw new Error('Original target did not produce a completed result');
    }
}

export function assertCompletedHistory(expected: readonly HistoricalCase[], events: readonly HistoryEvent[]): void {
    assertRuntimeOrder(expected, events);
    if (events.some((entry) => entry.kind === 'test-end' && entry.data.status !== 'passed')) {
        throw new Error('Diagnostic contains a failed, skipped or interrupted case');
    }
}

export function assertProjectSemantics(
    original: unknown,
    candidate: unknown,
    wrapper: string,
    maintained: string
): void {
    const normalize = (value: unknown): unknown => {
        if (value === wrapper) {
            return maintained;
        }
        if (Array.isArray(value)) {
            return value.map(normalize);
        }
        if (value !== null && typeof value === 'object') {
            return Object.fromEntries(
                Object.entries(value).map(([key, item]) => {
                    if (key === 'testIgnore' && Array.isArray(item)) {
                        return [key, item.filter((path: unknown) => path !== wrapper).map(normalize)];
                    }
                    return [key, normalize(item)];
                })
            );
        }
        return value;
    };
    if (!isDeepStrictEqual(normalize(original), normalize(candidate))) {
        throw new Error('Effective project semantics changed beyond the admitted wrapper route');
    }
}
