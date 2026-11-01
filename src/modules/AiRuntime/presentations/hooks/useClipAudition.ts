import { useEffect, useRef, useState } from 'react';

import { logger } from '#/infra/logger/appLogger';
import { getTrackStoreState } from '#/modules/Arrangement/useCases';
import { audioEngine, playAuditionNote } from '#/modules/AudioEngine/useCases';
import { getNotesForClip } from '#/modules/MIDI/useCases';
import { DEFAULT_TEMPO_BPM } from '#/modules/Transport/stores';
import { getTransportState } from '#/modules/Transport/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { runAllEffects } from '#/utils/runEffects';

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
    const intent = audioEngine.beginAudioPreviewIntent();
    const trackExists = getTrackStoreState()?.tracks.some((track) => track.id === target.trackId) ?? false;
    const notes = getNotesForClip(target.clipId);
    if (!intent.isCurrent() || !trackExists || notes.length === 0) {
        intent.release();
        notifyUser('The generated clip is no longer in the project', 'info');
        return null;
    }
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const stopNotes: Array<() => void> = [];
    let stopped = false;
    const stop = () => {
        if (stopped) {
            return;
        }
        stopped = true;
        intent.signal.removeEventListener('abort', stop);
        for (const timer of timers) {
            clearTimeout(timer);
        }
        timers.clear();
        runAllEffects([...stopNotes.splice(0), () => intent.release(), onEnded]);
    };
    intent.signal.addEventListener('abort', stop, { once: true });
    const schedule = () => {
        if (stopped || !intent.isCurrent()) {
            stop();
            return;
        }
        // The group clock starts only after programme restoration; its child
        // notes keep this gesture identity and never preempt a newer A/B.
        const tempo = getTransportState()?.tempo ?? DEFAULT_TEMPO_BPM;
        const msPerBeat = MS_PER_MINUTE / tempo;
        let clipEndMs = 0;
        for (const note of notes) {
            clipEndMs = Math.max(clipEndMs, (note.startBeat + note.duration) * msPerBeat);
            const startTimer = setTimeout(() => {
                timers.delete(startTimer);
                if (stopped || !intent.isCurrent()) {
                    return;
                }
                const stopNote = playAuditionNote(target.trackId, note.pitch, note.velocity, intent);
                stopNotes.push(stopNote);
                const stopTimer = setTimeout(() => {
                    timers.delete(stopTimer);
                    stopNote();
                }, note.duration * msPerBeat);
                timers.add(stopTimer);
            }, note.startBeat * msPerBeat);
            timers.add(startTimer);
        }
        const endTimer = setTimeout(stop, clipEndMs);
        timers.add(endTimer);
    };
    if (intent.ready === undefined) {
        schedule();
    } else {
        void intent.ready.then(schedule).catch((error: unknown) => {
            stop();
            logger.warn(new Error('Clip audition could not restore its listening output', { cause: error }));
        });
    }
    return stop;
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
    const generation = useRef(0);

    const stopAudition = (): void => {
        generation.current++;
        stopRef.current?.();
        stopRef.current = null;
        setPlayingClipId(null);
    };

    const toggleAudition = (target: ClipAuditionTarget): void => {
        if (stopRef.current) {
            stopAudition();
            return;
        }
        const owner = ++generation.current;
        let ended = false;
        const stop = startClipAudition(target, () => {
            ended = true;
            if (generation.current === owner) {
                stopRef.current = null;
                setPlayingClipId(null);
            }
        });
        if (!stop || ended) {
            return;
        }
        stopRef.current = stop;
        setPlayingClipId(target.clipId);
    };

    // Unmounting (panel closed, task removed) must not leave notes sounding.
    useEffect(() => stopAudition, []);

    return { playingClipId, toggleAudition };
}
