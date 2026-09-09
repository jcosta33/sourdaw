export type TraceEvent = {
    name: string;
    ph: string;
    ts: number;
    dur: number;
    pid: number;
    tid: number;
    args: Record<string, unknown>;
};
export type TraceAdmission =
    | { status: 'admitted'; measuredDurations: number[]; terminalDuration: number; bareHandlers: number }
    | { status: 'refused'; reason: string };

const OUTER = 'AudioWorkletProcessor::Process';
const HANDLER = 'AudioHandler::ProcessIfNecessary';
const AUTHOR = 'AudioWorkletProcessor::Process (author script execution)';

function isEvent(value: unknown): value is TraceEvent {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const event = value as Record<string, unknown>;
    return (
        event.ph === 'X' &&
        typeof event.name === 'string' &&
        typeof event.ts === 'number' &&
        Number.isFinite(event.ts) &&
        event.ts >= 0 &&
        typeof event.dur === 'number' &&
        Number.isFinite(event.dur) &&
        event.dur >= 0 &&
        typeof event.pid === 'number' &&
        typeof event.tid === 'number' &&
        event.args !== null &&
        typeof event.args === 'object' &&
        !Array.isArray(event.args)
    );
}

export function admitOfflineAudioWorkletTrace(events: readonly unknown[], expectedCallbacks = 24_001): TraceAdmission {
    const relevant = events.filter(
        (event): event is TraceEvent => isEvent(event) && [OUTER, HANDLER, AUTHOR].includes(event.name)
    );
    const outer = relevant.filter((event) => event.name === OUTER).toSorted((a, b) => a.ts - b.ts);
    if (outer.length !== expectedCallbacks) {
        return { status: 'refused', reason: `expected ${expectedCallbacks} outer callbacks, received ${outer.length}` };
    }
    const [pid, tid] = [outer[0]!.pid, outer[0]!.tid];
    if (
        outer.some(
            (event, index) =>
                event.pid !== pid ||
                event.tid !== tid ||
                (index > 0 && event.ts < outer[index - 1]!.ts + outer[index - 1]!.dur)
        )
    ) {
        return { status: 'refused', reason: 'outer callbacks are not one non-overlapping thread' };
    }
    for (const outerEvent of outer) {
        const enclosingHandlers = relevant.filter(
            (event) =>
                event.name === HANDLER &&
                event.pid === pid &&
                event.tid === tid &&
                event.ts <= outerEvent.ts &&
                event.ts + event.dur >= outerEvent.ts + outerEvent.dur &&
                event.args['node type'] === 'AudioWorkletNode'
        );
        if (enclosingHandlers.length !== 1) {
            return { status: 'refused', reason: 'outer callback lacks one AudioWorkletNode handler' };
        }
        const authors = relevant.filter(
            (event) =>
                event.name === AUTHOR &&
                event.pid === pid &&
                event.tid === tid &&
                event.ts >= outerEvent.ts &&
                event.ts + event.dur <= outerEvent.ts + outerEvent.dur
        );
        if (authors.length !== 1) {
            return { status: 'refused', reason: 'outer callback lacks one author execution event' };
        }
    }
    const bareHandlers = relevant.filter(
        (event) =>
            event.name === HANDLER &&
            !outer.some(
                (item) =>
                    item.pid === event.pid &&
                    item.tid === event.tid &&
                    event.ts <= item.ts &&
                    event.ts + event.dur >= item.ts + item.dur
            )
    ).length;
    return {
        status: 'admitted',
        measuredDurations: outer.slice(4000, -1).map((event) => event.dur),
        terminalDuration: outer.at(-1)!.dur,
        bareHandlers,
    };
}
