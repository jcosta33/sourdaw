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
    'editMidiNotes',
    'insertAutomationLanePoints',
]);

describe('macroRecordingExcludesActionType', () => {
    it('excludes macro meta-actions, authority-bound MIDI note edits, and local automation insertions', () => {
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
