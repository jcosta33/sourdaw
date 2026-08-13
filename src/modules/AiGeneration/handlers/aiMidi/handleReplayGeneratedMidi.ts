import { addClip, getTrackStoreState, restoreTrackAtIndexWithDeferredAddedEvent } from '#/modules/Arrangement/useCases';
import { setNotesForClip } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type MidiClipNoteSnapshot } from '#/utils/handlerContract';

import { hasDurableMidiGenerationResult } from './hasDurableMidiGenerationResult';

type ReplayGeneratedMidiAction = Extract<AppAction, { type: 'replayGeneratedMidi' }>;
type ReplayOperation = ReplayGeneratedMidiAction['payload']['operation'];
type ReplayClip = ReplayOperation['clip'];

type ReplayTrackSnapshot = {
    id: string;
    kind: 'midi';
    clips: ReplayClip[];
};

function parseReplayTrack(operation: Extract<ReplayOperation, { kind: 'create-track' }>): ReplayTrackSnapshot | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(operation.trackJson);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
    }
    const candidate = parsed as Record<string, unknown>;
    if (candidate.id !== operation.clip.trackId || candidate.kind !== 'midi' || !Array.isArray(candidate.clips)) {
        return null;
    }
    if (candidate.clips.length !== 1) {
        return null;
    }
    const clip: unknown = candidate.clips[0];
    if (!clip || typeof clip !== 'object' || Array.isArray(clip)) {
        return null;
    }
    const replayClip = clip as Record<string, unknown>;
    if (
        replayClip.id !== operation.clip.id ||
        replayClip.trackId !== operation.clip.trackId ||
        replayClip.name !== operation.clip.name ||
        replayClip.startBeat !== operation.clip.startBeat ||
        replayClip.endBeat !== operation.clip.endBeat ||
        replayClip.type !== 'midi'
    ) {
        return null;
    }
    return parsed as ReplayTrackSnapshot;
}

function isExactClipResult(input: {
    trackId: string;
    clip: ReplayClip;
    notes: readonly MidiClipNoteSnapshot[];
}): boolean {
    return hasDurableMidiGenerationResult({
        trackId: input.trackId,
        clip: input.clip,
        notes: input.notes,
        noteMatch: 'exact',
    });
}

function hasClipIdCollision(clipId: string): boolean {
    return getTrackStoreState()?.tracks.some((track) => track.clips.some((clip) => clip.id === clipId)) ?? true;
}

function createClipWithNotes(input: {
    trackId: string;
    clip: ReplayClip;
    notes: readonly MidiClipNoteSnapshot[];
}): boolean {
    const clip = addClip({
        id: input.clip.id,
        trackId: input.trackId,
        startBeat: input.clip.startBeat,
        endBeat: input.clip.endBeat,
        name: input.clip.name,
        type: 'midi',
    });
    if (!clip || clip.id !== input.clip.id) {
        return false;
    }
    setNotesForClip(
        clip.id,
        input.notes.map((note) => ({ ...note }))
    );
    return true;
}

function isReplaySourceCurrent(operation: Extract<ReplayOperation, { kind: 'create-clip' | 'create-track' }>): boolean {
    const source = operation.source;
    if (source.clip.trackId !== source.trackId) {
        return false;
    }
    return isExactClipResult({
        trackId: source.trackId,
        clip: source.clip,
        notes: source.notes,
    });
}

export const handleReplayGeneratedMidi = createHandler<'replayGeneratedMidi'>({
    execute: (action) => {
        const operation = action.payload.operation;
        if (operation.kind === 'replace-notes') {
            if (operation.clip.trackId !== operation.trackId) {
                return { status: 'conflict' };
            }
            if (
                isExactClipResult({
                    trackId: operation.trackId,
                    clip: operation.clip,
                    notes: operation.replacementNotes,
                })
            ) {
                return { status: 'no-write' };
            }
            if (
                !isExactClipResult({
                    trackId: operation.trackId,
                    clip: operation.clip,
                    notes: operation.expectedNotes,
                })
            ) {
                return { status: 'conflict' };
            }
            setNotesForClip(
                operation.clip.id,
                operation.replacementNotes.map((note) => ({ ...note }))
            );
            return { status: 'written' };
        }

        if (!isReplaySourceCurrent(operation) || hasClipIdCollision(operation.clip.id)) {
            return { status: 'conflict' };
        }

        if (operation.kind === 'create-clip') {
            if (operation.clip.trackId !== operation.targetTrackId) {
                return { status: 'conflict' };
            }
            const targetTrack = getTrackStoreState()?.tracks.find((track) => track.id === operation.targetTrackId);
            if (targetTrack?.kind !== 'midi') {
                return { status: 'conflict' };
            }
            if (!createClipWithNotes({ trackId: targetTrack.id, clip: operation.clip, notes: operation.notes })) {
                return { status: 'conflict' };
            }
            return { status: 'written' };
        }

        const replayTrack = parseReplayTrack(operation);
        if (!replayTrack) {
            return { status: 'conflict' };
        }
        if (getTrackStoreState()?.tracks.some((track) => track.id === replayTrack.id) ?? true) {
            return { status: 'conflict' };
        }
        const trackCreation = restoreTrackAtIndexWithDeferredAddedEvent({
            trackJson: operation.trackJson,
            trackIndex: operation.trackIndex,
        });
        if (!trackCreation || trackCreation.track.id !== replayTrack.id) {
            return { status: 'conflict' };
        }
        setNotesForClip(
            operation.clip.id,
            operation.notes.map((note) => ({ ...note }))
        );
        return {
            status: 'written',
            afterCommit: trackCreation.afterCommit,
            afterAmbiguousCommit: trackCreation.afterAmbiguousCommit,
        };
    },
    describe: () => ({ label: 'Replay generated MIDI' }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
