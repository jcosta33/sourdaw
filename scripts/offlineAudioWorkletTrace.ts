export const OFFLINE_TRACE_PHASES = {
    warmupCallbacks: 4_000,
    measuredCallbacks: 20_000,
    terminalCallbacks: 1,
} as const;

export const OFFLINE_TRACE_EVENT_NAMES = {
    outer: 'AudioWorkletProcessor::Process',
    handler: 'AudioHandler::ProcessIfNecessary',
    author: 'AudioWorkletProcessor::Process (author script execution)',
} as const;

type TraceEvent = {
    name: string;
    ts: number;
    dur: number;
    pid: number;
    tid: number;
    args: Record<string, unknown>;
};

export type OfflineTraceExpectation = {
    warmupCallbacks: number;
    measuredCallbacks: number;
};

export type TraceAdmission =
    | {
          status: 'admitted';
          outerCallbacks: number;
          pid: number;
          tid: number;
          handlerThis: string;
          warmupDurationsUs: number[];
          measuredDurationsUs: number[];
          terminalDurationUs: number;
          bareHandlers: number;
      }
    | { status: 'refused'; reason: string };

type TraceAdmissionInput = {
    events: readonly unknown[];
    dataLossOccurred: unknown;
    expectation?: OfflineTraceExpectation;
};

type ParsedEvents = {
    outer: TraceEvent[];
    handlers: TraceEvent[];
    authors: TraceEvent[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRelevantName(value: unknown): value is string {
    return Object.values(OFFLINE_TRACE_EVENT_NAMES).some((name) => value === name);
}

function parseRelevantEvent(value: Record<string, unknown>): TraceEvent | string {
    if (value.ph !== 'X') {
        return `relevant event ${String(value.name)} is not a complete X event`;
    }
    if (
        typeof value.ts !== 'number' ||
        !Number.isFinite(value.ts) ||
        value.ts < 0 ||
        typeof value.dur !== 'number' ||
        !Number.isFinite(value.dur) ||
        value.dur < 0
    ) {
        return `relevant event ${String(value.name)} has an invalid interval`;
    }
    if (
        typeof value.pid !== 'number' ||
        !Number.isSafeInteger(value.pid) ||
        value.pid < 0 ||
        typeof value.tid !== 'number' ||
        !Number.isSafeInteger(value.tid) ||
        value.tid < 0
    ) {
        return `relevant event ${String(value.name)} has an invalid process or thread id`;
    }
    if (!isRecord(value.args)) {
        return `relevant event ${String(value.name)} has invalid arguments`;
    }
    return {
        name: String(value.name),
        ts: value.ts,
        dur: value.dur,
        pid: value.pid,
        tid: value.tid,
        args: value.args,
    };
}

function parseRelevantEvents(events: readonly unknown[]): ParsedEvents | string {
    const parsed: ParsedEvents = { outer: [], handlers: [], authors: [] };
    for (const [index, value] of events.entries()) {
        if (!isRecord(value) || !isRelevantName(value.name)) {
            continue;
        }
        const event = parseRelevantEvent(value);
        if (typeof event === 'string') {
            return `trace event ${String(index)}: ${event}`;
        }
        if (event.name === OFFLINE_TRACE_EVENT_NAMES.outer) {
            parsed.outer.push(event);
        } else if (event.name === OFFLINE_TRACE_EVENT_NAMES.handler) {
            parsed.handlers.push(event);
        } else {
            parsed.authors.push(event);
        }
    }
    return parsed;
}

function byTimestamp(left: TraceEvent, right: TraceEvent): number {
    return left.ts - right.ts || left.dur - right.dur;
}

function intervalEnd(event: TraceEvent): number {
    return event.ts + event.dur;
}

function hasTimestampTie(events: readonly TraceEvent[]): boolean {
    return events.some((event, index) => index > 0 && event.ts === events[index - 1]?.ts);
}

function validateOuterEvents(outer: readonly TraceEvent[], expectedCallbacks: number): string | null {
    if (outer.length !== expectedCallbacks) {
        return `expected ${String(expectedCallbacks)} outer callbacks, received ${String(outer.length)}`;
    }
    if (hasTimestampTie(outer)) {
        return 'outer callbacks have an ambiguous timestamp tie';
    }
    const first = outer[0];
    if (!first) {
        return 'outer callback population is empty';
    }
    for (const [index, event] of outer.entries()) {
        if (event.pid !== first.pid || event.tid !== first.tid) {
            return 'outer callbacks do not share one process and thread';
        }
        const previous = outer[index - 1];
        if (previous && event.ts < intervalEnd(previous)) {
            return 'outer callbacks overlap';
        }
    }
    return null;
}

function isWorkletHandler(event: TraceEvent): boolean {
    return event.args['node type'] === 'AudioWorkletNode';
}

function validateHandlerIntervals(handlers: readonly TraceEvent[], pid: number, tid: number): string | null {
    if (hasTimestampTie(handlers)) {
        return 'AudioWorkletNode handlers have an ambiguous timestamp tie';
    }
    for (const [index, handler] of handlers.entries()) {
        if (handler.pid !== pid || handler.tid !== tid) {
            return 'AudioWorkletNode handlers do not share the outer callback thread';
        }
        if (typeof handler.args.this !== 'string' || handler.args.this.length === 0) {
            return 'AudioWorkletNode handler has no trace pointer';
        }
        const previous = handlers[index - 1];
        if (previous && handler.ts < intervalEnd(previous)) {
            return 'AudioWorkletNode handler intervals overlap ambiguously';
        }
    }
    return null;
}

type HandlerBinding = { handlerThis: string; bareHandlers: number };

function bindHandlers(outer: readonly TraceEvent[], allHandlers: readonly TraceEvent[]): HandlerBinding | string {
    const firstOuter = outer[0];
    if (!firstOuter) {
        return 'outer callback population is empty';
    }
    const handlers = allHandlers.filter(isWorkletHandler).toSorted(byTimestamp);
    const intervalFailure = validateHandlerIntervals(handlers, firstOuter.pid, firstOuter.tid);
    if (intervalFailure) {
        return intervalFailure;
    }

    let handlerIndex = 0;
    let bareHandlers = 0;
    let handlerThis = '';
    for (const callback of outer) {
        while (handlerIndex < handlers.length && intervalEnd(handlers[handlerIndex]!) <= callback.ts) {
            bareHandlers++;
            handlerIndex++;
        }
        const handler = handlers[handlerIndex];
        if (!handler || handler.ts >= callback.ts || intervalEnd(handler) <= intervalEnd(callback)) {
            return 'outer callback lacks one unambiguous enclosing AudioWorkletNode handler';
        }
        const pointer = handler.args.this;
        if (typeof pointer !== 'string') {
            return 'AudioWorkletNode handler has no trace pointer';
        }
        if (handlerThis !== '' && pointer !== handlerThis) {
            return 'outer callbacks do not share one AudioWorkletNode trace pointer';
        }
        handlerThis = pointer;
        handlerIndex++;
    }
    bareHandlers += handlers.length - handlerIndex;
    return { handlerThis, bareHandlers };
}

function bindAuthors(outer: readonly TraceEvent[], allAuthors: readonly TraceEvent[]): string | null {
    const authors = allAuthors.toSorted(byTimestamp);
    if (authors.length !== outer.length) {
        return `expected ${String(outer.length)} author executions, received ${String(authors.length)}`;
    }
    if (hasTimestampTie(authors)) {
        return 'author executions have an ambiguous timestamp tie';
    }
    for (const [index, callback] of outer.entries()) {
        const author = authors[index];
        if (
            !author ||
            author.pid !== callback.pid ||
            author.tid !== callback.tid ||
            author.ts <= callback.ts ||
            intervalEnd(author) > intervalEnd(callback)
        ) {
            return 'outer callback lacks one unambiguous contained author execution';
        }
    }
    return null;
}

function validExpectation(expectation: OfflineTraceExpectation): boolean {
    return (
        Number.isSafeInteger(expectation.warmupCallbacks) &&
        expectation.warmupCallbacks >= 0 &&
        Number.isSafeInteger(expectation.measuredCallbacks) &&
        expectation.measuredCallbacks > 0
    );
}

export function admitOfflineAudioWorkletTrace({
    events,
    dataLossOccurred,
    expectation = OFFLINE_TRACE_PHASES,
}: TraceAdmissionInput): TraceAdmission {
    if (dataLossOccurred !== false) {
        return { status: 'refused', reason: 'trace did not explicitly report dataLossOccurred false' };
    }
    if (!validExpectation(expectation)) {
        return { status: 'refused', reason: 'trace phase expectation is invalid' };
    }
    const parsed = parseRelevantEvents(events);
    if (typeof parsed === 'string') {
        return { status: 'refused', reason: parsed };
    }
    const outer = parsed.outer.toSorted(byTimestamp);
    const expectedCallbacks = expectation.warmupCallbacks + expectation.measuredCallbacks + 1;
    const outerFailure = validateOuterEvents(outer, expectedCallbacks);
    if (outerFailure) {
        return { status: 'refused', reason: outerFailure };
    }
    const first = outer[0]!;
    const handlerBinding = bindHandlers(outer, parsed.handlers);
    if (typeof handlerBinding === 'string') {
        return { status: 'refused', reason: handlerBinding };
    }
    const authorFailure = bindAuthors(outer, parsed.authors);
    if (authorFailure) {
        return { status: 'refused', reason: authorFailure };
    }

    const measuredStart = expectation.warmupCallbacks;
    const terminalIndex = measuredStart + expectation.measuredCallbacks;
    return {
        status: 'admitted',
        outerCallbacks: outer.length,
        pid: first.pid,
        tid: first.tid,
        handlerThis: handlerBinding.handlerThis,
        warmupDurationsUs: outer.slice(0, measuredStart).map((event) => event.dur),
        measuredDurationsUs: outer.slice(measuredStart, terminalIndex).map((event) => event.dur),
        terminalDurationUs: outer[terminalIndex]!.dur,
        bareHandlers: handlerBinding.bareHandlers,
    };
}
