import { trackStore } from '#/modules/Arrangement/stores';

import { getTransportState } from '../../../repositories/transport/getTransportState';

export function estimateOnsetsFromClips(): number[] {
    const state = trackStore.value;
    if (!state) {
        return [];
    }

    const transport = getTransportState();
    const currentTempo = transport?.tempo ?? 120;
    const beatDuration = 60 / currentTempo;

    const onsets: number[] = [];
    for (const track of state.tracks) {
        if (track.kind !== 'midi') {
            continue;
        }
        for (const clip of track.clips) {
            const clipStartSec = clip.startBeat * beatDuration;
            const clipDuration = (clip.endBeat - clip.startBeat) * beatDuration;
            for (let time = 0; time < clipDuration; time += beatDuration) {
                onsets.push(clipStartSec + time);
            }
        }
    }

    return onsets.sort((alpha, beta) => alpha - beta);
}
