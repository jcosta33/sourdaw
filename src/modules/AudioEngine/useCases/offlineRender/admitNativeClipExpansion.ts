/**
 * What one clip's loop expansion may cost the native engine, decided once for
 * both producers that schedule into it (#3068).
 *
 * `projectLiveGraphProgramme` and `renderOfflineWithNativeEngine` schedule the
 * same expansion of the same clips, so a ceiling either one applies alone is a
 * clip that plays in the export and is silent in the live session, or the
 * reverse. Both ask this, on the same numbers, and word the same verdict for
 * their own reader.
 *
 * The ceiling is the strip's clip count and nothing else. Material cost used to
 * be bounded here too, because the mapper handed every `schedule-clip` its own
 * copy of the sample's PCM; the engine now shares one allocation across every
 * clip cut from a take (`TimelineClip` holds `Arc<[f32]>`), so a producer-side
 * byte budget would refuse arrangements that no longer cost anything.
 */

/**
 * How many clips one native track strip holds — `MAX_TRACK_CLIPS` in
 * `crates/daw-engine/src/timeline.rs`, mirrored because a producer's job is to
 * emit a batch the engine takes.
 *
 * The engine's own answer to the 1025th is to refuse the command, and a refusal
 * is whole-batch. One clip's loop expansion can reach four thousand iterations
 * on its own (`projectClipLoopExpansion`'s ceiling), so this is not a
 * theoretical bound: a single over-long loop would otherwise cost the batch
 * every strip in it.
 */
export const MAX_NATIVE_TRACK_CLIPS = 1024;

export type NativeClipExpansionInput = Readonly<{
    /** How many `schedule-clip` commands the expansion would emit. */
    iterations: number;
    /** Slots the strip has left of {@link MAX_NATIVE_TRACK_CLIPS}. */
    remainingClipSlots: number;
}>;

export type NativeClipExpansionVerdict =
    | Readonly<{ admitted: true }>
    /** Why the clip is dropped, as a clause naming the clip's own numbers. */
    | Readonly<{ admitted: false; reason: string }>;

/**
 * Whether a strip may take this clip's whole expansion.
 *
 * Whole is the point: a `schedule-clip` the engine refuses takes the entire
 * batch with it, and a clip admitted half-way is a clip that stops sounding
 * part-way through with nothing saying why. The verdict is therefore decided
 * before any of the clip's iterations are emitted.
 */
export function admitNativeClipExpansion(input: NativeClipExpansionInput): NativeClipExpansionVerdict {
    const { iterations, remainingClipSlots } = input;

    if (iterations > remainingClipSlots) {
        return {
            admitted: false,
            reason:
                `its expansion needs ${String(iterations)} of the ${String(remainingClipSlots)} ` +
                `native clip slots the strip has left`,
        };
    }

    return { admitted: true };
}
