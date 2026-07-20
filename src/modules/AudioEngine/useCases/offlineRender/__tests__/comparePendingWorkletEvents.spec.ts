import { describe, expect, it, vi } from 'vitest';

import { comparePendingWorkletEvents } from '../comparePendingWorkletEvents';
import { type PendingWorkletEvent } from '../types';

const controls = { noteOn: vi.fn(), noteOff: vi.fn() };

function event(type: 'on' | 'off', pitch: number): PendingWorkletEvent {
    return {
        time: 1,
        type,
        pitch,
        velocity: 1,
        instrumentControls: controls,
        isToaster: false,
        toasterPadIndex: -1,
    };
}

describe('comparePendingWorkletEvents', () => {
    it('returns zero for equal-time equal-type events so stable insertion order remains valid', () => {
        expect(comparePendingWorkletEvents(event('on', 60), event('on', 61))).toBe(0);
        expect(comparePendingWorkletEvents(event('off', 60), event('off', 61))).toBe(0);
    });

    it('orders note-off before note-on at the same time', () => {
        expect(comparePendingWorkletEvents(event('off', 60), event('on', 60))).toBeLessThan(0);
        expect(comparePendingWorkletEvents(event('on', 60), event('off', 60))).toBeGreaterThan(0);
    });
});
