import { describe, expect, it } from 'vitest';

import { type AppActionType } from '#/utils/handlerContract';

import { undoEntryStoresCommandIdByActionType } from '../../models/UndoEntryCommandIdPolicy';
import { readHandlerMintedApplicationIds } from '../readHandlerMintedApplicationIds';

const allActionTypes = Object.keys(undoEntryStoresCommandIdByActionType) as AppActionType[];

// Every field any reader consults, filled so that a reader present for an action type must answer.
const richArguments = {
    rowPlan: { before: [{ id: 'row-old' }], after: [{ id: 'row-old' }, { id: 'row-new' }] },
    targetClipId: 'clip-target',
    clipId: 'clip-kept',
    replacement: { clips: [{ id: 'clip-a' }], clipAutomationLanes: [{ id: 'lane-a' }] },
    plan: { replacement: { clips: [{ id: 'clip-b' }], clipAutomationLanes: [{ id: 'lane-b' }] } },
    addedNotes: [{ id: 'note-a' }],
    targetNoteIds: ['note-b'],
};

const actionTypesWithHandlerMintedIds = [
    'editTempoMap',
    'glueClips',
    'stripSilence',
    'quantizeTransients',
    'arpeggiate',
    'duplicateClipAt',
    'splitClip',
];

describe('readHandlerMintedApplicationIds', () => {
    it('reads handler-minted ids for exactly the action types that draw them', () => {
        const reading = allActionTypes.filter(
            (type) => readHandlerMintedApplicationIds(type, richArguments).length > 0
        );

        expect(new Set(reading)).toEqual(new Set(actionTypesWithHandlerMintedIds));
    });

    it('names each id by its argument path', () => {
        expect(readHandlerMintedApplicationIds('editTempoMap', richArguments)).toEqual([
            { argument: 'rowPlan.after[1].id', value: 'row-new' },
        ]);
        expect(readHandlerMintedApplicationIds('glueClips', richArguments)).toEqual([
            { argument: 'targetClipId', value: 'clip-target' },
            { argument: 'replacement.clipAutomationLanes[0].id', value: 'lane-a' },
        ]);
        expect(readHandlerMintedApplicationIds('stripSilence', richArguments)).toEqual([
            { argument: 'replacement.clips[0].id', value: 'clip-a' },
            { argument: 'replacement.clipAutomationLanes[0].id', value: 'lane-a' },
        ]);
        expect(readHandlerMintedApplicationIds('quantizeTransients', richArguments)).toEqual([
            { argument: 'plan.replacement.clips[0].id', value: 'clip-b' },
            { argument: 'plan.replacement.clipAutomationLanes[0].id', value: 'lane-b' },
        ]);
        expect(readHandlerMintedApplicationIds('arpeggiate', richArguments)).toEqual([
            { argument: 'addedNotes[0].id', value: 'note-a' },
        ]);
        expect(readHandlerMintedApplicationIds('duplicateClipAt', richArguments)).toEqual([
            { argument: 'targetClipId', value: 'clip-target' },
        ]);
        expect(readHandlerMintedApplicationIds('splitClip', richArguments)).toEqual([
            { argument: 'targetNoteIds[0]', value: 'note-b' },
        ]);
    });

    it('reads nothing for an operation that is not an action type, inherited names included', () => {
        for (const operation of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'noSuchAction', '']) {
            expect(readHandlerMintedApplicationIds(operation, richArguments)).toEqual([]);
        }
    });
});
