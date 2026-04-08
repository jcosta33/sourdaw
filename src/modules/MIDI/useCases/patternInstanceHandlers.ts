import { inject } from '#/infra/di/inject';
import { type ActionHandler } from '#/modules/Command/useCases/commandQueries';
import { createPatternInstance, detachPatternInstance } from '#/modules/MIDI/useCases/patternInstance';

export const executeCreatePatternInstance = inject({ createPatternInstance })(
    ({ createPatternInstance }) =>
        async function executeCreatePatternInstance(action: {
            payload: { sourceClipId: string; targetTrackId: string; startBeat: number };
        }): Promise<void> {
            createPatternInstance(action.payload.sourceClipId, action.payload.targetTrackId, action.payload.startBeat);
        }
);

export const executeDetachPatternInstance = inject({ detachPatternInstance })(
    ({ detachPatternInstance }) =>
        async function executeDetachPatternInstance(action: { payload: { clipId: string } }): Promise<void> {
            detachPatternInstance(action.payload.clipId);
        }
);

export const patternInstanceHandlers: Record<string, ActionHandler<any>> = {
    createPatternInstance: {
        execute: executeCreatePatternInstance,
        undoable: true,
        describe: () => ({ label: 'Create Pattern Instance' }),
    },
    detachPatternInstance: {
        execute: executeDetachPatternInstance,
        undoable: true,
        describe: () => ({ label: 'Detach Pattern Instance' }),
    },
};
