import { audioBufferCache } from '#/modules/AudioEngine/stores';

import { getTrackState } from '../repositories/track/getTrackState';
import { updateTrack } from '../repositories/track/updateTrack';
import { type Clip } from '../stores/trackStore';

/**
 * Split a clip into regions separated by silence.
 * Silent gaps shorter than `minSilenceBeats` are merged with their adjacent
 * sound regions so that short inter-word pauses don't cut the clip.
 */
export function stripSilence(clipId: string, thresholdDb: number = -40, minSilenceBeats: number = 0.5): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    let targetClip: { trackId: string; clip: Clip } | null = null;
    for (const track of state.tracks) {
        const clip = track.clips.find((context) => context.id === clipId);
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

    for (let index = 0; index < channelData.length; index += windowSize) {
        let peak = 0;
        const end = Math.min(index + windowSize, channelData.length);
        for (let jIndex = index; jIndex < end; jIndex++) {
            const abs = Math.abs(channelData[jIndex]!);
            if (abs > peak) {
                peak = abs;
            }
        }

        if (peak > threshold) {
            if (!inSound) {
                regionStart = index;
                inSound = true;
            }
        } else {
            if (inSound) {
                regions.push({ startSample: regionStart, endSample: index });
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

    // Merge adjacent regions whose gap (in beats) is shorter than minSilenceBeats.
    const mergedRegions: { startSample: number; endSample: number }[] = [];
    for (const region of regions) {
        const last = mergedRegions[mergedRegions.length - 1];
        if (last) {
            const gapBeats = (region.startSample - last.endSample) * beatsPerSample;
            if (gapBeats < minSilenceBeats) {
                last.endSample = region.endSample;
                continue;
            }
        }
        mergedRegions.push({ ...region });
    }

    if (mergedRegions.length <= 1) {
        return;
    }

    const newClips = mergedRegions.map((region) => ({
        ...clip,
        id: `clip-strip-${crypto.randomUUID()}`,
        startBeat: clip.startBeat + region.startSample * beatsPerSample,
        endBeat: clip.startBeat + region.endSample * beatsPerSample,
    }));

    updateTrack(targetClip.trackId, (time) => ({
        ...time,
        clips: [...time.clips.filter((context) => context.id !== clipId), ...newClips],
    }));
}
