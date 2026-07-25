import { transportStore } from '#/modules/Transport/stores';

import { type Clip } from '../../models/Track';
import { updateTrack } from '../../repositories/track/updateTrack';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { trackStore } from '../../stores/trackStore';

export function flattenTrack(trackId: string): boolean {
    const target = resolveEligibleClipWriteTarget({ trackId });
    if (target.status !== 'eligible') {
        return false;
    }

    const state = trackStore.value;
    if (!state) {
        return false;
    }

    const track = state.tracks.find((candidate) => candidate.id === target.trackId);
    if (!track || track.freezeState.status !== 'frozen') {
        return false;
    }

    const { frozenBufferId } = track.freezeState;
    if (!frozenBufferId) {
        return false;
    }

    let startBeat = Infinity;
    let endBeat = -Infinity;
    for (const context of track.clips) {
        if (context.startBeat < startBeat) {
            startBeat = context.startBeat;
        }
        if (context.endBeat > endBeat) {
            endBeat = context.endBeat;
        }
    }
    if (startBeat === Infinity) {
        startBeat = 0;
    }
    if (endBeat === -Infinity) {
        endBeat = 1;
    }

    const newClip: Clip = {
        id: `flattened-${crypto.randomUUID()}`,
        trackId: target.trackId,
        name: `${track.name} (Flattened)`,
        startBeat,
        endBeat:
            endBeat +
            (track.freezeState.renderSettings?.tailLengthSeconds ?? 0) * ((transportStore.value?.tempo ?? 120) / 60),
        type: 'audio',
        audioBufferId: frozenBufferId,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1.0,
        color: track.color,
        locked: false,
        muted: false,
    };

    const altId = `alt-flatten-${crypto.randomUUID().slice(0, 8)}`;
    updateTrack(target.trackId, (time) => ({
        ...time,
        kind: 'audio',
        clips: [newClip],
        devices: [],
        frozen: false,
        frozenBufferId: undefined,
        freezeState: { status: 'unfrozen' },
        activeAlternativeId: altId,
        alternatives: [{ id: altId, name: 'Flattened', clips: [newClip] }],
    }));
    return true;
}
