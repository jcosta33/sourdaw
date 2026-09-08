/**
 * The pure half of the play-start probe: turning the in-page capture
 * described in `scripts/desktopLatencyConnect.ts`'s `installPlayStartProbe`
 * into a bracketed measurement of how long the native engine took to roll
 * after the play gesture.
 *
 * `startPlayback.ts` (`src/modules/Transport/useCases/transportControls/
 * startPlayback.ts`) fires the native session start without awaiting it and
 * starts the Web Audio scheduler in the same tick, so Web Audio's first
 * grain is anchored at the gesture while the native engine rolls only after
 * several awaited IPC round trips. Nothing before this recorded how long
 * that roll actually took on the packaged app.
 *
 * Kept apart from the driver for the same reason `desktopLatencyReadings.ts`
 * is: the driver speaks CDP and drives a live `Page`, which drags Playwright
 * into any spec that imports it; this file is a total function of the
 * probe's own readings, so a spec can pin it without a packaged app.
 */

/**
 * One `engine_transport_position` poll taken during the probe window.
 * `issuedAtMs` is stamped before the awaited round trip; `answeredAtMs` after
 * it lands. Both are kept because a `playing:false` answer only proves the
 * engine was not rolling at whatever moment the *published* snapshot it
 * answered with was taken — not at either stamp. `positionSeconds` is carried
 * through to the record for information only: the play gesture also sends a
 * locate, so a delta between polls conflates seek distance with rendered
 * audio and cannot be used to tighten either bracket edge.
 */
export type PlayStartPoll = Readonly<{
    issuedAtMs: number;
    answeredAtMs: number;
    playing: boolean;
    positionSeconds: number;
}>;

/**
 * What the in-page probe installed by `installPlayStartProbe` returns.
 * `callbackPeriodMs` is the native engine's own audio-callback period —
 * `outputBufferFrames / sampleRate` in milliseconds, read once from
 * `engine_rt_diagnostics` after the poll loop closes — and is what bounds
 * how stale a `playing:false` answer can be, not the poll loop's own cadence.
 */
export type PlayStartProbe = Readonly<{
    gestureAtMs: number | null;
    callbackPeriodMs: number;
    polls: readonly PlayStartPoll[];
    /**
     * `null` on a probe that ran its loop to completion. Set to the rejection's
     * message when anything inside the in-page loop threw — an `invoke`
     * rejection, a non-object answer, or the closing diagnostics read failing —
     * so `resolvePlayStart` can report the failure as a `not-observed` outcome
     * instead of the caller ever seeing an unhandled rejection surface as an
     * app defect.
     */
    failure: string | null;
}>;

/**
 * The native roll lag is reported as a bracket, not a point, because of how
 * the engine publishes the transport snapshot each poll reads:
 * `publish_transport_position` (`crates/daw-engine/src/scheduler.rs`) writes
 * it once at the end of every audio callback, so the snapshot a poll answers
 * with can be up to one whole `callbackPeriodMs` stale by the time the poll
 * was even issued.
 *
 * That publication law is what the bracket's two edges encode:
 *
 * - A `playing:false` answer to a poll *issued* at T proves only that the
 *   engine was not rolling at the last callback boundary before T — i.e. no
 *   later than `T - callbackPeriodMs`. It says nothing about the interval
 *   between that boundary and T itself, which is why the lower edge is built
 *   from the *previous* poll's `issuedAtMs`, not the first playing poll's own
 *   timestamp.
 * - A `playing:true` answer received at T proves the roll began no later than
 *   T. `positionSeconds` is reported alongside it but not used to tighten this
 *   edge: `startNativeSessionAtBeat` sends `positionSeconds` with the play
 *   itself, and the same graph batch that flips `is_playing` also applies a
 *   `SeekFrames`, so the position delta between the last not-playing poll and
 *   the first playing one includes whatever the locate moved the playhead by,
 *   not only rendered audio — on a project whose playhead rests away from
 *   zero that delta can dwarf the render time it would otherwise stand in
 *   for.
 *
 * The true transition lies inside `[rollLagLowerMs, rollLagUpperMs]` under
 * that law. `pollIntervalMedianMs` is the poll loop's own cadence — how often
 * the harness happened to ask — and is reported only so a reader can tell the
 * *instrument's loop* apart from the *instrument's resolution*: the loop
 * cadence bears on nothing in the bracket's math, while `callbackPeriodMs`,
 * the engine's own publication period, is what actually sets how tight the
 * lower edge can be.
 */
export type PlayStartRecord =
    | Readonly<{
          rollLagLowerMs: number;
          rollLagUpperMs: number;
          positionSecondsAtFirstPlaying: number;
          callbackPeriodMs: number;
          pollCount: number;
          pollIntervalMedianMs: number;
      }>
    | Readonly<{ outcome: 'not-observed'; reason: string }>;

function median(values: readonly number[]): number {
    if (values.length === 0) {
        return 0;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Resolves the probe's raw gesture timestamp, callback period, and polls
 * into the bracket described on {@link PlayStartRecord}. `failure !== null`
 * means the in-page loop itself threw — checked first, ahead of every other
 * field, because a probe that failed mid-loop carries no trustworthy
 * `gestureAtMs` or `polls` to reason about. `gestureAtMs === null` means the
 * capture listener installed in the page never saw the click reach it; an
 * empty match among `polls` means the engine never reported `playing` inside
 * the probe's own window; a callback period that is not a positive finite
 * number means `engine_rt_diagnostics` never reported one (engine not yet
 * started) — all four are reported as `'not-observed'` rather than as a
 * bracket computed from readings that never happened or a lower edge with no
 * sound basis.
 */
export function resolvePlayStart(probe: PlayStartProbe): PlayStartRecord {
    const { gestureAtMs, callbackPeriodMs, polls, failure } = probe;
    if (failure !== null) {
        return { outcome: 'not-observed', reason: `the probe failed: ${failure}` };
    }
    if (gestureAtMs === null) {
        return { outcome: 'not-observed', reason: 'the play click never reached the capture listener' };
    }

    const firstPlayingIndex = polls.findIndex((poll) => poll.playing);
    if (firstPlayingIndex === -1) {
        return { outcome: 'not-observed', reason: 'the engine never reported playing within the probe window' };
    }

    if (!Number.isFinite(callbackPeriodMs) || callbackPeriodMs <= 0) {
        return { outcome: 'not-observed', reason: 'the engine published no callback period' };
    }

    const first = polls[firstPlayingIndex]!;
    const previous = firstPlayingIndex === 0 ? null : polls[firstPlayingIndex - 1]!;
    const consideredPolls = polls.slice(0, firstPlayingIndex + 1);
    const gaps = consideredPolls.slice(1).map((poll, index) => poll.issuedAtMs - consideredPolls[index]!.issuedAtMs);

    const rollLagLowerMs = previous === null ? 0 : Math.max(previous.issuedAtMs - callbackPeriodMs - gestureAtMs, 0);

    return {
        rollLagLowerMs,
        rollLagUpperMs: first.answeredAtMs - gestureAtMs,
        positionSecondsAtFirstPlaying: first.positionSeconds,
        callbackPeriodMs,
        pollCount: consideredPolls.length,
        pollIntervalMedianMs: median(gaps),
    };
}

/** One `reportLeg`-style line for the play-start bracket, printed alongside the rest of a run's console output. */
export function describePlayStart(record: PlayStartRecord): string {
    if ('outcome' in record) {
        return `play start: not observed — ${record.reason}`;
    }
    return (
        `play start: native roll lag ${record.rollLagLowerMs.toFixed(1)}–${record.rollLagUpperMs.toFixed(1)} ms ` +
        `(callback ${record.callbackPeriodMs.toFixed(1)} ms, poll median ${record.pollIntervalMedianMs.toFixed(1)} ms, ${String(record.pollCount)} polls), ` +
        `engine position ${record.positionSecondsAtFirstPlaying.toFixed(3)} s at first playing`
    );
}
