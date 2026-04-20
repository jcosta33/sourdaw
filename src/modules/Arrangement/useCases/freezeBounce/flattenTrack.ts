import { getTransportState } from '#/modules/Transport/useCases';

import { type Clip } from '../../models/Track';
import { updateTrack } from '../../repositories/track/updateTrack';
import { trackStore } from '../../stores/trackStore';

export function flattenTrack(trackId: string): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const track = state.tracks.find((t) => t.id === trackId);
    if (!track || track.freezeState.status !== 'frozen') {
        return;
    }

    const { frozenBufferId } = track.freezeState;
    if (!frozenBufferId) {
        return;
    }

    let startBeat = Infinity;
    let endBeat = -Infinity;
    for (const c of track.clips) {
        if (c.startBeat < startBeat) {
            startBeat = c.startBeat;
        }
        if (c.endBeat > endBeat) {
            endBeat = c.endBeat;
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
        trackId,
        name: `${track.name} (Flattened)`,
        startBeat,
        endBeat:
            endBeat +
            (track.freezeState.renderSettings?.tailLengthSeconds ?? 0) * ((getTransportState()?.tempo ?? 120) / 60),
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
    updateTrack(trackId, (t) => ({
        ...t,
        kind: 'audio',
        clips: [newClip],
        devices: [],
        frozen: false,
        frozenBufferId: undefined,
        freezeState: { status: 'unfrozen' },
        activeAlternativeId: altId,
        alternatives: [{ id: altId, name: 'Flattened', clips: [newClip] }],
    }));
}
