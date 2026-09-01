import { describe, expect, it, vi } from 'vitest';

import { comparePendingWorkletEvents } from '../comparePendingWorkletEvents';
import { type PendingExpressionWorkletEvent, type PendingNoteWorkletEvent } from '../types';

const controls = { noteOn: vi.fn(), noteOff: vi.fn() };

function event(type: 'on' | 'off', pitch: number): PendingNoteWorkletEvent {
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

function expressionEvent(pitch: number): PendingExpressionWorkletEvent {
    return {
        time: 1,
        type: 'expression',
        pitch,
        channel: 0,
        dispatch: vi.fn(),
        bendSemitones: 1,
        pressure: 0.5,
        slide: 0,
    };
}

describe('comparePendingWorkletEvents', () => {
    it('returns zero for equal-time equal-type events so stable insertion order remains valid', () => {
        expect(comparePendingWorkletEvents(event('on', 60), event('on', 61))).toBe(0);
        expect(comparePendingWorkletEvents(event('off', 60), event('off', 61))).toBe(0);
        expect(comparePendingWorkletEvents(expressionEvent(60), expressionEvent(61))).toBe(0);
    });

    it('orders note-off before note-on at the same time', () => {
        expect(comparePendingWorkletEvents(event('off', 60), event('on', 60))).toBeLessThan(0);
        expect(comparePendingWorkletEvents(event('on', 60), event('off', 60))).toBeGreaterThan(0);
    });

    it('orders expression after the note-on that creates the voice it bends', () => {
        // The engines address expression per note *instance*: they only touch a
        // voice still held on that member channel. Sorting expression ahead of
        // its own note-on at the same frame therefore drops it entirely — the
        // voice does not exist yet — and the note sounds unbent.
        expect(comparePendingWorkletEvents(expressionEvent(60), event('on', 60))).toBeGreaterThan(0);
        expect(comparePendingWorkletEvents(event('on', 60), expressionEvent(60))).toBeLessThan(0);
    });

    it('orders expression after a release sharing its time', () => {
        expect(comparePendingWorkletEvents(expressionEvent(60), event('off', 60))).toBeGreaterThan(0);
        expect(comparePendingWorkletEvents(event('off', 60), expressionEvent(60))).toBeLessThan(0);
    });

    it('keeps time the primary key, so a later release still follows an earlier expression', () => {
        expect(comparePendingWorkletEvents(expressionEvent(60), { ...event('off', 60), time: 2 })).toBeLessThan(0);
    });
});
