/**
 * The audio-clock reads `captureGestureBeat` needs from the AudioEngine.
 *
 * Transport's stores must stay leaf modules, but an event-time capture has to
 * read the live AudioContext clock at the event and prefer the native engine's
 * cursor while that engine is the audible transport. Those reads are injected
 * once at app init (`src/app/bootstrap.ts`) — the same seam shape
 * `setAutomationRecordingDependencies` uses to break the AudioEngine cycle.
 *
 * Unregistered (a spec or tool that never ran the bootstrap), the capture
 * degrades to the scheduler's last committed anchor beat: still a moving,
 * tick-fresh position, just without the sub-grain event-time projection and the
 * native cursor. Production always registers before any gesture can arrive.
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

/** The registered clock reads, or null outside an initialized app. */
export function getGestureClockSource(): GestureClockSource | null {
    return source;
}
