type FreezableTrack = {
    frozen?: boolean;
    freezeState?: { status: string };
};

// `frozen` stays false until a freeze render commits, so a track still rendering
// its freeze is not yet `frozen` but already must not take edits the freeze
// signature leaves out (MIDI note content).
export function isTrackFrozenOrFreezing(track: FreezableTrack): boolean {
    return track.frozen === true || track.freezeState?.status === 'freezing';
}
