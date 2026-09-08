/**
 * The pure half of the play-start probe: turning the in-page capture
 * described in `scripts/desktopLatencyConnect.ts`'s `armPlayStartProbe` into
 * a bracketed measurement of how long the native engine took to roll after
 * the play gesture.
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

/** One `engine_transport_position` poll taken during the probe window. */
export type PlayStartPoll = Readonly<{ atMs: number; playing: boolean; positionSeconds: number }>;

/** What the in-page probe installed by `armPlayStartProbe` returns. */
export type PlayStartProbe = Readonly<{ gestureAtMs: number | null; polls: readonly PlayStartPoll[] }>;

/**
 * The native roll lag is reported as a bracket, not a point: the poll loop
 * only proves the engine was not yet playing at the last poll before the
 * first one that caught it playing, and was playing by that one. The true
 * transition happened somewhere inside that interval. `pollIntervalMedianMs`
 * carries the interval's own width so a reader can tell the instrument's
 * resolution apart from the thing it measured — a wide bracket on a run with
 * a large median is the poll cadence, not a slow roll.
 */
export type PlayStartRecord =
    | Readonly<{
          rollLagLowerMs: number;
          rollLagUpperMs: number;
          positionSecondsAtFirstPlaying: number;
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
 * Resolves the probe's raw gesture timestamp and polls into the bracket
 * described on {@link PlayStartRecord}. `gestureAtMs === null` means the
 * capture listener installed in the page never saw the click reach it, and
 * an empty match among `polls` means the engine never reported `playing`
 * inside the probe's own window — both are reported as `'not-observed'`
 * rather than as a bracket computed from readings that never happened.
 */
export function resolvePlayStart(probe: PlayStartProbe): PlayStartRecord {
    const { gestureAtMs, polls } = probe;
    if (gestureAtMs === null) {
        return { outcome: 'not-observed', reason: 'the play click never reached the capture listener' };
    }

    const firstPlayingIndex = polls.findIndex((poll) => poll.playing);
    if (firstPlayingIndex === -1) {
        return { outcome: 'not-observed', reason: 'the engine never reported playing within the probe window' };
    }

    const firstPlaying = polls[firstPlayingIndex]!;
    const lastBeforePlaying = firstPlayingIndex === 0 ? gestureAtMs : polls[firstPlayingIndex - 1]!.atMs;
    const consideredPolls = polls.slice(0, firstPlayingIndex + 1);
    const gaps = consideredPolls.slice(1).map((poll, index) => poll.atMs - consideredPolls[index]!.atMs);

    return {
        rollLagLowerMs: Math.max(lastBeforePlaying - gestureAtMs, 0),
        rollLagUpperMs: firstPlaying.atMs - gestureAtMs,
        positionSecondsAtFirstPlaying: firstPlaying.positionSeconds,
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
        `(poll median ${record.pollIntervalMedianMs.toFixed(1)} ms, ${String(record.pollCount)} polls), ` +
        `engine position ${record.positionSecondsAtFirstPlaying.toFixed(3)} s at first playing`
    );
}
