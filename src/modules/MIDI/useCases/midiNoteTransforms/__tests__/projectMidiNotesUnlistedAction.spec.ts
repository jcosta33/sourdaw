import { describe, expect, it } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { projectMidiNotesByClipIdThroughRestores } from '../projectMidiNotesByClipIdThroughRestores';

describe('projectMidiNotesByClipIdThroughRestores', () => {
    it('leaves the live notes buckets as they were for an action that writes no notes', () => {
        const before = projectMidiNotesByClipIdThroughRestores([]);

        expect(projectMidiNotesByClipIdThroughRestores([{ type: 'togglePlayback' }])).toEqual(before);
        expect(midiStore.value?.notesByClipId ?? {}).toEqual(before);
    });

    function seedClip(): void {
        midiStore.set({
            notesByClipId: {
                'clip-1': [
                    { id: 'a', pitch: 60, startBeat: 0, duration: 1, velocity: 20 },
                    { id: 'b', pitch: 62, startBeat: 1, duration: 1, velocity: 100 },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    }

    it('projects scaleVelocities onto a held clip and ignores a clip it holds no notes for', () => {
        seedClip();

        const projected = projectMidiNotesByClipIdThroughRestores([
            {
                type: 'scaleVelocities',
                payload: { clipId: 'clip-1', curve: 'linear', minVelocity: 40, maxVelocity: 80 },
            },
            { type: 'scaleVelocities', payload: { clipId: 'missing', curve: 'linear' } },
        ]);

        expect(projected['clip-1']?.map((n) => n.velocity)).toEqual([40, 80]);
        expect(Object.keys(projected)).toEqual(['clip-1']);
        expect(midiStore.value?.notesByClipId['clip-1']?.map((n) => n.velocity)).toEqual([20, 100]);
    });

    it('projects humanizeNotes only once its seed is minted', () => {
        seedClip();
        const unseeded = projectMidiNotesByClipIdThroughRestores([
            { type: 'humanizeNotes', payload: { clipId: 'clip-1', amount: 1 } },
        ]);
        const seeded = projectMidiNotesByClipIdThroughRestores([
            { type: 'humanizeNotes', payload: { clipId: 'clip-1', amount: 1, seed: 7 } },
        ]);
        const missingClip = projectMidiNotesByClipIdThroughRestores([
            { type: 'humanizeNotes', payload: { clipId: 'missing', amount: 1, seed: 7 } },
        ]);

        expect(unseeded['clip-1']).toEqual(midiStore.value?.notesByClipId['clip-1']);
        expect(seeded['clip-1']).not.toEqual(midiStore.value?.notesByClipId['clip-1']);
        expect(Object.keys(missingClip)).toEqual(['clip-1']);
        expect(missingClip['clip-1']).toEqual(midiStore.value?.notesByClipId['clip-1']);
    });
});
