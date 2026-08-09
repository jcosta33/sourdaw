/**
 * Recording session state for automation recording.
 * This state is internal to the recording subsystem — not reusable elsewhere.
 *
 * The mutable session collections (active sessions, buffered points, touch
 * flags) are grouped under a single `sessionState` holder that is the one source
 * of truth. The collections are exported as bindings onto that holder and are
 * mutated in place by the recording use-cases; the holder is never reseated, so
 * there is no second view of the state that could drift from these bindings.
 * Specs that need isolation `vi.mock` this module (or clear the collections in
 * `beforeEach`); they never reseat the holder.
 */

import { type AutomationPoint } from '../../models/Automation';
// Automation-local enum (AGENTS.md §95 — model isolation). Mirrors Arrangement's AutomationMode.
type AutomationMode = 'read' | 'write' | 'touch' | 'latch' | 'off';

export type RecordingSession = {
    parameterId: string;
    trackId: string;
    startBeat: number;
    lastValue: number | null;
    /**
     * Tempo (BPM) captured when the session first records a value. Reused for
     * every subsequent value so a mid-session tempo change does not silently
     * re-time the already-recorded beats. Absent/`null` until the first value
     * lands (older sessions seeded before this field omit it entirely).
     */
    tempoAtStart?: number | null;
    /**
     * The raw playhead beat of the previous recorded value — the transport's own
     * position, before latency compensation. Compared against the next one to
     * spot a loop wrap: forward playback only ever moves this forward, so a
     * decrease is the playhead having jumped back, which ends the current pass.
     * The *raw* position is used deliberately; the compensated beat shifts with
     * PDC and would make a delay recomputation look like a wrap.
     * Absent/`null` until the first value lands.
     */
    lastRawBeat?: number | null;
};

export const RECORDING_MODES: ReadonlySet<AutomationMode> = new Set(['write', 'touch', 'latch']);

/** The mutable per-session recording state, grouped under the single holder. */
type RecordingSessionState = {
    /** Active recording sessions keyed by `makeKey(trackId, parameterId)`. */
    activeRecording: Map<string, RecordingSession>;
    /** Points buffered during a session, flushed to the store on release/stop. */
    pendingPoints: Map<string, AutomationPoint[]>;
    /** Keys whose parameter is currently being touched (touch/latch arm). */
    touchActive: Set<string>;
    /**
     * Each touched lane's points as they stood *before* this session's first
     * write to it, keyed by lane id. The undo entry built at stop has to diff
     * against this, not against a stop-time snapshot: a touch release flushes
     * into the lane mid-session, so by stop the store already contains the pass
     * and a stop-time "before" would produce an empty diff and no undo entry.
     */
    laneBaselines: Map<string, AutomationPoint[]>;
};

function createRecordingSessionState(): RecordingSessionState {
    return {
        activeRecording: new Map<string, RecordingSession>(),
        pendingPoints: new Map<string, AutomationPoint[]>(),
        touchActive: new Set<string>(),
        laneBaselines: new Map<string, AutomationPoint[]>(),
    };
}

// The single source of truth for recording-session state. Holder identity is
// fixed for the module's lifetime; the collections below are mutated in place,
// never reseated, so every consumer observes the same Map/Set.
const sessionState: RecordingSessionState = createRecordingSessionState();

// Named bindings onto the single holder — the canonical collections the
// recording use-cases mutate directly (`.clear()`/`.set()`/`.get()`/`.add()`).
export const activeRecording = sessionState.activeRecording;
export const pendingPoints = sessionState.pendingPoints;
export const touchActive = sessionState.touchActive;
export const laneBaselines = sessionState.laneBaselines;
