import { trackStore } from '../../stores/trackStore';
import { updateTrack } from '../../repositories/track/updateTrack';
import { computeTrackHash } from '../../services/computeTrackHash';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { renderTrackOffline } from './renderOffline';

export const activeFreezeTasks = new Map<string, AbortController>();

export async function freezeTrack(trackId: string): Promise<void> {
    const state = trackStore.value;
    if (!state) {return;}

    const track = state.tracks.find((t) => t.id === trackId);
    if (!track || track.freezeState.status === 'frozen') {return;}

    if (activeFreezeTasks.has(trackId)) {
        activeFreezeTasks.get(trackId)!.abort();
    }
    const abortController = new AbortController();
    activeFreezeTasks.set(trackId, abortController);

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

        // Heuristic: If there's a reverb or delay in the chain, give it a longer tail
        const hasReverbOrDelay = track.devices.some((d) => 
            d.type.toLowerCase().includes('reverb') || d.type.toLowerCase().includes('delay')
        );
        const tailBeats = hasReverbOrDelay ? 8 : 4;

        const renderedBuffer = await renderTrackOffline(track, startBeat, endBeat + tailBeats, {
            abortSignal: abortController.signal,
            onProgress: (p) => {
                updateTrack(trackId, (t) => ({
                    ...t,
                    freezeState: { ...t.freezeState, renderProgress: p }
                }));
            }
        });

        activeFreezeTasks.delete(trackId);

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
                    tailLengthSeconds: tailBeats, // Storing as beats for now since that's what we computed
                },
                renderedAt: Date.now(),
            },
        }));
    } catch (err) {
        activeFreezeTasks.delete(trackId);
        
        if (abortController.signal.aborted) {
            // User cancelled
            updateTrack(trackId, (t) => ({
                ...t,
                freezeState: { status: 'unfrozen' },
            }));
            return;
        }

        updateTrack(trackId, (t) => ({
            ...t,
            freezeState: {
                status: 'error',
                errorMessage: err instanceof Error ? err.message : String(err),
            },
        }));
    }
}
