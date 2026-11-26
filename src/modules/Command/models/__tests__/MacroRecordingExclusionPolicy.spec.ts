import { describe, expect, it } from 'vitest';

import { macroRecordingExcludesActionType } from '../MacroRecordingExclusionPolicy';

const EXPECTED = new Set<string>([
    'undo',
    'redo',
    'startMacroRecording',
    'stopMacroRecording',
    'playMacro',
    'deleteMacro',
    'renameMacro',
    'insertAutomationLanePoints',
    'setLevainIdentity',
    'setToasterFactoryKit',
    'setBacteriaFactoryPatch',
    'setGlutenFactoryPreset',
    'setGrinderFactoryPreset',
    'setProofPatchSelection',
]);

describe('macroRecordingExcludesActionType', () => {
    it('excludes the macro meta-actions and local project edits', () => {
        const actual = new Set(
            Object.entries(macroRecordingExcludesActionType)
                .filter(([, value]) => value)
                .map(([type]) => type)
        );
        expect(actual).toEqual(EXPECTED);
    });

    it('does not read an inherited name as set', () => {
        expect(Object.hasOwn(macroRecordingExcludesActionType, 'constructor')).toBe(false);
        expect(Object.hasOwn(macroRecordingExcludesActionType, 'toString')).toBe(false);
    });
});
