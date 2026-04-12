import { describe, expect, it } from 'vitest';

import { createMidiCC, createMidiNote, createMidiPitchBend } from '../MidiNote';

describe('createMidiNote', () => {
    it('creates notes with defaults and incrementing ids', () => {
        const a = createMidiNote(60, 0, 1);
        const b = createMidiNote(61, 4, 0.5, 80, 50);
        expect(a.pitch).toBe(60);
        expect(a.velocity).toBe(100);
        expect(a.probability).toBe(100);
        expect(a.id).toMatch(/^note-\d+$/);
        expect(b.velocity).toBe(80);
        expect(b.probability).toBe(50);
        expect(b.id).not.toBe(a.id);
    });
});

describe('createMidiCC', () => {
    it('creates CC events with default channel 0', () => {
        const ev = createMidiCC(7, 100, 2);
        expect(ev.controller).toBe(7);
        expect(ev.value).toBe(100);
        expect(ev.beat).toBe(2);
        expect(ev.channel).toBe(0);
        expect(ev.id).toMatch(/^cc-\d+$/);
    });
});

describe('createMidiPitchBend', () => {
    it('creates pitch bend events', () => {
        const ev = createMidiPitchBend(0.5, 1, 2);
        expect(ev.value).toBe(0.5);
        expect(ev.beat).toBe(1);
        expect(ev.channel).toBe(2);
        expect(ev.id).toMatch(/^pb-\d+$/);
    });
});
