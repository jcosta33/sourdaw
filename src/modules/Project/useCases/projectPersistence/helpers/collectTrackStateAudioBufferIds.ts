type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectClipIds(ids: Set<string>, clips: unknown): void {
    if (!Array.isArray(clips)) {
        return;
    }
    for (const clip of clips) {
        if (!isRecord(clip)) {
            continue;
        }
        const bufferId = typeof clip.audioBufferId === 'string' ? clip.audioBufferId : clip.bufferId;
        if (typeof bufferId === 'string') {
            ids.add(bufferId);
        }
    }
}

export function collectTrackStateAudioBufferIds(value: unknown): string[] {
    const ids = new Set<string>();
    const state = isRecord(value) ? value : undefined;
    const tracks = Array.isArray(state?.tracks) ? state.tracks : [];
    for (const track of tracks) {
        if (!isRecord(track)) {
            continue;
        }
        const freezeState = isRecord(track.freezeState) ? track.freezeState : undefined;
        const frozenBufferId = freezeState?.frozenBufferId ?? track.frozenBufferId;
        if (typeof frozenBufferId === 'string') {
            ids.add(frozenBufferId);
        }
        collectClipIds(ids, track.clips);
        if (Array.isArray(track.alternatives)) {
            for (const alternative of track.alternatives) {
                if (isRecord(alternative)) {
                    collectClipIds(ids, alternative.clips);
                }
            }
        }
    }
    return [...ids];
}
