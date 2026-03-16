import { trackStore } from "#/modules/Track/stores/trackStore";
import { audioBufferCache } from "#/modules/AudioEngine/stores/audioBufferCache";

export const stripSilence = (clipId: string, thresholdDb: number = -40, _minSilenceBeats: number = 0.5): void => {
    const state = trackStore.value;
    if (!state) return;

    let targetClip: { trackId: string; clip: typeof state.tracks[0]["clips"][0] } | null = null;
    for (const track of state.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) {
            targetClip = { trackId: track.id, clip };
            break;
        }
    }
    if (!targetClip || targetClip.clip.type !== "audio" || !targetClip.clip.audioBufferId) return;

    const buffer = audioBufferCache.get(targetClip.clip.audioBufferId);
    if (!buffer) return;

    const threshold = Math.pow(10, thresholdDb / 20);
    const sampleRate = buffer.sampleRate;
    const channelData = buffer.getChannelData(0);
    const clipDurationBeats = targetClip.clip.endBeat - targetClip.clip.startBeat;

    const windowSize = Math.floor(sampleRate * 0.01);
    const regions: { startSample: number; endSample: number }[] = [];
    let inSound = false;
    let regionStart = 0;

    for (let i = 0; i < channelData.length; i += windowSize) {
        let peak = 0;
        const end = Math.min(i + windowSize, channelData.length);
        for (let j = i; j < end; j++) {
            const abs = Math.abs(channelData[j]!);
            if (abs > peak) peak = abs;
        }

        if (peak > threshold) {
            if (!inSound) {
                regionStart = i;
                inSound = true;
            }
        } else {
            if (inSound) {
                regions.push({ startSample: regionStart, endSample: i });
                inSound = false;
            }
        }
    }
    if (inSound) {
        regions.push({ startSample: regionStart, endSample: channelData.length });
    }

    if (regions.length <= 1) return;

    const clip = targetClip.clip;
    const beatsPerSample = clipDurationBeats / channelData.length;

    let nextId = Date.now();
    const newClips = regions.map((region) => ({
        ...clip,
        id: `clip-strip-${nextId++}`,
        startBeat: clip.startBeat + region.startSample * beatsPerSample,
        endBeat: clip.startBeat + region.endSample * beatsPerSample,
    }));

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => {
            if (t.id !== targetClip!.trackId) return t;
            return {
                ...t,
                clips: [...t.clips.filter((c) => c.id !== clipId), ...newClips],
            };
        }),
    });
};
