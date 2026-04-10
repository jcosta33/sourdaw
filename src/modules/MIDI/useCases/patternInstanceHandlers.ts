import { createPatternInstance, detachPatternInstance } from './patternInstance';

type MidiHandlerResult = {
    label: string;
};

type MidiHandler<Action> = {
    execute: (action: Action) => void | Promise<void>;
    describe: (action: Action) => MidiHandlerResult;
    undoable: boolean;
};

type PatternInstanceAction =
    | { type: 'createPatternInstance'; payload: { sourceClipId: string; targetTrackId: string; startBeat: number } }
    | { type: 'detachPatternInstance'; payload: { clipId: string } };

type PatternInstanceActionOf<ActionType extends PatternInstanceAction['type']> = Extract<
    PatternInstanceAction,
    { type: ActionType }
>;

type PatternInstanceHandlers = {
    createPatternInstance: MidiHandler<PatternInstanceActionOf<'createPatternInstance'>>;
    detachPatternInstance: MidiHandler<PatternInstanceActionOf<'detachPatternInstance'>>;
};

export const patternInstanceHandlers: PatternInstanceHandlers = {
    createPatternInstance: {
        execute: async (action) => {
            createPatternInstance(action.payload.sourceClipId, action.payload.targetTrackId, action.payload.startBeat);
        },
        undoable: true,
        describe: () => ({ label: 'Create Pattern Instance' }),
    },
    detachPatternInstance: {
        execute: async (action) => {
            detachPatternInstance(action.payload.clipId);
        },
        undoable: true,
        describe: () => ({ label: 'Detach Pattern Instance' }),
    },
};
