import { applyDrumPatternToTrack } from '../../useCases/generateDrumPattern/applyToTrack';
import { type DrumPatternStyle } from '../../useCases/generateDrumPattern/algorithm';
import { VALID_DRUM_STYLES } from './generationHandlerHelpers';
import { createGenerationHandler } from './createGenerationHandler';

export const handleGenerateDrumPattern = createGenerationHandler<'generateDrumPattern'>({
    validStyles: VALID_DRUM_STYLES,
    defaultStyle: 'rock',
    labelSuffix: 'drum pattern',
    trackNamePrefix: 'Drums',
    applyToTrack: (trackId, action, style, playheadBeat) => {
        applyDrumPatternToTrack(
            trackId,
            { style: style as DrumPatternStyle, bars: action.payload.bars, density: action.payload.density },
            playheadBeat
        );
    },
});
