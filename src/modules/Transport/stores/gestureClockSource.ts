/**
 * The audio-clock reads `captureGestureBeat` needs from the AudioEngine.
 *
 * Transport's stores must stay leaf modules, but an event-time capture has to
 * read the live AudioContext clock at the event and prefer the native engine's
 * cursor while that engine is the audible transport. Those reads are injected
 * once at app init (`src/app/bootstrap.ts`) — the same seam shape
 * `setAutomationRecordingDependencies` uses to break the AudioEngine cycle.
 *
 * Reading before registration throws: production registers before any gesture
 * can arrive, and a silent fallback to the scheduler's last anchor would stamp
 * gestures without the event-time projection or the native cursor.
 */
export type GestureClockSource = {
    /** Live `AudioContext.currentTime`, read at the event's own instant. */
    getAudioTimeSeconds: () => number;
    /** The native engine's playhead in beats, or null when it is not the audible transport. */
    readNativeCursorBeats: () => number | null;
};

let registeredSource: GestureClockSource | null = null;

export function setGestureClockSource(next: GestureClockSource): void {
    registeredSource = next;
}

/** The registered clock reads. */
export function getGestureClockSource(caller: string): GestureClockSource {
    if (registeredSource === null) {
        throw new Error(
            `${caller}: the gesture clock source is not registered; call setGestureClockSource() from #/app/bootstrap (bootstrap does this)`
        );
    }
    return registeredSource;
}
