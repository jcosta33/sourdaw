import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';

import { getTrackState } from '../repositories/track/getTrackState';
import { updateTrack } from '../repositories/track/updateTrack';
import { resolveEligibleClipWriteTarget } from '../stores/resolveEligibleClipWriteTarget';
import { type Clip } from '../stores/trackStore';

/**
 * Split a clip into regions separated by silence.
 * Silent gaps shorter than `minSilenceBeats` are merged with their adjacent
 * sound regions so that short inter-word pauses don't cut the clip.
 */
export function stripSilence(clipId: string, thresholdDb: number = -40, minSilenceBeats: number = 0.5): boolean {
    const target = resolveEligibleClipWriteTarget({ clipId });
    if (target.status !== 'eligible' || !('clipId' in target)) {
        return false;
    }

    const state = getTrackState();
    if (!state) {
        return false;
    }

    const track = state.tracks.find((candidate) => candidate.id === target.trackId);
    const targetClip: Clip | undefined = track?.clips.find((candidate) => candidate.id === target.clipId);
    if (!track || !targetClip || targetClip.type !== 'audio' || !targetClip.audioBufferId) {
        return false;
    }

    const buffer = getCachedAudioBuffer({ bufferId: targetClip.audioBufferId });
    if (!buffer) {
        return false;
    }

    const threshold = 10 ** (thresholdDb / 20);
    const sampleRate = buffer.sampleRate;
    const channelData = buffer.getChannelData(0);
    const clipDurationBeats = targetClip.endBeat - targetClip.startBeat;

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
        return false;
    }

    const clip = targetClip;
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
        return false;
    }

    const newClips = mergedRegions.map((region) => ({
        ...clip,
        id: `clip-strip-${crypto.randomUUID()}`,
        startBeat: clip.startBeat + region.startSample * beatsPerSample,
        endBeat: clip.startBeat + region.endSample * beatsPerSample,
    }));

    updateTrack(target.trackId, (time) => ({
        ...time,
        clips: [...time.clips.filter((context) => context.id !== target.clipId), ...newClips],
    }));
    return true;
}
