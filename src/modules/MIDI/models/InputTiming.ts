/**
 * Longest wait still credible as main-thread scheduling delay.
 *
 * A conforming `MIDIMessageEvent.timeStamp` shares the `performance.now()`
 * origin, so the gap between it and the moment a handler runs is only the time
 * the event spent waiting for a turn — milliseconds, even under load. A larger
 * gap means the source is stamping on some other epoch; trusting it would place
 * the note far in the past and corrupt the recorded note length, so such a
 * timestamp is refused outright rather than half-believed.
 *
 * Two places depend on this number and must agree. `resolveInputEventTime`
 * enforces it. The native bridge maps midir's foreign epoch onto ours and uses
 * the same bound to decide its anchor has gone stale — so a mapped stamp is
 * never one the guard would silently reject, which would restore the very
 * fallback the mapping exists to replace.
 */
export const MAX_CREDIBLE_INPUT_WAIT_SECONDS = 1;
