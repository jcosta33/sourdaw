import { resolveClipsWithComping } from '#/modules/Arrangement/useCases';

import { selectMidiClipsForSchedulerWindow } from './selectMidiClipsForSchedulerWindow';

import type { trackStore } from '#/modules/Arrangement/stores';

type SchedulerTrack = NonNullable<(typeof trackStore)['value']>['tracks'][number];

export function resolveMidiWindowClips(track: SchedulerTrack, fromBeat: number, toBeat: number) {
    const clips = selectMidiClipsForSchedulerWindow({ clips: track.clips, fromBeat, toBeat });
    if (clips.length === 0) {
        return [];
    }
    return resolveClipsWithComping(track.id, clips).filter(
        (clip) => !clip.muted && clip.type === 'midi' && clip.endBeat > fromBeat && clip.startBeat < toBeat
    );
}
