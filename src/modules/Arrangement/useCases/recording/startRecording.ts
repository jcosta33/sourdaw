import { transportStore } from '#/modules/Transport/stores';

import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { activeRecordingRef } from '../../stores/activeRecordingRef';
import { getTrackEligibility } from '../../stores/trackEligibility';
import { type Clip } from '../../stores/trackStore';
import { addTake } from '../comping/addTake';
import { addTakeLane } from '../comping/addTakeLane';
import { getTakeLaneForTrack } from '../comping/getTakeLaneForTrack';

const recordClipId = 1;
let takeCounter = 1;

/**
 * Open recording clips on every armed, recording-eligible track.
 *
 * `atBeat` anchors the new clips. Callers that record from a moving transport
 * must pass it: the store's `playheadPosition` is written on discrete events
 * only (start, stop, pause, seek), so during playback it holds the beat
 * playback *started* at, not the live position. Omitting it keeps the
 * stationary behaviour — anchor at the store playhead.
 */
export function startRecording(atBeat?: number): Clip[] {
    const trackState = getTrackState();
    const transportState = transportStore.value;
    if (!trackState || !transportState) {
        return [];
    }

    const recordBeat = atBeat ?? transportState.playheadPosition;
    const armedTracks = trackState.tracks.filter(
        (time) => time.armed && getTrackEligibility(time.kind).acceptsRecording
    );
    const newClips: Clip[] = [];

    for (const track of armedTracks) {
        if (track.kind === 'midi' && transportState.overdubEnabled) {
            const ph = recordBeat;
            const intersecting = track.clips.find(
                (context) => context.type === 'midi' && ph >= context.startBeat && ph < context.endBeat
            );

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
            startBeat: recordBeat,
            endBeat: recordBeat,
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
        addTake(track.id, clipId, `Take ${takeCounter++}`, recordBeat, recordBeat);
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
