import { inject } from '#/infra/di/inject';
import { type ActionHandler } from '#/modules/Command/useCases/commandQueries';
import { startMacroRecording, stopMacroRecording } from '#/modules/Command/useCases/macro/recording';
import { playMacro } from '#/modules/Command/useCases/macro/playback';
import { deleteMacro } from '#/modules/Command/useCases/macro/management';

export const executeStartMacroRecording = inject({ startMacroRecording })(
    ({ startMacroRecording }) =>
        async function executeStartMacroRecording(): Promise<void> {
            startMacroRecording();
        }
);

export const executeStopMacroRecording = inject({ stopMacroRecording })(
    ({ stopMacroRecording }) =>
        async function executeStopMacroRecording(action: { payload: { name: string } }): Promise<void> {
            stopMacroRecording(action.payload.name);
        }
);

export const executePlayMacro = inject({ playMacro })(
    ({ playMacro }) =>
        async function executePlayMacro(action: { payload: { macroId: string } }): Promise<void> {
            await playMacro(action.payload.macroId);
        }
);

export const executeDeleteMacro = inject({ deleteMacro })(
    ({ deleteMacro }) =>
        async function executeDeleteMacro(action: { payload: { macroId: string } }): Promise<void> {
            deleteMacro(action.payload.macroId);
        }
);

export const macroHandlers: Record<string, ActionHandler<any>> = {
    startMacroRecording: {
        execute: executeStartMacroRecording,
        undoable: false,
        describe: () => ({ label: 'Start Macro Recording' }),
    },
    stopMacroRecording: {
        execute: executeStopMacroRecording,
        undoable: false,
        describe: () => ({ label: 'Stop Macro Recording' }),
    },
    playMacro: {
        execute: executePlayMacro,
        undoable: false,
        describe: () => ({ label: 'Play Macro' }),
    },
    deleteMacro: {
        execute: executeDeleteMacro,
        undoable: true,
        describe: () => ({ label: 'Delete Macro' }),
    },
};
