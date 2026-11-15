import { describe, expect, it } from 'vitest';

import { type AppActionType } from '#/utils/handlerContract';

import { undoEntryStoresCommandIdByActionType } from '../../models/UndoEntryCommandIdPolicy';
import { hasDeterministicSerializedArguments } from '../hasDeterministicSerializedArguments';

const allActionTypes = Object.keys(undoEntryStoresCommandIdByActionType) as AppActionType[];

const actionTypesRequiringMintedArguments = [
    'addTrack',
    'createBus',
    'duplicateClip',
    'duplicateClipToNextBar',
    'duplicateTrack',
];

describe('hasDeterministicSerializedArguments', () => {
    it('refuses empty arguments for exactly the action types that need minted ones', () => {
        const refusing = allActionTypes.filter((type) => !hasDeterministicSerializedArguments(type, {}));

        expect(new Set(refusing)).toEqual(new Set(actionTypesRequiringMintedArguments));
    });

    it('accepts an addTrack and a createBus that carry every minted argument', () => {
        expect(
            hasDeterministicSerializedArguments('addTrack', {
                id: 'track-1',
                initialAlternativeId: 'alt-1',
                color: '#fff',
                kind: 'audio',
            })
        ).toBe(true);
        expect(
            hasDeterministicSerializedArguments('createBus', {
                busId: 'bus-1',
                initialAlternativeId: 'alt-1',
                color: '#fff',
            })
        ).toBe(true);
    });

    it('requires a midi track to carry its initial device id', () => {
        const midiTrack = { id: 'track-1', initialAlternativeId: 'alt-1', color: '#fff', kind: 'midi' };

        expect(hasDeterministicSerializedArguments('addTrack', midiTrack)).toBe(false);
        expect(hasDeterministicSerializedArguments('addTrack', { ...midiTrack, initialDeviceId: 'device-1' })).toBe(
            true
        );
    });

    it('refuses a blank minted argument', () => {
        expect(
            hasDeterministicSerializedArguments('createBus', {
                busId: '  ',
                initialAlternativeId: 'alt-1',
                color: '#fff',
            })
        ).toBe(false);
    });

    it('never accepts a duplicate, whatever it carries', () => {
        for (const type of ['duplicateClip', 'duplicateClipToNextBar', 'duplicateTrack'] as const) {
            expect(hasDeterministicSerializedArguments(type, { id: 'x', clipId: 'y' }), type).toBe(false);
        }
    });
});
