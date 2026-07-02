import { describe, it, expect, beforeEach } from 'vitest';

import { macroStore } from '../../../../stores/macroStore';
import { type AppAction } from '../../../commandQueries';
import { recordAction } from '../recordAction';

function startRecording(): void {
    macroStore.set({ macros: [], recording: true, currentRecording: [] });
}

describe('recordAction', () => {
    beforeEach(() => {
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
    });

    it('captures a non-meta action while recording', () => {
        startRecording();

        recordAction({ type: 'togglePlayback' });

        expect(macroStore.value?.currentRecording).toEqual([{ type: 'togglePlayback' }]);
    });

    it('does nothing when not recording', () => {
        recordAction({ type: 'togglePlayback' });

        expect(macroStore.value?.currentRecording).toEqual([]);
    });

    it('excludes macro meta-actions from the recording', () => {
        startRecording();

        const meta: AppAction[] = [
            { type: 'undo' },
            { type: 'redo' },
            { type: 'startMacroRecording' },
            { type: 'stopMacroRecording' },
            { type: 'playMacro', payload: { macroId: 'm1' } },
            { type: 'deleteMacro', payload: { macroId: 'm1' } },
            { type: 'renameMacro', payload: { macroId: 'm1', name: 'New name' } },
        ];

        for (const action of meta) {
            recordAction(action);
        }

        expect(macroStore.value?.currentRecording).toEqual([]);
    });

    it('does not leak renameMacro into recorded content', () => {
        startRecording();

        recordAction({ type: 'togglePlayback' });
        recordAction({ type: 'renameMacro', payload: { macroId: 'm1', name: 'Renamed' } });
        recordAction({ type: 'toggleLoop' });

        expect(macroStore.value?.currentRecording).toEqual([{ type: 'togglePlayback' }, { type: 'toggleLoop' }]);
    });
});
