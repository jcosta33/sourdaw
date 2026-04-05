import { getTrackState } from '../repositories/track/getTrackState';
import { setTrackState } from '../repositories/track/setTrackState';
import { updateTrack } from '../repositories/track/updateTrack';
import { getTrackById } from '../repositories/track/getTrackById';
import { getTransportState } from '#/modules/Transport/useCases/transportQueries';
import { takeLaneStore } from '#/modules/Arrangement/stores/takeLaneStore';
import { type Clip } from '../models/Track';
import { addTakeLane } from '#/modules/Arrangement/useCases/comping/addTakeLane';
import { addTake } from '#/modules/Arrangement/useCases/comping/addTake';
import { getTakeLaneForTrack } from '#/modules/Arrangement/useCases/comping/getTakeLaneForTrack';
import { setMidiInputTrack } from '#/modules/AudioEngine/useCases/webMidiInput';
import { activeRecordingRef } from '../stores/activeRecordingRef';

let recordClipId = 1;
let takeCounter = 1;

export function armTrack(trackId: string, armed: boolean): void {
    updateTrack(trackId, (t) => ({ ...t, armed }));

    if (armed) {
        const track = getTrackById(trackId);
        if (track && track.kind === 'midi') {
            setMidiInputTrack(trackId);
        }
    }
}

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
            const intersecting = track.clips.find((c) => c.type === 'midi' && ph >= c.startBeat && ph < c.endBeat);

            const inLoop = transportState.isLooping && ph >= transportState.loopStart && ph <= transportState.loopEnd;
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

        const clipId = `rec-clip-${recordClipId++}`;
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

export function stopRecording(clipIds: string[]): void {
    // Clear the recording overlay immediately so the canvas stops growing the clip.
    activeRecordingRef.current = [];

    const trackState = getTrackState();
    const transportState = getTransportState();
    if (!trackState || !transportState) {
        return;
    }

    const endBeat = transportState.playheadPosition;

    setTrackState({
        ...trackState,
        tracks: trackState.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((c) => {
                if (!clipIds.includes(c.id)) return c;
                // Audio clips get an exact endBeat from the buffer duration via a
                // deferred updateClip in toggleRecording — use the playhead as a
                // provisional value here. MIDI clips have no buffer callback, so
                // enforce a minimum of 1 beat to prevent zero-length clips.
                const minEnd = c.type === 'midi' ? c.startBeat + 1 : c.startBeat;
                return { ...c, endBeat: Math.max(minEnd, endBeat) };
            }),
        })),
    });

    const tlState = takeLaneStore.value;
    if (tlState) {
        takeLaneStore.set({
            lanes: tlState.lanes.map((lane) => ({
                ...lane,
                takes: lane.takes.map((take) =>
                    clipIds.includes(take.clipId) ? { ...take, endBeat: Math.max(take.startBeat + 1, endBeat) } : take
                ),
            })),
        });
    }
}
