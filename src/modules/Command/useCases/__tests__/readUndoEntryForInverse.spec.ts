import { afterEach, describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { undoStore } from '../../stores/undoStore';
import { createUndoEntry } from '../createUndoEntry';
import { readUndoEntryForInverse } from '../readUndoEntryForInverse';

const inverse: AppAction = { type: 'discardRecording', payload: { clipId: 'recorded' } };
function recordingEntry() {
    const clip = {
        id: 'recorded',
        trackId: 'original-a',
        name: 'Recorded',
        startBeat: 0,
        endBeat: 4,
        type: 'audio' as const,
        gain: 1,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        color: '',
        locked: false,
        muted: false,
    };
    return createUndoEntry('Recording', { type: 'commitRecording', payload: { clip } }, inverse, 'manual', {
        type: 'restoreRecording',
        payload: {
            clip,
            retiredTakeLanes: [],
            midiNotesSnapshot: null,
            midiCcSnapshot: null,
            midiPitchBendSnapshot: null,
        },
    });
}

afterEach(() => undoStore.set({ past: [], future: [] }));

describe('readUndoEntryForInverse', () => {
    it.each(['past', 'future'] as const)('reads the original capture from an exact pending inverse in %s', (stack) => {
        const entry = recordingEntry();
        undoStore.set({ past: [], future: [], [stack]: [entry] });
        expect(readUndoEntryForInverse(inverse)).toEqual({
            action: entry.action,
            inverseAction: entry.inverseAction,
            redoAction: entry.redoAction,
        });
    });
    it('returns null for absent, detached, and callback associations', () => {
        expect(readUndoEntryForInverse(inverse)).toBeNull();
        const callback = {
            id: 'callback',
            kind: 'callback' as const,
            label: 'Callback',
            source: 'manual' as const,
            timestamp: 0,
            undo: () => undefined,
            redo: () => undefined,
            inverseAction: inverse,
        };
        undoStore.set({ past: [callback], future: [] });
        expect(readUndoEntryForInverse(inverse)).toBeNull();
        undoStore.set({ past: [recordingEntry(), callback], future: [] });
        expect(readUndoEntryForInverse(inverse)?.action.type).toBe('commitRecording');
        expect(readUndoEntryForInverse(structuredClone(inverse))).toBeNull();
    });
    it('refuses multiple occurrences across either live stack, including the same entry twice', () => {
        const entry = recordingEntry();
        undoStore.set({ past: [entry], future: [recordingEntry()] });
        expect(readUndoEntryForInverse(inverse)).toBeNull();
        undoStore.set({ past: [entry, entry], future: [] });
        expect(readUndoEntryForInverse(inverse)).toBeNull();
    });
    it('rechecks a reconstructed current inverse instead of retaining the retired object association', () => {
        const entry = recordingEntry();
        const fresh = structuredClone(inverse);
        entry.inverseAction = fresh;
        undoStore.set({ past: [entry], future: [] });
        expect(readUndoEntryForInverse(inverse)).toBeNull();
        expect(readUndoEntryForInverse(fresh)?.action).toEqual(entry.action);
    });
    it('clones all returned actions and never lends the live capture to a caller', () => {
        const entry = recordingEntry();
        undoStore.set({ past: [entry], future: [] });
        const captured = structuredClone({
            action: entry.action,
            inverseAction: entry.inverseAction,
            redoAction: entry.redoAction,
        });
        const result = readUndoEntryForInverse(inverse);
        if (
            result?.action.type !== 'commitRecording' ||
            result.inverseAction?.type !== 'discardRecording' ||
            result.redoAction?.type !== 'restoreRecording'
        ) {
            throw new Error('expected recording capture');
        }
        expect(result.action).not.toBe(entry.action);
        expect(result.inverseAction).not.toBe(inverse);
        expect(result.redoAction).not.toBe(entry.redoAction);
        result.action.payload.clip = { ...result.action.payload.clip, trackId: 'peer-b' };
        result.inverseAction.payload.clipId = 'other';
        result.redoAction.payload.clip = { ...result.redoAction.payload.clip, trackId: 'peer-b' };
        expect(readUndoEntryForInverse(inverse)).toEqual(captured);
        expect(entry.action.type === 'commitRecording' && entry.action.payload.clip.trackId).toBe('original-a');
    });
});
