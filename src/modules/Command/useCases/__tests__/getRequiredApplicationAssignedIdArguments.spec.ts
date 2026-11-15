import { describe, expect, it } from 'vitest';

import { type AppActionType } from '#/utils/handlerContract';

import { COMMAND_APPLICATION_ID_RULES } from '../../models/CommandApplicationIdRule';
import { undoEntryStoresCommandIdByActionType } from '../../models/UndoEntryCommandIdPolicy';
import { getRequiredApplicationAssignedIdArguments } from '../getRequiredApplicationAssignedIdArguments';

const allActionTypes = Object.keys(undoEntryStoresCommandIdByActionType) as AppActionType[];

// Only the fields the argument-dependent readers consult, never a rule's own argument.
const readerArguments = {
    notes: [{}, {}],
    kind: 'midi',
    midiInputOwnerId: 'owner-1',
    folderAlternativeId: 'folder-alt',
    stems: [{ trackAlternativeId: 'stem-alt' }, {}],
};

const actionTypesWithArgumentReaders = ['addNotes', 'addTrack', 'createBus', 'armTrack', 'importStemSet'];

describe('getRequiredApplicationAssignedIdArguments', () => {
    it('answers from a reader for exactly the action types that name more than their rule argument', () => {
        const answering = allActionTypes.filter(
            (type) => getRequiredApplicationAssignedIdArguments(type, readerArguments).length > 0
        );

        expect(new Set(answering)).toEqual(new Set(actionTypesWithArgumentReaders));
    });

    it('lists the arguments each reader requires', () => {
        expect(getRequiredApplicationAssignedIdArguments('addNotes', readerArguments)).toEqual([
            'notes[0].id',
            'notes[1].id',
        ]);
        expect(getRequiredApplicationAssignedIdArguments('addTrack', readerArguments)).toEqual([
            'id',
            'initialAlternativeId',
            'initialDeviceId',
        ]);
        expect(getRequiredApplicationAssignedIdArguments('addTrack', { kind: 'audio' })).toEqual([
            'id',
            'initialAlternativeId',
        ]);
        expect(getRequiredApplicationAssignedIdArguments('createBus', {})).toEqual(['busId', 'initialAlternativeId']);
        expect(getRequiredApplicationAssignedIdArguments('armTrack', readerArguments)).toEqual(['midiInputOwnerId']);
        expect(getRequiredApplicationAssignedIdArguments('armTrack', {})).toEqual([]);
        expect(getRequiredApplicationAssignedIdArguments('importStemSet', readerArguments)).toEqual([
            'folderId',
            'folderAlternativeId',
            'stems[0].trackId',
            'stems[0].clipId',
            'stems[0].trackAlternativeId',
            'stems[1].trackId',
            'stems[1].clipId',
        ]);
    });

    it('falls back to the rule argument for every other action type that has one', () => {
        const readerTypes = new Set<string>(actionTypesWithArgumentReaders);
        const ruled = allActionTypes.filter((type) => !readerTypes.has(type) && COMMAND_APPLICATION_ID_RULES[type]);

        expect(ruled).toContain('createTrackAlternative');
        for (const type of ruled) {
            const argument = COMMAND_APPLICATION_ID_RULES[type]!.argument;

            expect(getRequiredApplicationAssignedIdArguments(type, { [argument]: 'minted' }), type).toEqual([argument]);
            expect(getRequiredApplicationAssignedIdArguments(type, { [argument]: 3 }), type).toEqual([]);
        }
    });

    it('requires nothing for a name that is not an action type, inherited names included', () => {
        for (const operation of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'noSuchAction', '']) {
            expect(getRequiredApplicationAssignedIdArguments(operation, { ...readerArguments, id: 'x' })).toEqual([]);
        }
    });
});
