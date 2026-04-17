import { trackStore } from '../../stores/trackStore';
import { updateTrack } from '../../repositories/track/updateTrack';
import { computeTrackHash } from '../../services/computeTrackHash';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { renderTrackOffline } from './renderOffline';

export async function freezeTrack(trackId: string): Promise<void> {
    const state = trackStore.value;
    if (!state) {return;}

    const track = state.tracks.find((t) => t.id === trackId);
    if (!track || track.freezeState.status === 'frozen') {return;}

    updateTrack(trackId, (t) => ({
        ...t,
        freezeState: { ...t.freezeState, status: 'freezing', renderProgress: 0 },
    }));

    try {
        const hash = await computeTrackHash(track.clips, track.devices);

        let startBeat = Infinity;
        let endBeat = -Infinity;
        for (const c of track.clips) {
            if (c.startBeat < startBeat) {startBeat = c.startBeat;}
            if (c.endBeat > endBeat) {endBeat = c.endBeat;}
        }

        if (startBeat === Infinity) {
            startBeat = 0;
            endBeat = 1;
        }

        // Add 4 beats for tail
        const tailBeats = 4;
        const renderedBuffer = await renderTrackOffline(track, startBeat, endBeat + tailBeats);

        if (!renderedBuffer) {
            throw new Error('Render failed');
        }

        const freezeId = `freeze-${trackId}-${Date.now()}`;
        audioBufferCache.set(freezeId, renderedBuffer);

        updateTrack(trackId, (t) => ({
            ...t,
            frozen: true,
            frozenBufferId: freezeId,
            freezeState: {
                status: 'frozen',
                freezeId,
                frozenBufferId: freezeId,
                sourceContentHash: hash,
                renderSettings: {
                    sampleRate: renderedBuffer.sampleRate,
                    bitDepth: 32,
                    channelCount: renderedBuffer.numberOfChannels,
                    tailLengthSeconds: tailBeats,
                },
                renderedAt: Date.now(),
            },
        }));
    } catch (err) {
        updateTrack(trackId, (t) => ({
            ...t,
            freezeState: {
                status: 'error',
                errorMessage: err instanceof Error ? err.message : String(err),
            },
        }));
    }
}
