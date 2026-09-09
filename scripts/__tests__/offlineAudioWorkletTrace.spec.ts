import { describe, expect, it } from 'vitest';

import { admitOfflineAudioWorkletTrace, type OfflineTraceExpectation } from '../offlineAudioWorkletTrace';

const OUTER = 'AudioWorkletProcessor::Process';
const HANDLER = 'AudioHandler::ProcessIfNecessary';
const AUTHOR = 'AudioWorkletProcessor::Process (author script execution)';
const SMALL_PHASES: OfflineTraceExpectation = { warmupCallbacks: 1, measuredCallbacks: 2 };

type FixtureEvent = {
    name: string;
    ph: string;
    ts: number;
    dur: number;
    pid: number;
    tid: number;
    args: Record<string, unknown>;
};

function callback(ts: number, outerDuration: number): FixtureEvent[] {
    return [
        {
            name: HANDLER,
            ph: 'X',
            ts,
            dur: outerDuration + 4,
            pid: 1,
            tid: 2,
            args: { 'node type': 'AudioWorkletNode', this: '0x1' },
        },
        { name: OUTER, ph: 'X', ts: ts + 1, dur: outerDuration + 2, pid: 1, tid: 2, args: {} },
        { name: AUTHOR, ph: 'X', ts: ts + 2, dur: outerDuration, pid: 1, tid: 2, args: {} },
    ];
}

function validTrace(): FixtureEvent[] {
    return [
        { name: 'metadata', ph: 'M', ts: 0, dur: 0, pid: 0, tid: 0, args: {} },
        ...callback(10, 2),
        ...callback(30, 3),
        ...callback(50, 8),
        ...callback(80, 12),
        {
            name: HANDLER,
            ph: 'X',
            ts: 110,
            dur: 2,
            pid: 1,
            tid: 2,
            args: { 'node type': 'AudioWorkletNode', this: '0x1' },
        },
    ];
}

function admission(events: readonly unknown[] = validTrace(), dataLossOccurred: unknown = false) {
    return admitOfflineAudioWorkletTrace({ events, dataLossOccurred, expectation: SMALL_PHASES });
}

function withoutName(events: readonly FixtureEvent[], name: string, timestamp: number): FixtureEvent[] {
    return events.filter((event) => event.name !== name || event.ts !== timestamp);
}

describe('offline AudioWorklet trace admission', () => {
    it('admits a complete nested trace and binds the explicit phase population', () => {
        expect(admission()).toEqual({
            status: 'admitted',
            outerCallbacks: 4,
            pid: 1,
            tid: 2,
            handlerThis: '0x1',
            warmupDurationsUs: [4],
            measuredDurationsUs: [5, 10],
            terminalDurationUs: 14,
            bareHandlers: 1,
        });
    });

    it('refuses data loss even when the interval population is otherwise complete', () => {
        expect(admission(validTrace(), true)).toEqual({
            status: 'refused',
            reason: 'trace did not explicitly report dataLossOccurred false',
        });
        expect(
            admitOfflineAudioWorkletTrace({
                events: validTrace(),
                dataLossOccurred: undefined,
                expectation: SMALL_PHASES,
            }).status
        ).toBe('refused');
    });

    it('refuses missing and extra outer callbacks', () => {
        expect(admission(withoutName(validTrace(), OUTER, 51)).status).toBe('refused');
        expect(admission([...validTrace(), ...callback(130, 1)]).status).toBe('refused');
    });

    it('refuses removal of the final slow measured callback', () => {
        const withoutLastMeasured = validTrace().filter((event) => event.ts < 50 || event.ts >= 80);
        expect(admission(withoutLastMeasured)).toEqual({
            status: 'refused',
            reason: 'expected 4 outer callbacks, received 3',
        });
    });

    it('refuses a missing, wrong-thread or wrong-node enclosing handler', () => {
        expect(admission(withoutName(validTrace(), HANDLER, 30)).status).toBe('refused');
        expect(
            admission(
                validTrace().map((event) => (event.name === HANDLER && event.ts === 30 ? { ...event, tid: 9 } : event))
            ).status
        ).toBe('refused');
        expect(
            admission(
                validTrace().map((event) =>
                    event.name === HANDLER && event.ts === 30
                        ? { ...event, args: { ...event.args, 'node type': 'GainNode' } }
                        : event
                )
            ).status
        ).toBe('refused');
    });

    it('refuses callbacks bound to different AudioWorkletNode instances', () => {
        const mixedPointers = validTrace().map((event) =>
            event.name === HANDLER && event.ts === 50 ? { ...event, args: { ...event.args, this: '0x2' } } : event
        );

        expect(admission(mixedPointers)).toEqual({
            status: 'refused',
            reason: 'outer callbacks do not share one AudioWorkletNode trace pointer',
        });
    });

    it('refuses a missing or wrong-thread author execution', () => {
        expect(admission(withoutName(validTrace(), AUTHOR, 32)).status).toBe('refused');
        expect(
            admission(
                validTrace().map((event) => (event.name === AUTHOR && event.ts === 32 ? { ...event, tid: 9 } : event))
            ).status
        ).toBe('refused');
    });

    it('refuses overlapping outer callbacks and ambiguous handler nesting', () => {
        expect(
            admission(
                validTrace().map((event) => (event.name === OUTER && event.ts === 31 ? { ...event, ts: 15 } : event))
            ).status
        ).toBe('refused');
        expect(admission([...validTrace(), { ...validTrace()[1]!, dur: 30 }]).status).toBe('refused');
    });

    it('refuses malformed relevant intervals while ignoring unrelated metadata shapes', () => {
        expect(
            admission(
                validTrace().map((event) =>
                    event.name === OUTER && event.ts === 31 ? { ...event, ts: Number.NaN } : event
                )
            ).status
        ).toBe('refused');
        expect(admission([{ name: OUTER, ph: 'B' }, ...validTrace()]).status).toBe('refused');
        expect(admission([null, 1, { name: 'metadata', ph: 'M' }, ...validTrace()]).status).toBe('admitted');
    });
});
