import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, redo, undo } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { chordTrackStore, type ChordTrackState } from '../../../stores/chordTrackStore';
import { getChordTrackHandlers } from '../../../useCases/getChordTrackHandlers';

const beforeState: ChordTrackState = {
    enabled: true,
    events: [
        { id: 'chord-a', beat: 4, root: 0, quality: 'major', duration: 2 },
        { id: 'chord-b', beat: 4, root: 7, quality: 'min7', duration: 6 },
    ],
};

type ChordMutationAction = Extract<
    AppAction,
    {
        type:
            | 'addChordEvent'
            | 'moveChordEvent'
            | 'updateChordEvent'
            | 'removeChordEvent'
            | 'toggleChordTrack'
            | 'clearChordTrack';
    }
>;

type ChordMutationCase = {
    action: ChordMutationAction;
    expected: ChordTrackState;
    label: string;
};

const mutationCases = [
    {
        label: 'add',
        action: {
            type: 'addChordEvent',
            payload: { eventId: 'chord-c', beat: 2, root: 5, quality: 'minor', duration: 4 },
        },
        expected: {
            enabled: true,
            events: [{ id: 'chord-c', beat: 2, root: 5, quality: 'minor', duration: 4 }, ...beforeState.events],
        },
    },
    {
        label: 'move',
        action: { type: 'moveChordEvent', payload: { eventId: 'chord-b', beat: 1 } },
        expected: {
            enabled: true,
            events: [{ ...beforeState.events[1]!, beat: 1 }, beforeState.events[0]!],
        },
    },
    {
        label: 'update',
        action: {
            type: 'updateChordEvent',
            payload: { eventId: 'chord-a', root: 14, quality: 'min9', duration: 0.1 },
        },
        expected: {
            enabled: true,
            events: [{ ...beforeState.events[0]!, root: 2, quality: 'min9', duration: 0.25 }, beforeState.events[1]!],
        },
    },
    {
        label: 'remove',
        action: { type: 'removeChordEvent', payload: { eventId: 'chord-a' } },
        expected: { enabled: true, events: [beforeState.events[1]!] },
    },
    {
        label: 'toggle',
        action: { type: 'toggleChordTrack', payload: { enabled: false } },
        expected: { enabled: false, events: beforeState.events },
    },
    {
        label: 'clear',
        action: { type: 'clearChordTrack' },
        expected: { enabled: true, events: [] },
    },
] satisfies ChordMutationCase[];

describe('chord-track action authority', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        registerHandlerMap(getChordTrackHandlers());
        clearUndoHistory();
        chordTrackStore.set(structuredClone(beforeState));
    });

    afterEach(() => {
        clearUndoHistory();
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
    });

    it.each(mutationCases)(
        '$label writes through one action and restores exact state on undo',
        async ({ action, expected }) => {
            await executeAppAction(action);

            expect(chordTrackStore.value).toEqual(expected);

            await undo();

            expect(chordTrackStore.value).toEqual(beforeState);

            await redo();

            expect(chordTrackStore.value).toEqual(expected);
        }
    );
});
