import { trackStore } from "../stores/trackStore";
import { audioBufferCache } from "#/modules/AudioEngine/stores/audioBufferCache";
import { transportStore } from "#/modules/Transport/stores/transportStore";
import type { Clip } from "../models/Track";

let nextClipId = 1000;

function findNearestZeroCrossing(buffer: AudioBuffer, targetSample: number, windowSize: number = 256): number {
    const data = buffer.getChannelData(0);
    let bestOffset = 0;
    let bestDistance = Infinity;
    for (let offset = -windowSize; offset <= windowSize; offset++) {
        const idx = targetSample + offset;
        if (idx < 0 || idx >= data.length - 1) {
            continue;
        }
        if (data[idx]! * data[idx + 1]! <= 0) {
            if (Math.abs(offset) < bestDistance) {
                bestDistance = Math.abs(offset);
                bestOffset = offset;
            }
        }
    }
    return targetSample + bestOffset;
}

function snapSplitBeatToZeroCrossing(clip: Clip, splitBeat: number): number {
    if (clip.type !== "audio" || !clip.audioBufferId) {
        return splitBeat;
    }

    const buffer = audioBufferCache.get(clip.audioBufferId);
    if (!buffer) {
        return splitBeat;
    }

    const tempo = transportStore.value?.tempo ?? 120;
    const beatsPerSecond = tempo / 60;
    const sampleRate = buffer.sampleRate;

    const relativeBeat = splitBeat - clip.startBeat;
    const targetSample = Math.round(relativeBeat / beatsPerSecond * sampleRate);

    const snappedSample = findNearestZeroCrossing(buffer, targetSample);
    const snappedRelativeBeat = (snappedSample / sampleRate) * beatsPerSecond;

    return clip.startBeat + snappedRelativeBeat;
}

export const renameClip = (clipId: string, name: string): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((c) =>
                c.id === clipId ? { ...c, name } : c,
            ),
        })),
    });
};

export const splitClip = (clipId: string, splitBeat: number): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => {
            const clip = t.clips.find((c) => c.id === clipId);
            if (!clip || splitBeat <= clip.startBeat || splitBeat >= clip.endBeat) {
                return t;
            }

            const adjustedSplitBeat = snapSplitBeatToZeroCrossing(clip, splitBeat);

            if (adjustedSplitBeat <= clip.startBeat || adjustedSplitBeat >= clip.endBeat) {
                return t;
            }

            const leftClip: Clip = {
                ...clip,
                endBeat: adjustedSplitBeat,
                name: `${clip.name} (L)`,
                fadeOutBeats: 0,
            };

            const rightClip: Clip = {
                id: `clip-${nextClipId++}`,
                trackId: t.id,
                name: `${clip.name} (R)`,
                startBeat: adjustedSplitBeat,
                endBeat: clip.endBeat,
                type: clip.type,
                fadeInBeats: 0,
                fadeOutBeats: clip.fadeOutBeats,
                gain: 1.0,
                color: "",
                locked: false,
                muted: clip.muted,
            };

            return {
                ...t,
                clips: t.clips.map((c) => (c.id === clipId ? leftClip : c)).concat(rightClip),
            };
        }),
    });
};

export const trimClipStart = (clipId: string, newStartBeat: number): void => {
    const state = trackStore.value;
    if (!state) return;
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((c) =>
                c.id === clipId && newStartBeat < c.endBeat
                    ? { ...c, startBeat: Math.max(0, newStartBeat) }
                    : c,
            ),
        })),
    });
};

export const trimClipEnd = (clipId: string, newEndBeat: number): void => {
    const state = trackStore.value;
    if (!state) return;
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((c) =>
                c.id === clipId && newEndBeat > c.startBeat
                    ? { ...c, endBeat: newEndBeat }
                    : c,
            ),
        })),
    });
};

export const setClipFade = (clipId: string, fadeInBeats: number, fadeOutBeats: number): void => {
    const state = trackStore.value;
    if (!state) return;
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((c) =>
                c.id === clipId
                    ? { ...c, fadeInBeats: Math.max(0, fadeInBeats), fadeOutBeats: Math.max(0, fadeOutBeats) }
                    : c,
            ),
        })),
    });
};

export const resizeClip = (clipId: string, factor: number): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((c) => {
                if (c.id !== clipId) {
                    return c;
                }
                const duration = c.endBeat - c.startBeat;
                return { ...c, endBeat: c.startBeat + duration * factor };
            }),
        })),
    });
};

export const normalizeClip = (
    clipId: string,
    mode: "peak" | "rms" | "lufs" = "peak",
    targetDb?: number,
): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    for (const track of state.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (!clip || clip.type !== "audio" || !clip.audioBufferId) {
            continue;
        }
        const buffer = audioBufferCache.get(clip.audioBufferId);
        if (!buffer) {
            return;
        }

        let scale: number;

        if (mode === "rms") {
            const target = targetDb ?? -14;
            let sumSq = 0;
            let totalSamples = 0;
            for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
                const data = buffer.getChannelData(ch);
                for (let i = 0; i < data.length; i++) {
                    sumSq += data[i]! * data[i]!;
                }
                totalSamples += data.length;
            }
            const rms = Math.sqrt(sumSq / totalSamples);
            if (rms === 0) return;
            const rmsDb = 20 * Math.log10(rms);
            const gainDb = target - rmsDb;
            scale = Math.pow(10, gainDb / 20);
        } else if (mode === "lufs") {
            const target = targetDb ?? -14;
            // Simplified K-weighting: high-shelf pre-emphasis (+4dB above ~2kHz)
            // Apply a simple first-order high-shelf approximation per channel
            const sampleRate = buffer.sampleRate;
            const cutoff = 2000;
            const boostLinear = Math.pow(10, 4 / 20); // +4dB
            const rc = 1 / (2 * Math.PI * cutoff);
            const dt = 1 / sampleRate;
            const alpha = dt / (rc + dt);

            let sumSq = 0;
            let totalSamples = 0;
            for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
                const data = buffer.getChannelData(ch);
                let lpPrev = 0;
                for (let i = 0; i < data.length; i++) {
                    const sample = data[i]!;
                    lpPrev = lpPrev + alpha * (sample - lpPrev);
                    const hp = sample - lpPrev;
                    const weighted = lpPrev + hp * boostLinear;
                    sumSq += weighted * weighted;
                }
                totalSamples += data.length;
            }
            const rms = Math.sqrt(sumSq / totalSamples);
            if (rms === 0) return;
            const rmsDb = 20 * Math.log10(rms);
            const gainDb = target - rmsDb;
            scale = Math.pow(10, gainDb / 20);
        } else {
            // Peak normalization (default)
            let peak = 0;
            for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
                const data = buffer.getChannelData(ch);
                for (let i = 0; i < data.length; i++) {
                    const abs = Math.abs(data[i]!);
                    if (abs > peak) {
                        peak = abs;
                    }
                }
            }
            if (peak === 0) return;
            scale = 1.0 / peak;
        }

        trackStore.set({
            ...state,
            tracks: state.tracks.map((t) => ({
                ...t,
                clips: t.clips.map((c) =>
                    c.id === clipId ? { ...c, gain: c.gain * scale } : c,
                ),
            })),
        });
        return;
    }
};

export const reverseClip = (clipId: string): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    for (const track of state.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (!clip || clip.type !== "audio" || !clip.audioBufferId) {
            continue;
        }
        const buffer = audioBufferCache.get(clip.audioBufferId);
        if (!buffer) {
            return;
        }
        const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
        const reversed = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
            const src = buffer.getChannelData(ch);
            const dst = reversed.getChannelData(ch);
            for (let i = 0; i < src.length; i++) {
                dst[i] = src[src.length - 1 - i]!;
            }
        }
        const newId = `reversed-${clip.audioBufferId}-${Date.now()}`;
        audioBufferCache.set(newId, reversed);
        trackStore.set({
            ...state,
            tracks: state.tracks.map((t) => ({
                ...t,
                clips: t.clips.map((c) =>
                    c.id === clipId ? { ...c, audioBufferId: newId, name: `${c.name} (reversed)` } : c,
                ),
            })),
        });
        return;
    }
};

export const glueClips = (clipIds: string[]): void => {
    const state = trackStore.value;
    if (!state || clipIds.length < 2) {
        return;
    }
    const firstTrack = state.tracks.find((t) => t.clips.some((c) => clipIds.includes(c.id)));
    if (!firstTrack) {
        return;
    }
    const clips = firstTrack.clips.filter((c) => clipIds.includes(c.id));
    if (clips.length < 2) {
        return;
    }
    const startBeat = Math.min(...clips.map((c) => c.startBeat));
    const endBeat = Math.max(...clips.map((c) => c.endBeat));
    const glued: Clip = {
        id: `clip-${nextClipId++}`,
        trackId: firstTrack.id,
        name: `${clips[0]!.name} (glued)`,
        startBeat,
        endBeat,
        type: clips[0]!.type,
        fadeInBeats: clips[0]!.fadeInBeats,
        fadeOutBeats: clips[clips.length - 1]!.fadeOutBeats,
        gain: 1.0,
        color: clips[0]!.color,
        locked: false,
        muted: false,
    };
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => {
            if (t.id !== firstTrack.id) {
                return t;
            }
            return {
                ...t,
                clips: [...t.clips.filter((c) => !clipIds.includes(c.id)), glued],
            };
        }),
    });
};

export const nudgeClip = (clipId: string, beats: number): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((c) => {
                if (c.id !== clipId || c.locked) {
                    return c;
                }
                const newStart = Math.max(0, c.startBeat + beats);
                const duration = c.endBeat - c.startBeat;
                return { ...c, startBeat: newStart, endBeat: newStart + duration };
            }),
        })),
    });
};

export const setClipGain = (clipId: string, gain: number): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((c) =>
                c.id === clipId ? { ...c, gain: Math.max(0, Math.min(2, gain)) } : c,
            ),
        })),
    });
};

export const setClipColor = (clipId: string, color: string): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((c) =>
                c.id === clipId ? { ...c, color } : c,
            ),
        })),
    });
};

export const lockClip = (clipId: string, locked: boolean): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((c) =>
                c.id === clipId ? { ...c, locked } : c,
            ),
        })),
    });
};

export const muteClip = (clipId: string, muted: boolean): void => {
    const state = trackStore.value;
    if (!state) return;
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((c) => (c.id === clipId ? { ...c, muted } : c)),
        })),
    });
};

export const crossfadeClips = (
    clipAId: string,
    clipBId: string,
    durationBeats = 0.5,
): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    let clipA: Clip | undefined;
    let clipB: Clip | undefined;
    for (const track of state.tracks) {
        clipA = clipA ?? track.clips.find((c) => c.id === clipAId);
        clipB = clipB ?? track.clips.find((c) => c.id === clipBId);
    }
    if (!clipA || !clipB) {
        return;
    }

    const halfLen = durationBeats / 2;
    const newClipAEnd = clipA.endBeat + halfLen;
    const newClipBStart = Math.max(0, clipB.startBeat - halfLen);
    const actualOverlap = newClipAEnd - newClipBStart;

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((c) => {
                if (c.id === clipAId) {
                    return {
                        ...c,
                        endBeat: newClipAEnd,
                        fadeOutBeats: actualOverlap,
                    };
                }
                if (c.id === clipBId) {
                    return {
                        ...c,
                        startBeat: newClipBStart,
                        fadeInBeats: actualOverlap,
                    };
                }
                return c;
            }),
        })),
    });
};
