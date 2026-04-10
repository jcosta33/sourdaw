import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { createHandler } from '#/helpers/createHandler';
import { setAutomationMode } from '#/modules/Arrangement/useCases/toggleTrackState/setAutomationMode';
import type { ExtractAction } from '../types';

const executeSetAutomationMode = inject({ setAutomationMode })(
    ({ setAutomationMode }) =>
        function executeSetAutomationMode(a: ExtractAction<AppAction, 'setAutomationMode'>): void {
            setAutomationMode(a.payload.trackId, a.payload.mode);
        }
);

export const handleSetAutomationMode = createHandler<'setAutomationMode'>({
    execute: executeSetAutomationMode,
    describe: (a) => ({ label: `Set automation mode: ${a.payload.mode}` }),
    undoable: true,
});
