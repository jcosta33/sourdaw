import { describe, it, expect } from 'vitest';

import { beginTelemetryPublish, endTelemetryPublish, TELEMETRY_SEQ_IDX } from '../telemetrySeqlock';

function makeSeqView(initial: number = 0): Int32Array {
    const arr = new Int32Array(32);
    arr[TELEMETRY_SEQ_IDX] = initial;
    return arr;
}

describe('telemetrySeqlock — TELEMETRY_SEQ_IDX', () => {
    it('is 31', () => {
        expect(TELEMETRY_SEQ_IDX).toBe(31);
    });
});

describe('beginTelemetryPublish', () => {
    it('bumps counter from even to odd', () => {
        const view = makeSeqView(0);
        beginTelemetryPublish(view);
        expect(view[TELEMETRY_SEQ_IDX]!).toBe(1);
    });

    it('bumps counter from odd to even when called again', () => {
        const view = makeSeqView(0);
        beginTelemetryPublish(view);
        beginTelemetryPublish(view);
        expect(view[TELEMETRY_SEQ_IDX]!).toBe(2);
    });

    it('is a no-op when seqView is null', () => {
        expect(() => beginTelemetryPublish(null)).not.toThrow();
    });
});

describe('endTelemetryPublish', () => {
    it('bumps counter from odd back to even after begin+end', () => {
        const view = makeSeqView(0);
        beginTelemetryPublish(view); // 0 → 1 (odd)
        endTelemetryPublish(view); // 1 → 2 (even)
        expect(view[TELEMETRY_SEQ_IDX]!).toBe(2);
        expect(view[TELEMETRY_SEQ_IDX]! % 2).toBe(0);
    });

    it('is a no-op when seqView is null', () => {
        expect(() => endTelemetryPublish(null)).not.toThrow();
    });
});

describe('telemetrySeqlock — full begin+end cycle preserves even parity', () => {
    it('after multiple cycles counter stays even', () => {
        const view = makeSeqView(10);
        beginTelemetryPublish(view);
        endTelemetryPublish(view);
        beginTelemetryPublish(view);
        endTelemetryPublish(view);
        expect(view[TELEMETRY_SEQ_IDX]!).toBe(14);
        expect(view[TELEMETRY_SEQ_IDX]! % 2).toBe(0);
    });
});
