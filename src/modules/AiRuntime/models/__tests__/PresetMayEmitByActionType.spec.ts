import { describe, expect, it } from 'vitest';

import { presetMayEmitByActionType } from '../PresetMayEmitByActionType';

describe('presetMayEmitByActionType', () => {
    it('withholds exactly the note transforms and punch enabling from presets', () => {
        const withheld = Object.entries(presetMayEmitByActionType)
            .filter(([, mayEmit]) => !mayEmit)
            .map(([type]) => type);

        expect(withheld.toSorted()).toEqual([
            'invertNotes',
            'quantizeNoteLengths',
            'quantizeNotes',
            'retrogradeNotes',
            'scaleAllVelocities',
            'setAllVelocities',
            'setPunchEnabled',
            'transposeNotes',
        ]);
    });

    it('lets a preset emit an action type the list does not name', () => {
        expect(presetMayEmitByActionType.togglePlayback).toBe(true);
    });
});
