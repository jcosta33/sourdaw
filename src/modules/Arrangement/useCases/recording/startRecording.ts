import { getTransportState } from '#/modules/Transport/useCases';

import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { activeRecordingRef } from '../../stores/activeRecordingRef';
import { type Clip } from '../../stores/trackStore';
import { addTake } from '../comping/addTake';
import { addTakeLane } from '../comping/addTakeLane';
import { getTakeLaneForTrack } from '../comping/getTakeLaneForTrack';

const recordClipId = 1;
let takeCounter = 1;

export function startRecording(): Clip[] {
    const trackState = getTrackState();
    const transportState = getTransportState();
    if (!trackState || !transportState) {
        return [];
    }

    const armedTracks = trackState.tracks.filter((time) => time.armed);
    const newClips: Clip[] = [];

    for (const track of armedTracks) {
        if (track.kind === 'midi' && transportState.overdubEnabled) {
            const ph = transportState.playheadPosition;
            const intersecting = track.clips.find((context) => context.type === 'midi' && ph >= context.startBeat && ph < context.endBeat);

            const inLoop = transportState.isLooping && ph >= transportState.loopStart && ph <= transportState.loopEnd;
            const loopClip = inLoop
                ? track.clips.find(
                      (context) =>
                          context.type === 'midi' &&
                          context.startBeat >= transportState.loopStart &&
                          context.endBeat <= transportState.loopEnd
                  )
                : undefined;

            if (intersecting || loopClip) {
                // Skip creating a new clip (overdub merges into existing clip)
                continue;
            }
        }

        const clipId = `rec-clip-${crypto.randomUUID()}`;
        const clip: Clip = {
            id: clipId,
            trackId: track.id,
            name: `Recording ${recordClipId}`,
            startBeat: transportState.playheadPosition,
            endBeat: transportState.playheadPosition,
            type: track.kind === 'midi' ? 'midi' : 'audio',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1.0,
            color: '',
            locked: false,
            muted: false,
        };
        newClips.push(clip);

        if (!getTakeLaneForTrack(track.id)) {
            addTakeLane(track.id);
        }
        addTake(
            track.id,
            clipId,
            `Take ${takeCounter++}`,
            transportState.playheadPosition,
            transportState.playheadPosition
        );
    }

    if (newClips.length > 0) {
        setTrackState({
            ...trackState,
            tracks: trackState.tracks.map((time) => {
                const clip = newClips.find((context) => context.trackId === time.id);
                if (!clip) {
                    return time;
                }
                return { ...time, clips: [...time.clips, clip] };
            }),
        });
        // Mark these clips as actively recording so the timeline renderer can
        // grow them visually using the live playhead position.
        activeRecordingRef.current = newClips.map((context) => context.id);
    }

    return newClips;
}
