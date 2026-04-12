import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { getTransportState } from '#/modules/Transport/useCases';
import { takeLaneStore } from '#/modules/Arrangement/stores/takeLaneStore';
import { activeRecordingRef } from '../../stores/activeRecordingRef';

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
                if (!clipIds.includes(c.id)) {return c;}
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
                    clipIds.includes(take.clipId)
                        ? { ...take, endBeat: Math.max(take.startBeat + 1, endBeat) }
                        : take
                ),
            })),
        });
    }
}