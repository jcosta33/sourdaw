import { addTrack, getTrackStoreState } from '#/modules/Arrangement/useCases';
import { selectClipWithFocus } from '#/modules/Workspace/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { getPlayheadBeat, resolveOrCreateMidiTrack } from './generationHandlerHelpers';

type GenerationActionType = 'generateMelody' | 'generateChordProgression' | 'generateDrumPattern';

/** The payload fields shared by all three generation actions. */
type CommonGenerationPayload = { style: string; trackId?: string; startBeat?: number };

/** What the apply function reports back so the handler can surface feedback. */
type ApplyResult = { clipId: string; noteCount: number } | null | void;

type GenerationHandlerConfig<ActionType extends GenerationActionType> = {
    /** The set of valid style values for this generation type. */
    validStyles: ReadonlySet<string>;
    /** The default style when the payload style is not in validStyles. */
    defaultStyle: string;
    /** Label suffix for the describe function, e.g. "melody", "chord progression". */
    labelSuffix: string;
    /** Track name prefix, e.g. "Melody", "Chords", "Drums". */
    trackNamePrefix: string;
    /**
     * Build the options object and call the apply function. Returning a
     * `{ clipId, noteCount }` lets the handler focus the new clip and notify
     * the user; returning `null`/`void` suppresses the success notification
     * (the underlying apply already logged the failure).
     */
    applyToTrack: (
        trackId: string,
        action: Extract<AppAction, { type: ActionType }>,
        style: string,
        playheadBeat: number
    ) => ApplyResult;
};

export function createGenerationHandler<ActionType extends GenerationActionType>(
    config: GenerationHandlerConfig<ActionType>
) {
    return createHandler<ActionType>({
        execute: (alpha) => {
            // alpha is the specific action union member; cast to shared payload shape for uniform handling
            const payload = (alpha as { payload: CommonGenerationPayload }).payload;
            const style = config.validStyles.has(payload.style) ? payload.style : config.defaultStyle;

            const trackId = resolveOrCreateMidiTrack(payload.trackId, `${config.trackNamePrefix} (${style})`, {
                getTrackStoreState,
                addTrack,
            });
            if (!trackId) {
                notifyUser(`Could not generate ${style} ${config.labelSuffix} — no MIDI track available`, 'error');
                return;
            }

            // §14.3 / G5 — honour a `startBeat` override so right-click →
            // "Generate here" actually places the clip where the user clicked.
            // When no override is given (top bar / palette), fall back to the
            // transport playhead as before.
            const placementBeat =
                typeof payload.startBeat === 'number' && Number.isFinite(payload.startBeat)
                    ? Math.max(0, payload.startBeat)
                    : getPlayheadBeat();

            const result = config.applyToTrack(
                trackId,
                alpha as Extract<AppAction, { type: ActionType }>,
                style,
                placementBeat
            );
            // §14.3 / G3 — after a successful generation, focus the new clip
            // (so the inspector/piano-roll surfaces see it) and surface a
            // notification. An empty-note result is still "success" in the
            // sense that the clip was created, but we warn the user so they
            // don't assume the generator is broken.
            if (result && typeof result === 'object' && 'clipId' in result) {
                selectClipWithFocus(result.clipId);
                if (result.noteCount === 0) {
                    notifyUser(
                        `Generated ${style} ${config.labelSuffix}, but the algorithm produced no notes — try a higher density`,
                        'warning'
                    );
                } else {
                    notifyUser(`Generated ${style} ${config.labelSuffix} (${result.noteCount} notes)`, 'success');
                }
            }
        },
        describe: (alpha) => ({
            // alpha is the specific action union member; cast to shared payload shape for uniform handling
            label: `Generate ${(alpha as { payload: CommonGenerationPayload }).payload.style} ${config.labelSuffix}`,
        }),
        undoable: true,
    });
}
