import { applyMelodyToTrack } from '../../useCases/generateMelody/applyToTrack';
import { type ScaleType } from '../../useCases/generateMelody/algorithm';
import { VALID_MELODY_STYLES, VALID_SCALES } from './generationHandlerHelpers';
import { createGenerationHandler } from './createGenerationHandler';

export const handleGenerateMelody = createGenerationHandler<'generateMelody'>({
    validStyles: VALID_MELODY_STYLES,
    defaultStyle: 'simple',
    labelSuffix: 'melody',
    trackNamePrefix: 'Melody',
    applyToTrack: (trackId, action, style, playheadBeat) => {
        const scale: ScaleType = VALID_SCALES.has(action.payload.scale ?? '') ? (action.payload.scale as ScaleType) : 'major';
        const key = typeof action.payload.key === 'number' ? Math.max(0, Math.min(11, action.payload.key)) : 0;

        return applyMelodyToTrack(
            trackId,
            { style: style as 'simple' | 'arpeggiated' | 'stepwise' | 'rhythmic' | 'ambient', key, scale, bars: action.payload.bars },
            playheadBeat
        );
    },
});
