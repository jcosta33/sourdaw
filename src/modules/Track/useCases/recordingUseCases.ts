import { getTrackState, setTrackState, updateTrack, getTrackById } from '../repositories/trackRepository';
import { getTransportState } from '#/modules/Transport/useCases/transportQueries';
import { takeLaneStore } from '../stores/takeLaneStore';
import { type Clip } from '../models/Track';
import { addTakeLane, addTake, getTakeLaneForTrack } from './compingUseCases';
import { setMidiInputTrack } from '#/modules/AudioEngine/useCases/webMidiInput';

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
            const intersecting = track.clips.find(
                (c) => c.type === 'midi' && ph >= c.startBeat && ph < c.endBeat
            );
            
            const inLoop = transportState.isLooping && ph >= transportState.loopStart && ph <= transportState.loopEnd;
            const loopClip = inLoop 
                ? track.clips.find((c) => c.type === 'midi' && c.startBeat >= transportState.loopStart && c.endBeat <= transportState.loopEnd)
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
    }

    return newClips;
}

export function stopRecording(clipIds: string[]): void {
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
            clips: t.clips.map((c) =>
                clipIds.includes(c.id) ? { ...c, endBeat: Math.max(c.startBeat + 1, endBeat) } : c
            ),
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
