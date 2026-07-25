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
 * Floor for an unknown baked tail, in seconds.
 *
 * Anchored to `AUTO_TAIL_SECONDS` in `freezeBounce/renderOffline.ts`: it is what
 * freeze itself reserves when it has no better answer, so it is the most
 * defensible "we do not know" number available, and it is an upper bound on
 * what the freeze path can have baked in that situation.
 */
export const UNKNOWN_FROZEN_TAIL_SECONDS = 10;

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
