import { createHandler } from '#/utils/createHandler';
import { addTrack, getTrackStoreState } from '#/modules/Arrangement/useCases';
import { applyChordProgressionToTrack } from '../../useCases/generateChordProgression/applyToTrack';
import {
    type ChordProgressionStyle,
    type ChordVoicing,
} from '../../useCases/generateChordProgression/algorithm';
import { getPlayheadBeat, resolveOrCreateMidiTrack, VALID_CHORD_STYLES, VALID_VOICINGS } from './generationHandlerHelpers';

export const handleGenerateChordProgression = createHandler<'generateChordProgression'>({
    execute: (a) => {
        const style: ChordProgressionStyle = VALID_CHORD_STYLES.has(a.payload.style)
            ? (a.payload.style as ChordProgressionStyle)
            : 'pop';

        const scale = a.payload.scale === 'major' || a.payload.scale === 'minor' ? a.payload.scale : 'major';

        const key = typeof a.payload.key === 'number' ? Math.max(0, Math.min(11, a.payload.key)) : 0;

        const voicing: ChordVoicing = VALID_VOICINGS.has(a.payload.voicing ?? '')
            ? (a.payload.voicing as ChordVoicing)
            : 'close';

        const trackId = resolveOrCreateMidiTrack(a.payload.trackId, `Chords (${style})`, {
            getTrackStoreState,
            addTrack,
        });
        if (!trackId) {
            return;
        }

        applyChordProgressionToTrack(
            trackId,
            {
                style,
                key,
                scale,
                bars: a.payload.bars,
                voicing,
            },
            getPlayheadBeat()
        );
    },
    describe: (a) => ({ label: `Generate ${a.payload.style} chord progression` }),
    undoable: true,
});
