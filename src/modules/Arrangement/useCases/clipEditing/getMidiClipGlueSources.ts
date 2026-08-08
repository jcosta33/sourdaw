import { type Clip } from '../../models/Track';

type GetMidiClipGlueSourcesInput = {
    clips: readonly Clip[];
    gluedStartBeat: number;
};

export function getMidiClipGlueSources({ clips, gluedStartBeat }: GetMidiClipGlueSourcesInput) {
    return clips.map((clip) => {
        const midiOffsetBeats = clip.midiOffsetBeats ?? 0;
        return {
            clipId: clip.id,
            beatOffset: clip.startBeat - gluedStartBeat - midiOffsetBeats,
            visibleStartBeat: midiOffsetBeats,
            visibleEndBeat: midiOffsetBeats + (clip.endBeat - clip.startBeat),
        };
    });
}
