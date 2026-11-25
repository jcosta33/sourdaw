import { type Device, type Track, type TrackAlternative } from './Track';

type DuplicatedTrackCopies = {
    devices: Device[];
    alternatives: TrackAlternative[];
    activeAlternativeId: string;
};

/**
 * The one law for what a duplicate takes from its source: gain, pan, color, sends, routing, notes and
 * the supplied device and alternative copies. Every other field keeps the new track's default. The
 * duplicate use case writes the executed copy through it and the batch planner plans the copy
 * through it, so the plan cannot drift from execution.
 */
export function applyDuplicatedTrackFields(base: Track, source: Track, copies: DuplicatedTrackCopies): Track {
    return {
        ...base,
        gain: source.gain,
        pan: source.pan,
        color: source.color,
        devices: copies.devices,
        sends: [...source.sends],
        alternatives: copies.alternatives,
        activeAlternativeId: copies.activeAlternativeId,
        clips: copies.alternatives.find((alt) => alt.id === copies.activeAlternativeId)?.clips ?? [],
        vcaGroupId: source.vcaGroupId,
        outputId: source.outputId,
        followChordTrack: source.followChordTrack,
        notes: source.notes,
    };
}
