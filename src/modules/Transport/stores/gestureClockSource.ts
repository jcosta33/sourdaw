/**
 * The audio-clock reads `captureGestureBeat` needs from the AudioEngine.
 *
 * Transport's stores must stay leaf modules, but an event-time capture has to
 * read the live AudioContext clock at the event and prefer the native engine's
 * cursor while that engine is the audible transport. Those reads are injected
 * once at app init (`configureDeviceControlDependencies()` in
 * `src/app/bootstrap.ts`) — the same seam shape `setAutomationRecordingDependencies`
 * uses to break the AudioEngine cycle.
 *
 * Reading it before that registrar has run throws: a capture that fell back to
 * the scheduler's last anchor would date a gesture at a stale beat with no report.
 */
export type GestureClockSource = {
    /** Live `AudioContext.currentTime`, read at the event's own instant. */
    getAudioTimeSeconds: () => number;
    /** The native engine's playhead in beats, or null when it is not the audible transport. */
    readNativeCursorBeats: () => number | null;
};

let source: GestureClockSource | null = null;

export function setGestureClockSource(next: GestureClockSource): void {
    source = next;
}

/** The registered clock reads; throws while nothing is registered. */
export function getGestureClockSource(): GestureClockSource {
    if (source === null) {
        throw new Error(
            'getGestureClockSource: no gesture clock source is registered; call setGestureClockSource() from configureDeviceControlDependencies() in src/app/bootstrap.ts'
        );
    }
    return source;
}
