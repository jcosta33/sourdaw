import { type ChordProgressionStyle, type ChordVoicing } from '../../useCases/generateChordProgression/algorithm';
import { applyChordProgressionToTrack } from '../../useCases/generateChordProgression/applyToTrack';

import { createGenerationHandler } from './createGenerationHandler';
import { VALID_CHORD_STYLES, VALID_VOICINGS } from './generationHandlerHelpers';

export const handleGenerateChordProgression = createGenerationHandler<'generateChordProgression'>({
    validStyles: VALID_CHORD_STYLES,
    defaultStyle: 'pop',
    labelSuffix: 'chord progression',
    trackNamePrefix: 'Chords',
    applyToTrack: (trackId, action, style, playheadBeat) => {
        const scale =
            action.payload.scale === 'major' || action.payload.scale === 'minor' ? action.payload.scale : 'major';
        const key = typeof action.payload.key === 'number' ? Math.max(0, Math.min(11, action.payload.key)) : 0;
        const voicing: ChordVoicing = VALID_VOICINGS.has(action.payload.voicing ?? '')
            ? (action.payload.voicing as ChordVoicing)
            : 'close';

        return applyChordProgressionToTrack(
            trackId,
            {
                style: style as ChordProgressionStyle,
                key,
                scale,
                bars: action.payload.bars,
                voicing,
                seed: action.payload.seed,
            },
            playheadBeat
        );
    },
});
