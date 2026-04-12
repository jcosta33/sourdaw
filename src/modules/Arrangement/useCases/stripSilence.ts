import { getTrackState } from '#/modules/Arrangement/repositories/track/getTrackState';
import { updateTrack } from '#/modules/Arrangement/repositories/track/updateTrack';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { type Clip } from '#/modules/Arrangement/stores/trackStore';

// TODO: _minSilenceBeats is accepted but not yet implemented — silent gaps shorter than this value should be merged with adjacent sound regions
export function stripSilence(clipId: string, thresholdDb: number = -40, _minSilenceBeats: number = 0.5): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    let targetClip: { trackId: string; clip: Clip } | null = null;
    for (const track of state.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) {
            targetClip = { trackId: track.id, clip };
            break;
        }
    }
    if (!targetClip || targetClip.clip.type !== 'audio' || !targetClip.clip.audioBufferId) {
        return;
    }

    const buffer = audioBufferCache.get(targetClip.clip.audioBufferId);
    if (!buffer) {
        return;
    }

    const threshold = 10 ** (thresholdDb / 20);
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
            if (abs > peak) {
                peak = abs;
            }
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

    if (regions.length <= 1) {
        return;
    }

    const clip = targetClip.clip;
    const beatsPerSample = clipDurationBeats / channelData.length;

    let nextId = Date.now();
    const newClips = regions.map((region) => ({
        ...clip,
        id: `clip-strip-${nextId++}`,
        startBeat: clip.startBeat + region.startSample * beatsPerSample,
        endBeat: clip.startBeat + region.endSample * beatsPerSample,
    }));

    updateTrack(targetClip.trackId, (t) => ({
        ...t,
        clips: [...t.clips.filter((c) => c.id !== clipId), ...newClips],
    }));
}
