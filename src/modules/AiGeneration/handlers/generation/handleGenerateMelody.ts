import { createHandler } from '#/helpers/createHandler';
import { addTrack, getTrackStoreState } from '#/modules/Arrangement/useCases';
import { applyMelodyToTrack } from '../../useCases/generateMelody/applyToTrack';
import { type ScaleType } from '../../useCases/generateMelody/algorithm';
import { getPlayheadBeat, resolveOrCreateMidiTrack, VALID_MELODY_STYLES, VALID_SCALES } from './generationHandlerHelpers';

export const handleGenerateMelody = createHandler<'generateMelody'>({
    execute: (a) => {
        const style = VALID_MELODY_STYLES.has(a.payload.style)
            ? (a.payload.style as 'simple' | 'arpeggiated' | 'stepwise' | 'rhythmic' | 'ambient')
            : 'simple';

        const scale: ScaleType = VALID_SCALES.has(a.payload.scale ?? '') ? (a.payload.scale as ScaleType) : 'major';

        const key = typeof a.payload.key === 'number' ? Math.max(0, Math.min(11, a.payload.key)) : 0;

        const trackId = resolveOrCreateMidiTrack(a.payload.trackId, `Melody (${style})`, {
            getTrackStoreState,
            addTrack,
        });
        if (!trackId) {
            return;
        }

        applyMelodyToTrack(
            trackId,
            {
                style,
                key,
                scale,
                bars: a.payload.bars,
            },
            getPlayheadBeat()
        );
    },
    describe: (a) => ({ label: `Generate ${a.payload.style} melody` }),
    undoable: true,
});
