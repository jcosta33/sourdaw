import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { getTransportState } from '#/modules/Transport/useCases';
import { type Clip } from '../../stores/trackStore';
import { addTakeLane } from '../comping/addTakeLane';
import { addTake } from '../comping/addTake';
import { getTakeLaneForTrack } from '../comping/getTakeLaneForTrack';
import { activeRecordingRef } from '../../stores/activeRecordingRef';

let recordClipId = 1;
let takeCounter = 1;

export function startRecording(): Clip[] {
    const trackState = getTrackState();
    const transportState = getTransportState();
    if (!trackState || !transportState) {
        return [];
    }

    const armedTracks = trackState.tracks.filter((t) => t.armed);
    const newClips: Clip[] = [];

    for (const track of armedTracks) {
        if (track.kind === 'midi' && transportState.overdubEnabled) {
            const ph = transportState.playheadPosition;
            const intersecting = track.clips.find(
                (c) => c.type === 'midi' && ph >= c.startBeat && ph < c.endBeat
            );

            const inLoop =
                transportState.isLooping && ph >= transportState.loopStart && ph <= transportState.loopEnd;
            const loopClip = inLoop
                ? track.clips.find(
                      (c) =>
                          c.type === 'midi' &&
                          c.startBeat >= transportState.loopStart &&
                          c.endBeat <= transportState.loopEnd
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
            tracks: trackState.tracks.map((t) => {
                const clip = newClips.find((c) => c.trackId === t.id);
                if (!clip) {
                    return t;
                }
                return { ...t, clips: [...t.clips, clip] };
            }),
        });
        // Mark these clips as actively recording so the timeline renderer can
        // grow them visually using the live playhead position.
        activeRecordingRef.current = newClips.map((c) => c.id);
    }

    return newClips;
}