import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';

import { type Clip, type Track } from '../../models/Track';
import { expectAudibleRender } from '../../services/expectAudibleRender';
import { isSilentAudioBuffer, type SilenceScannableBuffer } from '../../services/isSilentAudioBuffer';
import { deriveEffectiveAudibility } from '../../stores/effectiveAudibility';
import { trackStore } from '../../stores/trackStore';

/** The operation about to persist the buffer, named in the refusal message. */
export type SilentBakeOperation = 'Freeze' | 'Bounce' | 'Flatten';

export type DetectSilentBakeInput = {
    track: Track;
    buffer: SilenceScannableBuffer;
    startBeat: number;
    endBeat: number;
    /** See `expectAudibleRender` — the fader value this render bakes, not `track.gain`. */
    bakedFaderGain: number;
    operation: SilentBakeOperation;
};

export type DetectSilentBakeOutput = { silentBake: false } | { silentBake: true; message: string };

function hasMidiNotesForClip(clipId: string): boolean {
    const notes = midiStore.value?.notesByClipId[clipId];
    return notes !== undefined && notes.length > 0;
}

function hasAudioSamplesForClip(clip: Clip): boolean {
    if (clip.audioBufferId === undefined) {
        return false;
    }
    // The very cache `scheduleTrackClips` reads when it decides whether an
    // audio clip reaches the offline graph, so this cannot disagree with it.
    return audioBufferCache.get(clip.audioBufferId) !== undefined;
}

function isSilencedInMix(trackId: string): boolean {
    const tracks = trackStore.value?.tracks ?? [];
    if (tracks.length === 0) {
        return false;
    }
    // The one authoritative mute ∪ solo planner, so this guard cannot disagree
    // with the engine about who is being listened to. Every project track owns
    // a strip here: freeze and bounce build their own graph rather than reusing
    // the live strips, so restricting the set would silently disengage solo.
    const audibility = deriveEffectiveAudibility({
        tracks,
        soloMode: workspaceStore.value?.soloMode ?? 'sip',
        stripTrackIds: new Set(tracks.map((candidate) => candidate.id)),
    });
    return audibility.audibleByTrackId.get(trackId) === false;
}

/**
 * Refuse a render that came back as digital silence over a track that had
 * every reason to sound.
 *
 * This is the backstop for the export-silence class of defect, not for any one
 * device: an instrument node that never starts, a worklet that fails to load, a
 * chain that resolves to a disconnected graph all land here identically, and
 * none of them had to be predicted. What makes it safe to refuse is
 * `expectAudibleRender`, which rules out every way the render was *supposed* to
 * be quiet before this reports anything.
 *
 * It matters most at the writes that cannot be walked back: flatten replaces a
 * track's clips and devices with the buffer, and a replace-bounce does the
 * same. Baking silence there destroys the MIDI and the instrument, recoverable
 * only through CRDT history the user has no reason to know they need.
 */
export function detectSilentBake({
    track,
    buffer,
    startBeat,
    endBeat,
    bakedFaderGain,
    operation,
}: DetectSilentBakeInput): DetectSilentBakeOutput {
    const expectation = expectAudibleRender({
        clips: track.clips,
        startBeat,
        endBeat,
        silencedInMix: isSilencedInMix(track.id),
        bakedFaderGain,
        hasMidiNotes: hasMidiNotesForClip,
        hasAudioSamples: hasAudioSamplesForClip,
    });
    // Checked before the buffer is scanned: a track that was meant to be quiet
    // needs no scan, and the scan is the only expensive half of this guard.
    if (!expectation.expectsAudio) {
        return { silentBake: false };
    }

    if (!isSilentAudioBuffer(buffer)) {
        return { silentBake: false };
    }

    return {
        silentBake: true,
        message:
            `Track "${track.name}" rendered as digital silence, but its clips and mixer state say it should ` +
            `have produced sound. ${operation} stopped rather than replacing the track with a silent buffer. ` +
            `Play the track back to confirm it sounds, then try again.`,
    };
}
