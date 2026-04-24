import { describe, expect, it } from 'vitest';

import { createMidiCC, createMidiNote, createMidiPitchBend } from '../MidiNote';

describe('createMidiNote', () => {
    it('creates notes with defaults and incrementing ids', () => {
        const alpha = createMidiNote(60, 0, 1);
        const b = createMidiNote(61, 4, 0.5, 80, 50);
        expect(alpha.pitch).toBe(60);
        expect(alpha.velocity).toBe(100);
        expect(alpha.probability).toBe(100);
        expect(alpha.id).toMatch(/^note-[a-f0-9]{8}$/i);
        expect(b.velocity).toBe(80);
        expect(b.probability).toBe(50);
        expect(b.id).not.toBe(alpha.id);
    });
});

describe('createMidiCC', () => {
    it('creates CC events with default channel 0', () => {
        const ev = createMidiCC(7, 100, 2);
        expect(ev.controller).toBe(7);
        expect(ev.value).toBe(100);
        expect(ev.beat).toBe(2);
        expect(ev.channel).toBe(0);
        expect(ev.id).toMatch(/^cc-[a-f0-9]{8}$/i);
    });
});

describe('createMidiPitchBend', () => {
    it('creates pitch bend events', () => {
        const ev = createMidiPitchBend(0.5, 1, 2);
        expect(ev.value).toBe(0.5);
        expect(ev.beat).toBe(1);
        expect(ev.channel).toBe(2);
        expect(ev.id).toMatch(/^pb-[a-f0-9]{8}$/i);
    });
});
