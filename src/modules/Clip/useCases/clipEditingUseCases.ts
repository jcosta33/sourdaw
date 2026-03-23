import { getTrackState, updateTrack, mapAllTracks, updateClip, setTrackState } from '#/modules/Track/repositories/trackRepository';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { getTransportState } from '#/modules/Transport/useCases/transportQueries';
import {
    findNearestZeroCrossing,
    computeNormalizationScale,
    type NormalizationMode,
} from '#/modules/Track/transformers/clipDspTransformers';
import { type Clip } from '#/modules/Track/models/Track';

function snapSplitBeatToZeroCrossing(clip: Clip, splitBeat: number): number {
    if (clip.type !== 'audio' || !clip.audioBufferId) {
        return splitBeat;
    }

    const buffer = audioBufferCache.get(clip.audioBufferId);
    if (!buffer) {
        return splitBeat;
    }

    const tempo = getTransportState()?.tempo ?? 120;
    const beatsPerSecond = tempo / 60;
    const sampleRate = buffer.sampleRate;

    const relativeBeat = splitBeat - clip.startBeat;
    const targetSample = Math.round((relativeBeat / beatsPerSecond) * sampleRate);

    const snappedSample = findNearestZeroCrossing(buffer.getChannelData(0), targetSample);
    const snappedRelativeBeat = (snappedSample / sampleRate) * beatsPerSecond;

    return clip.startBeat + snappedRelativeBeat;
}

let nextClipId = 1000;

export function renameClip(clipId: string, name: string): void {
    updateClip(clipId, (c) => ({ ...c, name }));
}

export function splitClip(clipId: string, splitBeat: number): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    setTrackState({
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
                color: '',
                locked: false,
                muted: clip.muted,
            };

            return {
                ...t,
                clips: t.clips.map((c) => (c.id === clipId ? leftClip : c)).concat(rightClip),
            };
        }),
    });
}

export function trimClipStart(clipId: string, newStartBeat: number): void {
    updateClip(clipId, (c) => (newStartBeat < c.endBeat ? { ...c, startBeat: Math.max(0, newStartBeat) } : c));
}

export function trimClipEnd(clipId: string, newEndBeat: number): void {
    updateClip(clipId, (c) => (newEndBeat > c.startBeat ? { ...c, endBeat: newEndBeat } : c));
}

export function setClipFade(clipId: string, fadeInBeats: number, fadeOutBeats: number): void {
    updateClip(clipId, (c) => ({
        ...c,
        fadeInBeats: Math.max(0, fadeInBeats),
        fadeOutBeats: Math.max(0, fadeOutBeats),
    }));
}

export function normalizeClip(clipId: string, mode: NormalizationMode = 'peak', targetDb?: number): void {
    const state = getTrackState();
    if (!state) {
        return;
    }
    for (const track of state.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (!clip || clip.type !== 'audio' || !clip.audioBufferId) {
            continue;
        }
        const buffer = audioBufferCache.get(clip.audioBufferId);
        if (!buffer) {
            return;
        }

        const scale = computeNormalizationScale(buffer, mode, targetDb);
        if (scale === null) {
            return;
        }

        updateClip(clipId, (c) => ({ ...c, gain: c.gain * scale }));
        return;
    }
}

export function reverseClip(clipId: string): void {
    const state = getTrackState();
    if (!state) {
        return;
    }
    for (const track of state.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (!clip || clip.type !== 'audio' || !clip.audioBufferId) {
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
        updateClip(clipId, (c) => ({ ...c, audioBufferId: newId, name: `${c.name} (reversed)` }));
        return;
    }
}

export function glueClips(clipIds: string[]): void {
    const state = getTrackState();
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
    updateTrack(firstTrack.id, (t) => ({
        ...t,
        clips: [...t.clips.filter((c) => !clipIds.includes(c.id)), glued],
    }));
}

export function nudgeClip(clipId: string, beats: number): void {
    updateClip(clipId, (c) => {
        if (c.locked) {
            return c;
        }
        const newStart = Math.max(0, c.startBeat + beats);
        const duration = c.endBeat - c.startBeat;
        return { ...c, startBeat: newStart, endBeat: newStart + duration };
    });
}

export function setClipGain(clipId: string, gain: number): void {
    updateClip(clipId, (c) => ({ ...c, gain: Math.max(0, Math.min(2, gain)) }));
}

export function setClipColor(clipId: string, color: string): void {
    updateClip(clipId, (c) => ({ ...c, color }));
}

export function lockClip(clipId: string, locked: boolean): void {
    updateClip(clipId, (c) => ({ ...c, locked }));
}

export function muteClip(clipId: string, muted: boolean): void {
    updateClip(clipId, (c) => ({ ...c, muted }));
}

export function setClipFollowAction(clipId: string, followAction: Clip['followAction']): void {
    updateClip(clipId, (c) => ({ ...c, followAction }));
}

export function crossfadeClips(clipAId: string, clipBId: string, durationBeats = 0.5): void {
    const state = getTrackState();
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

    mapAllTracks((t) => ({
        ...t,
        clips: t.clips.map((c) => {
            if (c.id === clipAId) {
                return { ...c, endBeat: newClipAEnd, fadeOutBeats: actualOverlap };
            }
            if (c.id === clipBId) {
                return { ...c, startBeat: newClipBStart, fadeInBeats: actualOverlap };
            }
            return c;
        }),
    }));
}

import { setNotesForClip } from '#/modules/Midi/useCases/midiNoteCrud';

export function createAlternativeClips(
    originalClipId: string,
    variationsData: Array<Array<{ pitch: number; startBeat: number; duration: number; velocity: number }>>
): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    let targetTrack: any = null;
    let originalClip: Clip | null = null;

    for (const track of state.tracks) {
        const clip = track.clips.find((c) => c.id === originalClipId);
        if (clip) {
            targetTrack = track;
            originalClip = clip;
            break;
        }
    }

    if (!targetTrack || !originalClip) {
        return;
    }

    const clipDuration = originalClip.endBeat - originalClip.startBeat;
    const newClips: Clip[] = [];

    let currentStart = originalClip.endBeat;
    for (const [index, variation] of variationsData.entries()) {
        const newClipId = `clip-var-${crypto.randomUUID().slice(0, 8)}`;

        const globalNotes = variation.map((n) => ({
            id: `note-${crypto.randomUUID().slice(0, 8)}`,
            pitch: n.pitch,
            startBeat: currentStart + n.startBeat,
            duration: n.duration,
            velocity: n.velocity,
            probability: 100,
        }));

        setNotesForClip(newClipId, globalNotes);

        newClips.push({
            ...originalClip,
            id: newClipId,
            name: `${originalClip.name} (Var ${index + 1})`,
            startBeat: currentStart,
            endBeat: currentStart + clipDuration,
            muted: true,
        });

        currentStart += clipDuration;
    }

    updateTrack(targetTrack.id, (t) => ({
        ...t,
        clips: [...t.clips, ...newClips],
    }));
}
