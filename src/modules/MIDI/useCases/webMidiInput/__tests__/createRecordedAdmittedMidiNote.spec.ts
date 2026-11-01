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
