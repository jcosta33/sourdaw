import { addTrack, getTrackStoreState, selectClipWithFocus } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type GeneratedMidiStateGuard, type HandlerDescribeResult } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { generateSeed } from '#/utils/SeededRandom/SeededRandom';

import { populateGeneratedMidiStateGuard } from '../aiMidi/populateGeneratedMidiStateGuard';

import { getPlayheadBeat, resolveGenerationTrackPlan, resolveOrCreateMidiTrack } from './generationHandlerHelpers';

type GenerationActionType = 'generateMelody' | 'generateChordProgression' | 'generateDrumPattern';

/** The payload fields shared by all three generation actions. */
type CommonGenerationPayload = { style: string; trackId?: string; startBeat?: number; seed?: number };

/** What the apply function reports back so the handler can surface feedback. */
type ApplyResult = { clipId: string; noteCount: number } | null | void;

/**
 * #4615 — `executeAppAction` calls `describe()` BEFORE `execute()` to capture
 * the undo entry, so the inverse payloads are minted up front in a per-action
 * WeakMap and filled in place by the write — the same pattern `fillPlacement`
 * and `handleGenerateBassline` use. The recorded entry holds the payload by
 * reference, which is what makes its `discardCreatedTrack` /
 * `discardDuplicatedClip` inverse carry the real ids and the generated-MIDI
 * state guard once the write lands.
 */
type GenerationUndoState = {
    trackInverse: { trackId: string; generatedMidiStateGuard: GeneratedMidiStateGuard };
    clipInverse: { clipId: string; generatedMidiStateGuard: GeneratedMidiStateGuard };
};

const generationUndoStates = new WeakMap<object, GenerationUndoState>();

function ensureGenerationUndoState(action: object): GenerationUndoState {
    const existing = generationUndoStates.get(action);
    if (existing) {
        return existing;
    }
    const state: GenerationUndoState = {
        trackInverse: { trackId: '', generatedMidiStateGuard: { entityJson: '', midiByClipIdJson: '' } },
        clipInverse: { clipId: '', generatedMidiStateGuard: { entityJson: '', midiByClipIdJson: '' } },
    };
    generationUndoStates.set(action, state);
    return state;
}

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

            // Read-only preview of the exact track decision below, taken before
            // it can create a track: the inverse kind depends on whether
            // creation happens.
            const plan = resolveGenerationTrackPlan(payload.trackId, { getTrackStoreState });
            const trackId = resolveOrCreateMidiTrack(payload.trackId, `${config.trackNamePrefix} (${style})`, {
                getTrackStoreState,
                addTrack,
            });
            if (!trackId) {
                notifyUser(`Could not generate ${style} ${config.labelSuffix} — no MIDI track available`, 'error');
                return { status: 'no-write' };
            }

            // §14.3 / G5 — honour a `startBeat` override so right-click →
            // "Generate here" actually places the clip where the user clicked.
            // When no override is given (top bar / palette), fall back to the
            // transport playhead as before.
            const placementBeat =
                typeof payload.startBeat === 'number' && Number.isFinite(payload.startBeat)
                    ? Math.max(0, payload.startBeat)
                    : getPlayheadBeat();

            const result = config.applyToTrack(trackId, alpha, style, placementBeat);
            if (!(result && typeof result === 'object' && 'clipId' in result)) {
                // The underlying apply already logged the failure; nothing was
                // written, so record no undo entry rather than an inverse-less
                // one (#4615).
                return { status: 'no-write' };
            }

            // Fill the inverse describe returned: the guards must capture the
            // written state, never the state before it.
            const state = ensureGenerationUndoState(alpha);
            if (plan.kind === 'create') {
                state.trackInverse.trackId = trackId;
                const guardedTrack = getTrackStoreState()?.tracks.find((track) => track.id === trackId);
                if (guardedTrack) {
                    populateGeneratedMidiStateGuard({
                        guard: state.trackInverse.generatedMidiStateGuard,
                        entity: guardedTrack,
                        clipIds: [result.clipId],
                    });
                }
            } else {
                state.clipInverse.clipId = result.clipId;
                const guardedClip = getTrackStoreState()
                    ?.tracks.flatMap((track) => track.clips)
                    .find((clip) => clip.id === result.clipId);
                if (guardedClip) {
                    populateGeneratedMidiStateGuard({
                        guard: state.clipInverse.generatedMidiStateGuard,
                        entity: guardedClip,
                        clipIds: [result.clipId],
                    });
                }
            }

            // §14.3 / G3 — after a successful generation, focus the new clip
            // (so the inspector/piano-roll surfaces see it) and surface a
            // notification. An empty-note result is still "success" in the
            // sense that the clip was created, but we warn the user so they
            // don't assume the generator is broken.
            selectClipWithFocus(result.clipId);
            if (result.noteCount === 0) {
                notifyUser(
                    `Generated ${style} ${config.labelSuffix}, but the algorithm produced no notes — try a higher density`,
                    'warning'
                );
            } else {
                notifyUser(`Generated ${style} ${config.labelSuffix} (${result.noteCount} notes)`, 'success');
            }
            return { status: 'written' };
        },
        describe: (alpha) => {
            // alpha is the specific action union member; cast to shared payload shape for uniform handling
            const payload = (alpha as { payload: CommonGenerationPayload }).payload;
            // Minting the seed here makes the envelope's materializeSeed see
            // `payload.seed !== undefined` and skip its structuredClone, so
            // execute receives this same action object and the WeakMap inverse
            // payloads fill in place (same pattern as prepareHumanizeNotes).
            if (payload.seed === undefined) {
                payload.seed = generateSeed();
            }
            const label = `Generate ${payload.style} ${config.labelSuffix}`;
            const state = ensureGenerationUndoState(alpha);
            const plan = resolveGenerationTrackPlan(payload.trackId, { getTrackStoreState });
            let inverseAction: HandlerDescribeResult['inverseAction'];
            if (plan.kind === 'create') {
                inverseAction = { type: 'discardCreatedTrack', payload: state.trackInverse };
            } else {
                inverseAction = { type: 'discardDuplicatedClip', payload: state.clipInverse };
            }
            return { label, inverseAction };
        },
        undoable: true,
    });
}
