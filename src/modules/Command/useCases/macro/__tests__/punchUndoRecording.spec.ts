import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { getTransportHandlers, getTransportState, setPunchIn, setPunchOut } from '#/modules/Transport/useCases';

import { clearHandlerRegistry, registerHandlerMap } from '../../../stores/handlerRegistry';
import { macroStore } from '../../../stores/macroStore';
import { undoStore } from '../../../stores/undoStore';
import { clearUndoHistory } from '../../clearUndoHistory';
import { executeAppAction } from '../../executeAppAction';
import { undo } from '../../undo';
import { playMacro } from '../playback';
import { startMacroRecording } from '../recording/startMacroRecording';
import { stopMacroRecording } from '../recording/stopMacroRecording';

const STORAGE_KEY = 'sourdaw:macros';

function expect_punch_region(punchInBeat: number, punchOutBeat: number): void {
    const state = getTransportState();
    expect(state?.punchInBeat).toBe(punchInBeat);
    expect(state?.punchOutBeat).toBe(punchOutBeat);
}

function set_punch_region(punchInBeat: number, punchOutBeat: number): void {
    setPunchOut(punchOutBeat);
    setPunchIn(punchInBeat);
    expect_punch_region(punchInBeat, punchOutBeat);
}

describe('macro recording across punch undo', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        localStorage.removeItem(STORAGE_KEY);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        clearUndoHistory();
        clearHandlerRegistry();
        registerHandlerMap(getTransportHandlers());
        set_punch_region(0, 16);
    });

    afterEach(() => {
        clearUndoHistory();
        clearHandlerRegistry();
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        localStorage.removeItem(STORAGE_KEY);
        configureAutomergeStoragePort(null);
    });

    it('records only the user punch action and replays it against current state', async () => {
        startMacroRecording();

        await executeAppAction({ type: 'setPunchIn', payload: { beat: 20 } });
        expect_punch_region(20, 21);

        await undo();
        expect_punch_region(0, 16);

        stopMacroRecording('Crossing punch');

        const macro = macroStore.value?.macros[0];
        expect(macro).toBeDefined();
        if (!macro) {
            throw new Error('Expected recorded macro');
        }
        expect.soft(macro.actions).toEqual([{ type: 'setPunchIn', payload: { beat: 20 } }]);

        set_punch_region(4, 12);
        clearUndoHistory();

        await playMacro(macro.id);

        expect_punch_region(20, 21);
    });

    it('executes inverse-less macro actions outside the undoable subset', async () => {
        macroStore.set({
            macros: [
                {
                    id: 'mixed-macro',
                    name: 'Mixed macro',
                    actions: [
                        { type: 'setPunchIn', payload: { beat: 20 } },
                        { type: 'setTempo', payload: { bpm: 140 } },
                    ],
                    createdAt: 0,
                },
            ],
            recording: false,
            currentRecording: [],
        });

        await playMacro('mixed-macro');

        expect_punch_region(20, 21);
        expect(getTransportState()?.tempo).toBe(140);
        expect(undoStore.value?.past).toHaveLength(1);

        await undo();

        expect_punch_region(0, 16);
        expect(getTransportState()?.tempo).toBe(140);
    });
});
