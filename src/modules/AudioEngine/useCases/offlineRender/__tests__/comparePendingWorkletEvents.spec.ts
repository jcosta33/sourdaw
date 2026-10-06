import { describe, expect, it, vi } from 'vitest';

import { comparePendingWorkletEvents } from '../comparePendingWorkletEvents';
import {
    type PendingControlWorkletEvent,
    type PendingExpressionWorkletEvent,
    type PendingNoteWorkletEvent,
} from '../types';

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

function controlEvent(controller: number): PendingControlWorkletEvent {
    return { time: 1, type: 'control', controller, value: 127, dispatch: vi.fn() };
}

describe('comparePendingWorkletEvents', () => {
    it('sorts the four kinds sharing one time release, controller, note-on, expression', () => {
        // A pedal pressed on the frame a note ends must not catch that note (the
        // release applies first); a pedal on the frame a note starts must (the
        // controller applies before the note-on).
        const shuffled = [expressionEvent(60), event('on', 60), controlEvent(64), event('off', 60)];

        const sorted = [...shuffled].sort(comparePendingWorkletEvents);

        expect(sorted.map((pending) => pending.type)).toEqual(['off', 'control', 'on', 'expression']);
    });

    it('orders a stored controller after the release and ahead of the note-on sharing its time', () => {
        expect(comparePendingWorkletEvents(event('off', 60), controlEvent(64))).toBeLessThan(0);
        expect(comparePendingWorkletEvents(controlEvent(64), event('off', 60))).toBeGreaterThan(0);
        expect(comparePendingWorkletEvents(controlEvent(64), event('on', 60))).toBeLessThan(0);
        expect(comparePendingWorkletEvents(event('on', 60), controlEvent(64))).toBeGreaterThan(0);
        expect(comparePendingWorkletEvents(controlEvent(64), expressionEvent(60))).toBeLessThan(0);
    });

    it('keeps two controllers at one time in insertion order', () => {
        expect(comparePendingWorkletEvents(controlEvent(64), controlEvent(66))).toBe(0);
    });

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
