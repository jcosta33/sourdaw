import { describe, expect, it } from 'vitest';

import { createRecordedAdmittedMidiNote } from '../createRecordedAdmittedMidiNote';

const admission = {
    id: 'admission-1',
    clipId: 'clip-1',
    trackId: 'track-1',
    channel: 4,
    note: 62,
    velocity: 90,
    onsetAudioTime: 1,
    onsetSourceBeat: 2,
    releaseSourceBeat: 3,
};

describe('createRecordedAdmittedMidiNote', () => {
    // Stored playback bends a note only by its own channel's recorded wheel, as the live input does, so the note
    // keeps the channel it was admitted on.
    it('preserves the ordinary manual minimum for a short released or stopped note', () => {
        const short = { ...admission, releaseSourceBeat: 2.01 };
        expect(createRecordedAdmittedMidiNote(short, 1.005)).toMatchObject({ duration: 0.0625 });
        expect(createRecordedAdmittedMidiNote({ ...short, releaseSourceBeat: undefined }, 1.005, 2.01)).toMatchObject({
            duration: 0.0625,
        });
    });

    it('caps only an owned automatic minimum and refuses a nonpositive or invalid interval', () => {
        const short = createRecordedAdmittedMidiNote(
            { ...admission, releaseSourceBeat: 2.005, exclusiveSourceEndBeat: 2.01 },
            1.005
        );
        expect(short).not.toBeNull();
        expect(short?.duration).toBeCloseTo(0.01, 12);
        expect(createRecordedAdmittedMidiNote(admission, 2, undefined, 2)).toBeNull();
        expect(createRecordedAdmittedMidiNote(admission, 2, undefined, Number.NaN)).toBeNull();
    });

    it('keeps the channel the note was admitted on', () => {
        expect(createRecordedAdmittedMidiNote(admission, 2)).toMatchObject({
            pitch: 62,
            startBeat: 2,
            duration: 1,
            velocity: 90,
            channel: 4,
        });
    });

    it('keeps the channel on a note that carries recorded expression', () => {
        const note = createRecordedAdmittedMidiNote(
            { ...admission, initialExpression: { pitchBend: 1024, pitchBendRangeSemitones: 48 } },
            2
        );

        expect(note).toMatchObject({ channel: 4, pitchBend: 1024 });
    });
});
