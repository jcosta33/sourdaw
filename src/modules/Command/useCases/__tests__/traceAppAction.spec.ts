import { describe, it, expect, beforeEach } from 'vitest';

import { traceAppAction } from '../traceAppAction';

type SourdawGlobals = {
    __sourdaw_trace__?: {
        push(entry: { type: string; source: string; timestamp: number }): void;
        entries(): { type: string; source: string; timestamp: number }[];
        clear(): void;
    };
};

function getRing(): NonNullable<SourdawGlobals['__sourdaw_trace__']> {
    const globals = window as typeof window & SourdawGlobals;
    const ring = globals.__sourdaw_trace__;
    expect(ring).toBeDefined();
    return ring!;
}

describe('traceAppAction', () => {
    beforeEach(() => {
        const globals = window as typeof window & SourdawGlobals;
        delete globals.__sourdaw_trace__;
    });

    it('lazily creates the ring on the first call and pushes an entry with type/source/timestamp', () => {
        traceAppAction('addTrack', 'manual');

        const entries = getRing().entries();
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ type: 'addTrack', source: 'manual' });
        expect(typeof entries[0]!.timestamp).toBe('number');
    });

    it('appends entries in call order across multiple calls', () => {
        traceAppAction('addTrack', 'manual');
        traceAppAction('removeTrack', 'shortcut');
        traceAppAction('undo', 'voice');

        const entries = getRing().entries();
        expect(entries.map((entry) => entry.type)).toEqual(['addTrack', 'removeTrack', 'undo']);
    });

    it('clear() empties the ring', () => {
        traceAppAction('addTrack', 'manual');
        const ring = getRing();

        ring.clear();

        expect(ring.entries()).toEqual([]);
    });

    it('wraps around and drops the oldest entries once the ring exceeds its capacity', () => {
        const capacity = 128;
        for (let index = 0; index < capacity + 5; index += 1) {
            traceAppAction(`action-${index}`, 'manual');
        }

        const entries = getRing().entries();
        expect(entries).toHaveLength(capacity);
        expect(entries[0]!.type).toBe('action-5');
        expect(entries[entries.length - 1]!.type).toBe(`action-${capacity + 4}`);
    });

    it('reuses the same ring instance across calls instead of recreating it', () => {
        traceAppAction('addTrack', 'manual');
        const firstRing = getRing();

        traceAppAction('removeTrack', 'manual');
        const secondRing = getRing();

        expect(secondRing).toBe(firstRing);
        expect(secondRing.entries()).toHaveLength(2);
    });
});
