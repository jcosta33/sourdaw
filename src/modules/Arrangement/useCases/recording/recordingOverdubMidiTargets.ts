import { type Track } from '../../stores/trackStore';

import type { transportStore } from '#/modules/Transport/stores';

/** The existing clip or loop candidates that let this take reuse MIDI media. */
export function recordingOverdubMidiTargets(
    track: Track,
    beat: number,
    transport: NonNullable<typeof transportStore.value>
) {
    if (track.kind !== 'midi' || !transport.overdubEnabled) {
        return [];
    }
    const intersecting = track.clips.find(
        (clip) => clip.type === 'midi' && beat >= clip.startBeat && beat < clip.endBeat
    );
    const inLoop = transport.isLooping && beat >= transport.loopStart && beat <= transport.loopEnd;
    let targets: Track['clips'] = [];
    if (inLoop) {
        targets = track.clips.filter(
            (clip) => clip.type === 'midi' && clip.startBeat >= transport.loopStart && clip.endBeat <= transport.loopEnd
        );
    }
    if (intersecting && !targets.includes(intersecting)) {
        targets.push(intersecting);
    }
    return targets;
}
