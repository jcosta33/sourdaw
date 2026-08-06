import { getGoverningTempoChange, getTempoAtBeat, type TempoChange } from '../../models/TempoMap';
import { MIN_TEMPO_MAP_TEMPO, MAX_TEMPO_MAP_TEMPO } from '../../stores/tempoMapStore';

/** Range of the transport's own base tempo, mirroring `transportStore`'s validator. */
const MIN_BASE_TEMPO = 20;
const MAX_BASE_TEMPO = 300;

type ResolveTempoFieldStateInput = {
    changes: readonly TempoChange[];
    /**
     * The playhead beat the field is reading out. Callers must pass the *live*
     * beat during playback — `transportStore.playheadPosition` is written only on
     * start, pause, stop and seek, so during playback it still holds the beat
     * playback began at and the readout would name the wrong event.
     */
    beat: number;
    defaultTempo: number;
    /**
     * False before `transportStore` has hydrated. `useStore(transportStore,
     * defaultTransportState)` substitutes defaults, so without this the field
     * renders editable at 120 while `getTempoWriteTarget` resolves `null` and any
     * drag disappears as a silent `no-write`.
     */
    hasTransportState: boolean;
};

/**
 * Why the transport tempo field cannot be edited right now, or `null` when it can.
 *
 * - `no-transport-state` — `transportStore` has not hydrated, so there is
 *   nothing to resolve a write against. `getTempoWriteTarget` returns `null`
 *   here before it ever looks at the map, which is why this outranks a ramp.
 * - `tempo-ramp` — the playhead sits strictly *inside* a `linear` ramp, so the
 *   tempo in force is interpolated between two events and is not any event's own
 *   value. No single BPM written to one event reproduces it. The ramp event's
 *   own beat is not this case: there the interpolation factor is 0 and the
 *   readout is the event's own tempo.
 *
 * Playback is deliberately *not* a lock reason. The write path already resolves
 * from the live `playheadPositionRef`, and Cubase, Logic and Studio One all keep
 * the field live while the transport runs.
 */
type TempoFieldLockReason = 'no-transport-state' | 'tempo-ramp';

type ResolveTempoFieldStateOutput = {
    /** Tempo in force at `beat` — the map's value when a map exists, else the base tempo. */
    tempo: number;
    /** True when a tempo-map event, not the base tempo, governs the playhead. */
    governedByMap: boolean;
    editable: boolean;
    lockReason: TempoFieldLockReason | null;
    /**
     * The tempo-map event `tempo` was read from, or `null` when the base tempo
     * governs. The caller pins its write to this id so the value lands on the
     * event it was displayed against: a bare `setTempo` re-resolves its target at
     * execute time, which under `commitMode="release"` is seconds after the drag
     * began, and a seek, a collaborator or an AI `seekPlayhead` in between moves
     * the write to a different event.
     */
    tempoChangeId: string | null;
    /**
     * Bounds the field must clamp to. They follow the *destination*: a tempo-map
     * change legally holds up to 999 BPM, so clamping the control at the base
     * tempo's 300 would silently narrow a stored 400 BPM event on the first pixel
     * of a drag.
     */
    minTempo: number;
    maxTempo: number;
};

/**
 * Everything the transport tempo field needs to render and gate itself.
 *
 * Takes the already-subscribed store values rather than reading stores, so the
 * result stays a visible function of reactive inputs instead of a zero-argument
 * call the React Compiler may cache across renders. The store-reading sibling
 * used by the command layer is `getTempoWriteTarget`; the two resolve the same
 * governing event from the same shared scan, so the value on screen and the
 * value a write lands on cannot disagree.
 */
export function resolveTempoFieldState(input: ResolveTempoFieldStateInput): ResolveTempoFieldStateOutput {
    const governing = getGoverningTempoChange(input.changes, input.beat);
    const tempo = getTempoAtBeat(input.changes, input.beat, input.defaultTempo);
    const governedByMap = governing !== undefined;

    let minTempo = MIN_BASE_TEMPO;
    let maxTempo = MAX_BASE_TEMPO;
    if (governedByMap) {
        minTempo = MIN_TEMPO_MAP_TEMPO;
        maxTempo = MAX_TEMPO_MAP_TEMPO;
    }

    let lockReason: TempoFieldLockReason | null = null;
    if (!input.hasTransportState) {
        lockReason = 'no-transport-state';
    } else if (governing?.interpolated === true) {
        lockReason = 'tempo-ramp';
    }

    return {
        tempo,
        governedByMap,
        editable: lockReason === null,
        lockReason,
        tempoChangeId: governing?.change.id ?? null,
        minTempo,
        maxTempo,
    };
}
