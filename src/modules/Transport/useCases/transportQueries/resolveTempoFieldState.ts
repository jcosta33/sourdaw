import { getGoverningTempoChange, getTempoAtBeat, type TempoChange } from '../../models/TempoMap';
import { MIN_TEMPO_MAP_TEMPO, MAX_TEMPO_MAP_TEMPO } from '../../stores/tempoMapStore';

/** Range of the transport's own base tempo, mirroring `transportStore`'s validator. */
const MIN_BASE_TEMPO = 20;
const MAX_BASE_TEMPO = 300;

type ResolveTempoFieldStateInput = {
    changes: readonly TempoChange[];
    /** Playhead beat as the *store* reports it — see `lockReason: 'playback'`. */
    beat: number;
    defaultTempo: number;
    isPlaying: boolean;
};

/**
 * Why the transport tempo field cannot be edited right now, or `null` when it can.
 *
 * - `tempo-ramp` — the playhead sits inside a `linear` ramp, so the tempo in
 *   force is interpolated between two events and is not any event's own value.
 *   No single BPM written to one event reproduces it.
 * - `playback` — the live playhead lives in `playheadPositionRef`, which is
 *   deliberately not reactive (the scheduler writes it ~100×/s and React never
 *   sees it). While playing with a tempo map, the field cannot know which event
 *   governs, and a write would land on whichever event governed the beat
 *   playback started from. The tempo track is edited from the tempo map panel
 *   instead.
 */
type TempoFieldLockReason = 'tempo-ramp' | 'playback';

type ResolveTempoFieldStateOutput = {
    /** Tempo in force at `beat` — the map's value when a map exists, else the base tempo. */
    tempo: number;
    /** True when a tempo-map event, not the base tempo, governs the playhead. */
    governedByMap: boolean;
    editable: boolean;
    lockReason: TempoFieldLockReason | null;
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
 * used by the command layer is `getTempoWriteTarget`.
 */
export function resolveTempoFieldState(input: ResolveTempoFieldStateInput): ResolveTempoFieldStateOutput {
    const governing = getGoverningTempoChange(input.changes, input.beat);
    const tempo = getTempoAtBeat(input.changes, input.beat, input.defaultTempo);

    if (!governing) {
        return {
            tempo,
            governedByMap: false,
            editable: true,
            lockReason: null,
            minTempo: MIN_BASE_TEMPO,
            maxTempo: MAX_BASE_TEMPO,
        };
    }

    let lockReason: TempoFieldLockReason | null = null;
    if (governing.interpolated) {
        lockReason = 'tempo-ramp';
    } else if (input.isPlaying) {
        lockReason = 'playback';
    }

    return {
        tempo,
        governedByMap: true,
        editable: lockReason === null,
        lockReason,
        minTempo: MIN_TEMPO_MAP_TEMPO,
        maxTempo: MAX_TEMPO_MAP_TEMPO,
    };
}
