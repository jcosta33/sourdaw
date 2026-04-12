import { type AppAction } from '#/modules/Command/models/AppAction';
import { createHandler } from '#/utils/createHandler';
import { addTrack, getTrackStoreState } from '#/modules/Arrangement/useCases';
import { getPlayheadBeat, resolveOrCreateMidiTrack } from './generationHandlerHelpers';

type GenerationActionType = 'generateMelody' | 'generateChordProgression' | 'generateDrumPattern';

/** The payload fields shared by all three generation actions. */
type CommonGenerationPayload = { style: string; trackId?: string };

type GenerationHandlerConfig<K extends GenerationActionType> = {
    /** The set of valid style values for this generation type. */
    validStyles: ReadonlySet<string>;
    /** The default style when the payload style is not in validStyles. */
    defaultStyle: string;
    /** Label suffix for the describe function, e.g. "melody", "chord progression". */
    labelSuffix: string;
    /** Track name prefix, e.g. "Melody", "Chords", "Drums". */
    trackNamePrefix: string;
    /** Build the options object and call the apply function. */
    applyToTrack: (trackId: string, action: Extract<AppAction, { type: K }>, style: string, playheadBeat: number) => void;
};

export function createGenerationHandler<K extends GenerationActionType>(config: GenerationHandlerConfig<K>) {
    return createHandler<K>({
        execute: (a) => {
            const payload = (a as unknown as { payload: CommonGenerationPayload }).payload;
            const style = config.validStyles.has(payload.style)
                ? payload.style
                : config.defaultStyle;

            const trackId = resolveOrCreateMidiTrack(payload.trackId, `${config.trackNamePrefix} (${style})`, {
                getTrackStoreState,
                addTrack,
            });
            if (!trackId) {
                return;
            }

            config.applyToTrack(trackId, a as Extract<AppAction, { type: K }>, style, getPlayheadBeat());
        },
        describe: (a) => ({ label: `Generate ${(a as unknown as { payload: CommonGenerationPayload }).payload.style} ${config.labelSuffix}` }),
        undoable: true,
    });
}
