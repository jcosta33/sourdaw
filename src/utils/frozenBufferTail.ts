/**
 * How much decay a frozen buffer carries past its clip content.
 *
 * The rule, stated once because it was previously assumed differently at each
 * call site: **an absent, non-finite or negative `tailLengthSeconds` means
 * unknown, not zero, and unknown must never resolve to zero reserved time.**
 *
 * The field is optional on `FreezeState` and the project validators accept a
 * frozen track without it (`isFreezeState` returns true for
 * `renderSettings === undefined`, and neither validator checks the sign), so
 * every consumer must handle the unknown case. Resolving it to `0` reserves no
 * room for a buffer that still decays, which truncates real audio — in the
 * export path by shortening the render, and in Flatten by baking a short clip
 * permanently into the timeline.
 *
 * Consumers must not re-derive this. Two of them already disagreed.
 */

/**
 * Beats of tail the **pre-declaration** freeze mechanism rendered past a track's
 * content: 8 for a chain whose device type contained "reverb" or "delay", 4 for
 * anything else.
 *
 * Freeze no longer works this way — it reserves the seconds its devices declare
 * — so these are not current behaviour. They are kept, and named for what they
 * are, because they describe the buffers already on disk: a frozen track whose
 * `tailLengthSeconds` is missing can only have been written by that mechanism,
 * since the current one always records the figure it rendered. They are the
 * derivation of `UNKNOWN_FROZEN_TAIL_SECONDS` and nothing else.
 */
export const LEGACY_FREEZE_MAX_TAIL_BEATS = 8;
export const LEGACY_FREEZE_MIN_TAIL_BEATS = 4;

/**
 * What freeze bakes into a buffer, as a version number.
 *
 * Correcting freeze's arithmetic does nothing for buffers already rendered:
 * they stay physically short, and they stay printed with their own fader and pan
 * position folded in. No export-side change can recover either — the samples
 * were never rendered, and a doubled gain cannot be unmixed. The only remedy is
 * to render again, so a buffer that predates the current rules has to be *told*
 * it is out of date rather than silently trusted.
 *
 * Bump this whenever the content of a frozen buffer changes meaning. Staleness
 * detection marks any frozen track carrying an older version `stale`, which is
 * the state the UI already offers a re-freeze from — so the migration is the
 * existing re-freeze affordance, not a new one.
 *
 * Version 1 is the first that (a) sizes its tail from device tail declarations
 * rather than a device-name substring test and (b) prints at unity fader and
 * centre pan. Absent means version 0: everything written before either rule.
 */
export const FREEZE_BAKE_VERSION = 1;

/**
 * Floor for an unknown baked tail, in seconds.
 *
 * Derived from what can actually have been baked, not from a plausible-looking
 * constant. An absent `tailLengthSeconds` means the buffer predates freeze
 * recording one, so the mechanism that wrote it is the legacy one:
 * `LEGACY_FREEZE_MAX_TAIL_BEATS` (8) beats past the content, and beats convert
 * to seconds by the project tempo, so the longest such tail is at the slowest
 * legal tempo: 8 beats * 60 / MIN_TEMPO (20 BPM) = 24 s.
 *
 * Being an upper bound is the whole point. The floor exists to stop an unknown
 * tail truncating a buffer, and a floor smaller than what the buffer can hold
 * would truncate it again — irrecoverably, in Flatten's case, since that bakes
 * the shortened clip into the timeline. A previous value of 10 s claimed this
 * property while lacking it: it was anchored to `AUTO_TAIL_SECONDS`, which
 * belongs to the *bounce* path and which freeze never calls, and any project
 * under 48 BPM already exceeds it.
 *
 * The cost of the upper bound is trailing silence at ordinary tempos, which is
 * recoverable; the cost of being short is deleted audio, which is not.
 *
 * `frozenTailAnchor.spec.ts` pins this against the real constants, so changing
 * either mechanism fails a test rather than silently invalidating this number.
 */
export const UNKNOWN_FROZEN_TAIL_SECONDS = 24;

type FrozenRenderSettingsLike = { tailLengthSeconds?: number } | undefined;

export type FrozenBufferTail =
    /** The buffer recorded what it baked. */
    | { known: true; seconds: number }
    /**
     * Nothing usable was recorded. `atLeastSeconds` is a floor, not an estimate:
     * a caller with a better proxy (the frozen track's device chain, say) should
     * take the larger of the two, never the smaller, and never zero.
     */
    | { known: false; atLeastSeconds: number };

export function resolveFrozenBufferTail(renderSettings: FrozenRenderSettingsLike): FrozenBufferTail {
    const recorded = renderSettings?.tailLengthSeconds;

    // A negative tail is exactly as meaningless as a missing or NaN one, and
    // both validators pass it through: `hasType`/`is_finite_number` check
    // finiteness, never sign. Route it to unknown rather than laundering it to
    // a trusted zero.
    if (typeof recorded === 'number' && Number.isFinite(recorded) && recorded >= 0) {
        return { known: true, seconds: recorded };
    }

    return { known: false, atLeastSeconds: UNKNOWN_FROZEN_TAIL_SECONDS };
}
