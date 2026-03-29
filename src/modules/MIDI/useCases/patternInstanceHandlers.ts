import { type ActionHandler } from '#/modules/Command/useCases/commandQueries';
import {
    createPatternInstance,
    detachPatternInstance,
} from '#/modules/MIDI/useCases/patternInstance';

export const patternInstanceHandlers: Record<string, ActionHandler<any>> = {
    createPatternInstance: {
        execute: async (action: { payload: { sourceClipId: string; targetTrackId: string; startBeat: number } }) => {
            createPatternInstance(action.payload.sourceClipId, action.payload.targetTrackId, action.payload.startBeat);
        },
        undoable: true,
        describe: () => ({ label: 'Create Pattern Instance' }),
    },
    detachPatternInstance: {
        execute: async (action: { payload: { clipId: string } }) => {
            detachPatternInstance(action.payload.clipId);
        },
        undoable: true,
        describe: () => ({ label: 'Detach Pattern Instance' }),
    },
};
