import { useEffect, useRef, useState } from 'react';

import { getTrackStoreState } from '#/modules/Arrangement/useCases';
import { playAuditionNote } from '#/modules/AudioEngine/useCases';
import { getNotesForClip } from '#/modules/MIDI/useCases';
import { getTransportState } from '#/modules/Transport/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

export type ClipAuditionTarget = {
    clipId: string;
    trackId: string;
};

const MS_PER_MINUTE = 60_000;

/**
 * Auditions one committed clip through `playAuditionNote` — the same per-note
 * audition use case the piano roll uses — scheduling each of the clip's notes
 * at its beat offset under the current transport tempo. Returns the stop
 * function that clears pending notes and silences the ones already started, or
 * null when there is nothing to audition because the clip or its track is no
 * longer in the project, in which case the user is told why.
 */
export function startClipAudition(target: ClipAuditionTarget, onEnded: () => void): (() => void) | null {
    const trackExists = getTrackStoreState()?.tracks.some((track) => track.id === target.trackId) ?? false;
    const notes = getNotesForClip(target.clipId);
    if (!trackExists || notes.length === 0) {
        notifyUser('The generated clip is no longer in the project', 'info');
        return null;
    }

    const tempo = getTransportState()?.tempo ?? 120;
    const msPerBeat = MS_PER_MINUTE / tempo;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const stopNoteFns: Array<() => void> = [];

    let clipEndMs = 0;
    for (const note of notes) {
        const endMs = (note.startBeat + note.duration) * msPerBeat;
        if (endMs > clipEndMs) {
            clipEndMs = endMs;
        }
    }

    for (const note of notes) {
        const startTimer = setTimeout(() => {
            timers.delete(startTimer);
            const stopNote = playAuditionNote(target.trackId, note.pitch, note.velocity);
            stopNoteFns.push(stopNote);
            const stopTimer = setTimeout(() => {
                timers.delete(stopTimer);
                stopNote();
            }, note.duration * msPerBeat);
            timers.add(stopTimer);
        }, note.startBeat * msPerBeat);
        timers.add(startTimer);
    }

    const endTimer = setTimeout(() => {
        timers.delete(endTimer);
        onEnded();
    }, clipEndMs);

    return () => {
        for (const timer of timers) {
            clearTimeout(timer);
        }
        timers.clear();
        for (const stopNote of stopNoteFns.splice(0)) {
            stopNote();
        }
    };
}

export type ClipAudition = {
    /** Clip id currently sounding, or null while silent. */
    playingClipId: string | null;
    /** Starts the clip's audition, or stops it when that clip is playing. */
    toggleAudition: (target: ClipAuditionTarget) => void;
};

export function useClipAudition(): ClipAudition {
    const [playingClipId, setPlayingClipId] = useState<string | null>(null);
    const stopRef = useRef<(() => void) | null>(null);

    const stopAudition = (): void => {
        stopRef.current?.();
        stopRef.current = null;
        setPlayingClipId(null);
    };

    const toggleAudition = (target: ClipAuditionTarget): void => {
        if (stopRef.current) {
            stopAudition();
            return;
        }
        const stop = startClipAudition(target, () => {
            stopRef.current = null;
            setPlayingClipId(null);
        });
        if (!stop) {
            return;
        }
        stopRef.current = stop;
        setPlayingClipId(target.clipId);
    };

    // Unmounting (panel closed, task removed) must not leave notes sounding.
    useEffect(() => stopAudition, []);

    return { playingClipId, toggleAudition };
}
