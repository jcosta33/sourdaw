import { type ActionHandler } from './commandQueries';
import { startMacroRecording, stopMacroRecording } from '../useCases/macro/recording';
import { playMacro } from '../useCases/macro/playback';
import { deleteMacro } from '../useCases/macro/management';

export const macroHandlers: Record<string, ActionHandler<any>> = {
    startMacroRecording: {
        execute: async () => {
            startMacroRecording();
        },
        undoable: false,
        describe: () => ({ label: 'Start Macro Recording' }),
    },
    stopMacroRecording: {
        execute: async (action: { payload: { name: string } }) => {
            stopMacroRecording(action.payload.name);
        },
        undoable: false,
        describe: () => ({ label: 'Stop Macro Recording' }),
    },
    playMacro: {
        execute: async (action: { payload: { macroId: string } }) => {
            await playMacro(action.payload.macroId);
        },
        undoable: false,
        describe: () => ({ label: 'Play Macro' }),
    },
    deleteMacro: {
        execute: async (action: { payload: { macroId: string } }) => {
            deleteMacro(action.payload.macroId);
        },
        undoable: true,
        describe: () => ({ label: 'Delete Macro' }),
    },
};
