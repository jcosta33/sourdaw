import { transportStore } from '#/modules/Transport/stores';

import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { activeRecordingRef } from '../../stores/activeRecordingRef';
import { getTrackEligibility } from '../../stores/trackEligibility';
import { type Clip } from '../../stores/trackStore';
import { getTakeLaneForTrack } from '../comping/getTakeLaneForTrack';

import { stageRecordingTake } from './stageRecordingTake';

const recordClipId = 1;

/**
 * Open recording clips on every armed, recording-eligible track.
 *
 * Every take a recording opens is provisional: the clip, its take lane, and its
 * takes are staged without history, and `commitRecording` turns the whole result
 * into one entry — from the capture terminal for an audio track, and from
 * `stopRecording` for a MIDI track, whose notes are committed by their own
 * actions. Pushing the ordinary take-lane entries here would leave the lane and
 * the take as separate history above a clip no entry covers.
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

        // Take labels count per lane, the way the scheduler's wrap path mints
        // them, so takes on different lanes never share or duplicate labels.
        const takeNum = (getTakeLaneForTrack(track.id)?.takes.length ?? 0) + 1;
        stageRecordingTake({
            trackId: track.id,
            clipId,
            name: `Take ${takeNum}`,
            startBeat: recordBeat,
            endBeat: recordBeat,
        });
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
