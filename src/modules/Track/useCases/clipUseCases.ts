import { getTrackState, setTrackState, updateTrack, mapAllTracks } from '../repositories/trackRepository';
import { getTransportState } from '#/modules/Transport/useCases/transportQueries';
import { type Clip } from '../models/Track';
import { shiftClipAutomation, duplicateClipAutomation } from '#/modules/Track/useCases/automationUseCases';
import { shiftClipMidiNotes } from '#/modules/Track/useCases/midiNoteCrud';

let nextClipId = 1;

export function addClip(input: {
    trackId: string;
    startBeat: number;
    endBeat: number;
    name: string;
    type?: 'audio' | 'midi';
    audioBufferId?: string;
    isGhost?: boolean;
}): Clip | null {
    const state = getTrackState();
    if (!state) {
        return null;
    }

    const track = state.tracks.find((t) => t.id === input.trackId);
    const inferredType = input.type ?? (track?.kind === 'midi' ? 'midi' : 'audio');

    const clip: Clip = {
        id: `clip-${nextClipId++}`,
        trackId: input.trackId,
        name: input.name,
        startBeat: input.startBeat,
        endBeat: input.endBeat,
        type: inferredType,
        audioBufferId: input.audioBufferId,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1.0,
        color: '',
        locked: false,
        muted: false,
        isGhost: input.isGhost,
    };

    updateTrack(input.trackId, (t) => ({ ...t, clips: [...t.clips, clip] }));

    return clip;
}

export function acceptGhostClip(clipId: string): void {
    mapAllTracks((t) => ({
        ...t,
        clips: t.clips.map((c) => (c.id === clipId ? { ...c, isGhost: undefined } : c)),
    }));
}

export function dismissGhostClip(clipId: string): void {
    mapAllTracks((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clipId) }));
}

export function removeClip(clipId: string): void {
    mapAllTracks((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clipId) }));
}

export function moveClip(clipId: string, targetTrackId: string, startBeat: number, originalStartBeat?: number): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    let movedClip: Clip | undefined;
    let oldStartBeat: number | undefined;
    const tracksWithoutClip = state.tracks.map((t) => {
        const clip = t.clips.find((c) => c.id === clipId);
        if (clip) {
            oldStartBeat = clip.startBeat;
            movedClip = {
                ...clip,
                trackId: targetTrackId,
                startBeat,
                endBeat: startBeat + (clip.endBeat - clip.startBeat),
            };
        }
        return { ...t, clips: t.clips.filter((c) => c.id !== clipId) };
    });

    if (!movedClip || oldStartBeat === undefined) {
        return;
    }

    setTrackState({
        ...state,
        tracks: tracksWithoutClip.map((t) => (t.id === targetTrackId ? { ...t, clips: [...t.clips, movedClip!] } : t)),
    });

    const beatDelta = startBeat - (originalStartBeat ?? oldStartBeat);
    if (beatDelta !== 0) {
        shiftClipAutomation(clipId, beatDelta);
        shiftClipMidiNotes(clipId, beatDelta);
    }
}

export function moveClipPreview(clipId: string, targetTrackId: string, startBeat: number): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    let movedClip: Clip | undefined;
    let oldStartBeat: number | undefined;
    const tracksWithoutClip = state.tracks.map((t) => {
        const clip = t.clips.find((c) => c.id === clipId);
        if (clip) {
            oldStartBeat = clip.startBeat;
            const targetTrack = state.tracks.find((tr) => tr.id === targetTrackId);
            const effectiveTargetId =
                targetTrack &&
                ((clip.type === 'audio' && targetTrack.kind !== 'audio') ||
                    (clip.type === 'midi' && targetTrack.kind !== 'midi'))
                    ? t.id
                    : targetTrackId;
            movedClip = {
                ...clip,
                trackId: effectiveTargetId,
                startBeat,
                endBeat: startBeat + (clip.endBeat - clip.startBeat),
            };
        }
        return { ...t, clips: t.clips.filter((c) => c.id !== clipId) };
    });

    if (!movedClip || oldStartBeat === undefined) {
        return;
    }

    setTrackState({
        ...state,
        tracks: tracksWithoutClip.map((t) =>
            t.id === movedClip!.trackId ? { ...t, clips: [...t.clips, movedClip!] } : t
        ),
    });
}

export function duplicateClip(clipId: string): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    for (const track of state.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) {
            const duration = clip.endBeat - clip.startBeat;
            const newClip = addClip({
                trackId: track.id,
                startBeat: clip.endBeat,
                endBeat: clip.endBeat + duration,
                name: `${clip.name} (copy)`,
                type: clip.type,
                audioBufferId: clip.audioBufferId,
            });

            if (newClip) {
                duplicateClipAutomation(clipId, newClip.id);
            }
            return;
        }
    }
}

export function duplicateClipToNextBar(clipId: string): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    const transport = getTransportState();
    const beatsPerBar = transport?.timeSignatureNumerator ?? 4;

    for (const track of state.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) {
            const duration = clip.endBeat - clip.startBeat;
            const nextBarStart = Math.ceil(clip.endBeat / beatsPerBar) * beatsPerBar;
            const newClip = addClip({
                trackId: track.id,
                startBeat: nextBarStart,
                endBeat: nextBarStart + duration,
                name: `${clip.name} (copy)`,
                type: clip.type,
                audioBufferId: clip.audioBufferId,
            });

            if (newClip) {
                duplicateClipAutomation(clipId, newClip.id);
            }
            return;
        }
    }
}
