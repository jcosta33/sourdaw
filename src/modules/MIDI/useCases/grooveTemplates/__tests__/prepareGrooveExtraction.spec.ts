import { describe, it, expect, beforeEach } from 'vitest';

import { type MidiNote } from '../../../models/MidiNote';
import { defaultGrooveTemplateState, grooveTemplateStore } from '../../../stores/grooveTemplateStore';
import { midiStore } from '../../../stores/midiStore';
import { prepareGrooveExtraction } from '../prepareGrooveExtraction';

function note(pitch: number, startBeat: number, duration = 0.5, velocity = 100): MidiNote {
    return { id: `n-${pitch}-${startBeat}`, pitch, startBeat, duration, velocity };
}

function seedMidi(notes: MidiNote[]) {
    midiStore.set({
        notesByClipId: { 'clip-1': notes },
        ccByClipId: {},
        pitchBendByClipId: {},
    });
}

describe('prepareGrooveExtraction', () => {
    beforeEach(() => {
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    });

    it('returns an "extracted" status with a midi-clip provenance template when notes have timing variation', () => {
        // Off-grid notes (startBeat 0.12 is not on the 1/16 grid) force a non-straight extraction.
        const notes = [note(60, 0), note(64, 0.12), note(67, 0.5), note(72, 0.62)];
        seedMidi(notes);
        const result = prepareGrooveExtraction({ clipId: 'clip-1', sourceName: 'Swung', subdivision: '1/16' });
        expect(result.status).toBe('extracted');
        if (result.status === 'extracted') {
            expect(result.template.subdivision).toBe('1/16');
            expect(result.template.provenance.type).toBe('midi-clip');
            expect(result.template.id).not.toBe('groove-straight');
            expect(result.sourceRevision).toBeTruthy();
        }
    });

    it('returns a "straight" status for uniform on-grid notes with no timing variation', () => {
        // 8 notes exactly on the 1/16 grid → straight template.
        const notes = Array.from({ length: 8 }, (_, i) => note(60 + (i % 3), i * 0.25));
        seedMidi(notes);
        const result = prepareGrooveExtraction({ clipId: 'clip-1', sourceName: 'Grid', subdivision: '1/16' });
        expect(result.status).toBe('straight');
        if (result.status === 'straight') {
            expect(result.template.id).toBe('groove-straight');
            expect(result.template.provenance.type).toBe('builtin');
        }
    });

    it('returns a non-empty sourceRevision string in every outcome', () => {
        const notes = [note(60, 0), note(62, 0.5)];
        seedMidi(notes);
        const result = prepareGrooveExtraction({ clipId: 'clip-1', sourceName: 'G', subdivision: '1/16' });
        expect(result.sourceRevision.length).toBeGreaterThan(0);
    });

    it('returns "empty" when the clip has no notes', () => {
        seedMidi([]);
        const result = prepareGrooveExtraction({ clipId: 'clip-1', sourceName: 'Empty', subdivision: '1/16' });
        expect(result.status).toBe('empty');
    });

    it('returns "unsupported" for an unknown subdivision', () => {
        seedMidi([note(60, 0)]);
        const result = prepareGrooveExtraction({ clipId: 'clip-1', sourceName: 'G', subdivision: '1/64' });
        expect(result.status).toBe('unsupported');
    });

    it('returns "straight" when the extracted template is the straight id', () => {
        // A single note with no timing variation deterministically extracts to straight.
        seedMidi([note(60, 0)]);
        const result = prepareGrooveExtraction({
            clipId: 'clip-1',
            sourceName: 'Straight-ish',
            subdivision: '1/16',
            templateId: 'groove-straight',
        });
        expect(result.status).toBe('straight');
        if (result.status === 'straight') {
            expect(result.template.id).toBe('groove-straight');
        }
    });

    it('produces identical sourceRevision for the same note content', () => {
        const notes = [note(60, 0), note(64, 0.5)];
        seedMidi(notes);
        const first = prepareGrooveExtraction({ clipId: 'clip-1', sourceName: 'A', subdivision: '1/16' });
        const second = prepareGrooveExtraction({ clipId: 'clip-1', sourceName: 'B', subdivision: '1/16' });
        expect(first.sourceRevision).toBe(second.sourceRevision);
    });

    it('produces different sourceRevision when note content differs', () => {
        seedMidi([note(60, 0)]);
        const first = prepareGrooveExtraction({ clipId: 'clip-1', sourceName: 'A', subdivision: '1/16' });
        seedMidi([note(62, 0)]);
        const second = prepareGrooveExtraction({ clipId: 'clip-1', sourceName: 'B', subdivision: '1/16' });
        expect(first.sourceRevision).not.toBe(second.sourceRevision);
    });
});
