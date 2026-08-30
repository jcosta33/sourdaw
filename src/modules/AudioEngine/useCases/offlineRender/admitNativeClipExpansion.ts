/**
 * What one clip's loop expansion may cost the native engine, decided once for
 * both producers that schedule into it (#3068).
 *
 * `projectLiveGraphProgramme` and `renderOfflineWithNativeEngine` schedule the
 * same expansion of the same clips, so a ceiling either one applies alone is a
 * clip that plays in the export and is silent in the live session, or the
 * reverse. Both ask this, on the same numbers, and word the same verdict for
 * their own reader.
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

/**
 * How much material one clip's loop expansion may allocate natively.
 *
 * Every `schedule-clip` copies the sample's *whole* PCM into the engine — the
 * mapper hands `TimelineClip::new` a `sample.left.clone()`
 * (`crates/sourdaw-native/src/commands/graph.rs`), and `TimelineClip` owns
 * `Vec<f32>` rather than sharing the pool's — so an expansion multiplies its
 * material instead of referencing it. Referencing it is the engine-side fix and
 * it is filed as #3134; until that lands, the producers are the only thing
 * between one looped clip and an unbounded native allocation.
 *
 * The arithmetic this admits and refuses, at 48 kHz stereo float:
 *
 *   - a one-bar loop at 120 BPM (2 s, 0.73 MiB) dragged across a four-minute
 *     arrangement — 120 iterations, 88 MiB — is ordinary arranging and passes;
 *   - a single four-minute take is 88 MiB of one copy and passes;
 *   - the loop projector's own 4096-iteration ceiling over that same one-bar
 *     loop is 3 GiB and is refused, as is any multi-minute clip looped anywhere
 *     near it.
 *
 * 256 MiB sits above the first two with room and three orders of magnitude
 * below the last. It bounds one clip, not a project: a session with many looped
 * clips still allocates the sum of them. That is deliberate — a project-wide
 * ceiling would make which clips play depend on the order they are walked in,
 * and the real ceiling belongs to the engine.
 */
export const MAX_NATIVE_CLIP_MATERIAL_BYTES = 256 * 1024 * 1024;

/** The native sample holds a left and a right channel, and clones those. */
const MAX_NATIVE_SAMPLE_CHANNELS = 2;

const BYTES_PER_NATIVE_SAMPLE = 4;

export type NativeClipExpansionInput = Readonly<{
    /** How many `schedule-clip` commands the expansion would emit. */
    iterations: number;
    /** The material each of them copies. */
    buffer: Pick<AudioBuffer, 'length' | 'numberOfChannels'>;
    /** Slots the strip has left of {@link MAX_NATIVE_TRACK_CLIPS}. */
    remainingClipSlots: number;
}>;

export type NativeClipExpansionVerdict =
    | Readonly<{ admitted: true }>
    /** Why the clip is dropped, as a clause naming the clip's own numbers. */
    | Readonly<{ admitted: false; reason: string }>;

function mebibytes(bytes: number): string {
    return `${String(Math.round(bytes / (1024 * 1024)))} MiB`;
}

/**
 * Whether a strip may take this clip's whole expansion.
 *
 * Whole is the point: a `schedule-clip` the engine refuses takes the entire
 * batch with it, and a clip admitted half-way is a clip that stops sounding
 * part-way through with nothing saying why. Both verdicts are therefore decided
 * before any of the clip's iterations are emitted.
 */
export function admitNativeClipExpansion(input: NativeClipExpansionInput): NativeClipExpansionVerdict {
    const { iterations, buffer, remainingClipSlots } = input;

    if (iterations > remainingClipSlots) {
        return {
            admitted: false,
            reason:
                `its expansion needs ${String(iterations)} of the ${String(remainingClipSlots)} ` +
                `native clip slots the strip has left`,
        };
    }

    const materialBytes =
        iterations *
        buffer.length *
        Math.min(buffer.numberOfChannels, MAX_NATIVE_SAMPLE_CHANNELS) *
        BYTES_PER_NATIVE_SAMPLE;
    // One iteration is what the clip costs to sound at all — the engine holds
    // that copy whether or not anything loops — so the budget bounds only what
    // the expansion multiplies. Refusing a long single take would remove sound
    // the project asks for and save nothing #3134 causes.
    if (iterations > 1 && materialBytes > MAX_NATIVE_CLIP_MATERIAL_BYTES) {
        return {
            admitted: false,
            reason:
                `its ${String(iterations)} loop iterations allocate ${mebibytes(materialBytes)} of material, ` +
                `past the ${mebibytes(MAX_NATIVE_CLIP_MATERIAL_BYTES)} one clip may cost the native timeline`,
        };
    }

    return { admitted: true };
}
