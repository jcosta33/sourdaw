import { afterEach, describe, expect, it } from 'vitest';

import { undoHistoryStore, type UndoHistoryStoreState } from '#/modules/Command/stores';
import { type AppAction } from '#/utils/handlerContract';

import { ClipDummy } from '../../__tests__/ClipDummy';
import { TrackDummy } from '../../__tests__/TrackDummy';
import { isAudioBufferReferencedByUndoHistory } from '../isAudioBufferReferencedByUndoHistory';
import { readUndoHistoryAudioBufferIds } from '../readUndoHistoryAudioBufferIds';
import { timeOperationStateCodec } from '../timeOperations/timeOperationStateCodec';

type UndoHistoryEntry = UndoHistoryStoreState['past'][number];

function actionEntry(id: string, action: AppAction, inverseAction: AppAction | null): UndoHistoryEntry {
    return { id, label: id, timestamp: 0, source: 'manual', kind: 'action', action, inverseAction };
}

function callbackEntry(id: string, restoresBufferIds?: readonly string[]): UndoHistoryEntry {
    return {
        id,
        label: id,
        timestamp: 0,
        source: 'manual',
        kind: 'callback',
        undo: () => undefined,
        redo: () => undefined,
        ...(restoresBufferIds ? { restoresBufferIds } : {}),
    };
}

function restoreClipAction(clipId: string, bufferId: string): AppAction {
    const clipSnapshot = ClipDummy.create({ id: clipId, trackId: 'track-1', audioBufferId: bufferId });
    return { type: 'restoreClip', payload: { clipId, trackId: 'track-1', clipSnapshot } };
}

/** `removeClip` as the handler records it: the inverse carries the whole clip. */
function removeClipEntry(id: string, bufferId: string): UndoHistoryEntry {
    const clipId = `clip-${id}`;
    return actionEntry(id, { type: 'removeClip', payload: { clipId } }, restoreClipAction(clipId, bufferId));
}

function encodedTrackState(bufferId: string): unknown {
    const encoded = timeOperationStateCodec.encodeTrackState({
        tracks: [
            TrackDummy.create({
                id: 'track-1',
                clips: [ClipDummy.create({ id: 'clip-encoded', trackId: 'track-1', audioBufferId: bufferId })],
            }),
        ],
        selectedTrackId: 'track-1',
        ghostClips: [],
    });
    if (!encoded) {
        throw new Error('Expected an encodable track state');
    }
    return encoded;
}

describe('readUndoHistoryAudioBufferIds', () => {
    afterEach(() => {
        undoHistoryStore.set({ past: [], future: [] });
    });

    it('reads the clip an undo of a delete restores and the clip a redo re-adds', () => {
        undoHistoryStore.set({ past: [removeClipEntry('deleted', 'buf-deleted')], future: [] });
        expect(readUndoHistoryAudioBufferIds()).toEqual(new Set(['buf-deleted']));

        // The same entry undone: it now waits in `future`, and its redo leg
        // still names the clip.
        undoHistoryStore.set({ past: [], future: [removeClipEntry('deleted', 'buf-deleted')] });
        expect(isAudioBufferReferencedByUndoHistory('buf-deleted')).toBe(true);
    });

    it('reads a frozen take that only a freeze restore names', () => {
        // Undoing an unfreeze puts `frozenBufferId` back; no clip carries it.
        const unfrozen = { frozen: false, freezeState: { status: 'unfrozen' as const } };
        const frozen = {
            frozen: true,
            frozenBufferId: 'freeze-take',
            freezeState: { status: 'frozen' as const, freezeId: 'freeze-take', frozenBufferId: 'freeze-take' },
        };
        undoHistoryStore.set({
            past: [
                actionEntry(
                    'unfreeze',
                    { type: 'unfreezeTrack', payload: { trackId: 'track-1' } },
                    {
                        type: 'restoreFreezeState',
                        payload: { trackId: 'track-1', expected: unfrozen, replacement: frozen },
                    }
                ),
            ],
            future: [],
        });
        expect(readUndoHistoryAudioBufferIds()).toEqual(new Set(['freeze-take']));
    });

    it('reads a clip inside a codec-encoded time-operation plan', () => {
        const plan = { version: 1, local: { expected: { trackState: encodedTrackState('buf-encoded') } } };
        undoHistoryStore.set({
            past: [
                actionEntry(
                    'delete-time',
                    { type: 'restoreTimeOperationState', payload: { plan } },
                    { type: 'restoreTimeOperationState', payload: { plan } }
                ),
            ],
            future: [],
        });
        expect(readUndoHistoryAudioBufferIds()).toEqual(new Set(['buf-encoded']));
    });

    it('reads a callback entry by its declaration only', () => {
        undoHistoryStore.set({
            past: [callbackEntry('bounce', ['buf-bounce', 'buf-source']), callbackEntry('automation')],
            future: [],
        });
        expect(readUndoHistoryAudioBufferIds()).toEqual(new Set(['buf-bounce', 'buf-source']));
    });

    it('ignores ids that no buffer field names', () => {
        undoHistoryStore.set({
            past: [
                actionEntry('rename', { type: 'renameClip', payload: { clipId: 'buf-like', name: 'buf-like' } }, null),
            ],
            future: [],
        });
        expect(readUndoHistoryAudioBufferIds()).toEqual(new Set());
    });

    it('drops an entry’s ids once the entry leaves the history', () => {
        undoHistoryStore.set({
            past: [removeClipEntry('kept', 'buf-kept')],
            future: [removeClipEntry('gone', 'buf-gone')],
        });
        expect(readUndoHistoryAudioBufferIds()).toEqual(new Set(['buf-kept', 'buf-gone']));

        // A new edit clears `future`; a project change clears both stacks.
        undoHistoryStore.set({ past: [removeClipEntry('kept', 'buf-kept')], future: [] });
        expect(readUndoHistoryAudioBufferIds()).toEqual(new Set(['buf-kept']));
        undoHistoryStore.set({ past: [], future: [] });
        expect(readUndoHistoryAudioBufferIds()).toEqual(new Set());
    });

    it('rereads an entry whose inverse a redo replaced in place', () => {
        const entry = removeClipEntry('redone', 'buf-before');
        undoHistoryStore.set({ past: [entry], future: [] });
        expect(readUndoHistoryAudioBufferIds()).toEqual(new Set(['buf-before']));

        // `commitRedoInverseCapture` assigns the fresh inverse onto the entry
        // without publishing a new store value.
        if (entry.kind !== 'action') {
            throw new Error('Expected an action entry');
        }
        entry.inverseAction = restoreClipAction('clip-redone', 'buf-after');
        expect(readUndoHistoryAudioBufferIds()).toEqual(new Set(['buf-after']));
    });
});
