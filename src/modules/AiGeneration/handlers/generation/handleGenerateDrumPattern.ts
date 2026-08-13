import { type DrumPatternStyle } from '../../useCases/generateDrumPattern/algorithm';
import { applyDrumPatternToTrack } from '../../useCases/generateDrumPattern/applyToTrack';

import { createGenerationHandler } from './createGenerationHandler';
import { VALID_DRUM_STYLES } from './generationHandlerHelpers';

export const handleGenerateDrumPattern = createGenerationHandler<'generateDrumPattern'>({
    validStyles: VALID_DRUM_STYLES,
    defaultStyle: 'rock',
    labelSuffix: 'drum pattern',
    trackNamePrefix: 'Drums',
    applyToTrack: (trackId, action, style, playheadBeat) => {
        return applyDrumPatternToTrack(
            trackId,
            {
                style: style as DrumPatternStyle,
                bars: action.payload.bars,
                density: action.payload.density,
                seed: action.payload.seed,
            },
            playheadBeat
        );
    },
});
