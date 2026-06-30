import { addWarpMarker, getWarpState, trackStore, warpStates } from '#/modules/Arrangement/stores';
import { transportStore } from '#/modules/Transport/stores';

import { audioBufferCache } from '../../stores/audioBufferCache';

import { detectTransients } from './detectTransients';

export type DetectTransientsResult =
    | { ok: true; added: number; kept: number; removed: number }
    | { ok: false; reason: 'CLIP_NOT_FOUND' | 'CLIP_NOT_AUDIO' | 'NO_BUFFER' | 'NO_TEMPO' };

type DetectableClip = {
    id: string;
    type: 'audio' | 'midi';
    audioBufferId?: string;
};

function findClip(clipId: string): { clip: DetectableClip } | null {
    const tracks = trackStore.value?.tracks ?? [];
    for (const track of tracks) {
        const clips: readonly DetectableClip[] = track.clips;
        const clip = clips.find((candidate) => candidate.id === clipId);
        if (clip) {
            return { clip };
        }
    }
    return null;
}

/**
 * Detect transients in an audio clip and write the resulting markers into the
 * warp-marker store with `origin: 'transient-auto'`. User-locked markers and
 * markers with origin `user`/`grid-snap` are preserved across re-runs.
 *
 * Synchronous main-thread implementation. The pure detector is fast enough to
 * run inline for clips up to a few minutes; offloading to a worker is a
 * milestone-3 concern.
 */
export function detectTransientsForClip(clipId: string, sensitivity: number): DetectTransientsResult {
    const found = findClip(clipId);
    if (!found) {
        return { ok: false, reason: 'CLIP_NOT_FOUND' };
    }
    const { clip } = found;
    if (clip.type !== 'audio') {
        return { ok: false, reason: 'CLIP_NOT_AUDIO' };
    }
    if (!clip.audioBufferId) {
        return { ok: false, reason: 'NO_BUFFER' };
    }
    const buffer = audioBufferCache.get(clip.audioBufferId);
    if (!buffer) {
        return { ok: false, reason: 'NO_BUFFER' };
    }

    const tempo = transportStore.value?.tempo;
    if (!tempo || tempo <= 0) {
        return { ok: false, reason: 'NO_TEMPO' };
    }

    const monoSamples = downmixToMono(buffer);
    const hits = detectTransients(monoSamples, buffer.sampleRate, sensitivity);

    const beatsPerSecond = tempo / 60;
    const existing = getWarpState(clipId);
    // Snapshot of preserved markers — `addWarpMarker` mutates the underlying
    // store entry in place, so we cannot reuse the filtered array directly to
    // gate duplicate-beat detection or to count `kept`.
    const preservedSnapshot = existing.markers.filter((m) => (m.origin ?? 'user') !== 'transient-auto');

    warpStates.set(clipId, {
        ...existing,
        markers: [...preservedSnapshot].sort((a, b) => a.originalBeat - b.originalBeat),
    });

    let added = 0;
    for (const hit of hits) {
        const beat = (hit.sampleOffset / buffer.sampleRate) * beatsPerSecond;
        if (preservedSnapshot.some((m) => Math.abs(m.originalBeat - beat) < 1e-3)) {
            continue;
        }
        addWarpMarker(clipId, beat, beat, {
            origin: 'transient-auto',
            confidence: hit.confidence,
        });
        added++;
    }

    return {
        ok: true,
        added,
        kept: preservedSnapshot.length,
        removed: existing.markers.length - preservedSnapshot.length,
    };
}

function downmixToMono(buffer: AudioBuffer): Float32Array {
    if (buffer.numberOfChannels === 1) {
        return buffer.getChannelData(0);
    }
    const out = new Float32Array(buffer.length);
    const channels = buffer.numberOfChannels;
    const buffers: Float32Array[] = [];
    for (let c = 0; c < channels; c++) {
        buffers.push(buffer.getChannelData(c));
    }
    for (let i = 0; i < buffer.length; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
            sum += buffers[c]![i]!;
        }
        out[i] = sum / channels;
    }
    return out;
}
