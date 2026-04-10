import { createHandler } from '#/helpers/createHandler';
import { addTrack, getTrackStoreState } from '#/modules/Arrangement';
import { applyDrumPatternToTrack } from '../../useCases/generateDrumPattern/applyToTrack';
import { type DrumPatternStyle } from '../../useCases/generateDrumPattern/algorithm';
import { getPlayheadBeat, resolveOrCreateMidiTrack, VALID_DRUM_STYLES } from './generationHandlerHelpers';

export const handleGenerateDrumPattern = createHandler<'generateDrumPattern'>({
    execute: (a) => {
        const style = VALID_DRUM_STYLES.has(a.payload.style) ? (a.payload.style as DrumPatternStyle) : 'rock';

        const trackId = resolveOrCreateMidiTrack(a.payload.trackId, `Drums (${style})`, {
            getTrackStoreState,
            addTrack,
        });
        if (!trackId) {
            return;
        }

        applyDrumPatternToTrack(
            trackId,
            {
                style,
                bars: a.payload.bars,
                density: a.payload.density,
            },
            getPlayheadBeat()
        );
    },
    describe: (a) => ({ label: `Generate ${a.payload.style} drum pattern` }),
    undoable: true,
});
