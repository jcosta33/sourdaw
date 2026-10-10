import { cacheAudioBuffer, getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { clearClipPitchAnalysis } from '#/modules/Knead/useCases';
import { readTempoAtBeat } from '#/modules/Transport/stores';
import { restampLoopOriginEntry } from '#/utils/clipLoopOrigin';

import { getTrackState } from '../../repositories/track/getTrackState';
import { updateClip } from '../../repositories/track/updateClip';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';

import { reversedClipAudioOffsetBeats } from './reversedClipAudioOffsetBeats';

/**
 * `reversedBufferId` is resolved by the command layer before dispatch rather than minted
 * here, so the handler's `describe()` can name the buffer this run will produce and guard
 * its inverse on it. A caller outside the command path may omit it.
 */
export function reverseClip(clipId: string, reversedBufferId?: string): boolean {
    const target = resolveEligibleClipWriteTarget({ clipId });
    if (target.status !== 'eligible' || !('clipId' in target)) {
        return false;
    }

    const state = getTrackState();
    if (!state) {
        return false;
    }

    const track = state.tracks.find((candidate) => candidate.id === target.trackId);
    const clip = track?.clips.find((candidate) => candidate.id === target.clipId);
    if (!clip || clip.type !== 'audio' || !clip.audioBufferId) {
        return false;
    }

    const buffer = getCachedAudioBuffer({ bufferId: clip.audioBufferId });
    if (!buffer) {
        return false;
    }

    const context = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    const reversed = context.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const source = buffer.getChannelData(channel);
        const destination = reversed.getChannelData(channel);
        for (let index = 0; index < source.length; index++) {
            destination[index] = source[source.length - 1 - index]!;
        }
    }

    const newId = reversedBufferId ?? `reversed-${clip.audioBufferId}-${Date.now()}`;
    const clipTempo = readTempoAtBeat({ beat: clip.startBeat });
    const didWrite = updateClip(target.clipId, (candidate) => {
        cacheAudioBuffer({ buffer: reversed, bufferId: newId });
        const remappedAudioOffsetBeats = reversedClipAudioOffsetBeats({
            audioOffsetBeats: candidate.audioOffsetBeats ?? 0,
            clipLengthBeats: candidate.endBeat - candidate.startBeat,
            bufferLength: buffer.length,
            sampleRate: buffer.sampleRate,
            tempo: clipTempo,
            stretchMode: candidate.stretchMode,
            stretchRatio: candidate.stretchRatio,
        });
        const reversedClip = {
            ...candidate,
            audioBufferId: newId,
            name: `${candidate.name} (reversed)`,
            // The audio now plays back-to-front, so the fades trade places: the
            // fade-in drawn at the head is a fade-out over the reversed tail.
            fadeInBeats: candidate.fadeOutBeats,
            fadeOutBeats: candidate.fadeInBeats,
            // The reversed buffer is a fresh media basis — a new buffer holding
            // the mirrored whole source — and the remapped offset above names
            // its window head: `S − offset − consumed`, the head of the
            // mirrored visible window. The audio-fragment carry law keeps an
            // anchor only while the offset advances with the head by the same
            // delta the advance grows by, so the region readers recover,
            // `audioOffsetBeats − (startBeat − loopOriginBeat)`, survives the
            // move; reverse breaks that premise — the offset remaps instead of
            // advancing — and a carried anchor mixes the old basis's advance
            // into the new one, shifting the recovered region to
            // `S − offset − consumed − advance` and reading mirrored material
            // the loop never covered (#5198: region [2,6) where the mirrored
            // window opens at 3). The MIDI-fragment law therefore applies: the
            // anchor that reads the fresh basis correctly is the clip's own
            // start — advance zero, the loop window opening at the mirrored
            // head. Restamp rather than clear: the reads are identical today,
            // but a restamped anchor keeps later trims of the reversed clip
            // lawful — the window still opens at the head — where a cleared
            // anchor silently reverts those trims to the pre-anchor slide.
            // Key absent for an unanchored source, per the entry law.
            //
            // Composition: the offset remap is an involution (`o → S − o − c →
            // o`), so a second reverse restores buffer, fades and offset
            // exactly — but this restamp cannot compose to identity. It is
            // forced (advance must be zero for the loop window to open at the
            // mirrored head) and it is not injective in the anchor: pre-states
            // differing only in the anchor share one offset, so both map to
            // the same mirrored state and the pre-reverse advance is
            // unrecoverable from the mirrored clip alone. A direct second
            // reverse therefore re-restamps at the start and collapses a
            // nonzero advance to zero; the inverse payloads carry the
            // pre-reverse anchor (`handleReverseClip`), so undo/redo
            // round-trips it exactly and recovers the original read.
            ...restampLoopOriginEntry(candidate, candidate.startBeat),
        };
        if (remappedAudioOffsetBeats === undefined) {
            return reversedClip;
        }
        return { ...reversedClip, audioOffsetBeats: remappedAudioOffsetBeats };
    });
    if (!didWrite) {
        return false;
    }

    clearClipPitchAnalysis(target.clipId);
    return true;
}
