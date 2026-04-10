import { setClipStretchMode, setClipStretchRatio, fitClipToBeats } from './clipStretch';

type StretchHandlerDescription = {
    label: string;
};

type StretchHandler<Action> = {
    execute: (action: Action) => void | Promise<void>;
    describe: (action: Action) => StretchHandlerDescription;
    undoable: boolean;
};

type StretchAction =
    | { type: 'setClipStretchMode'; payload: { clipId: string; mode: string } }
    | { type: 'setClipStretchRatio'; payload: { clipId: string; ratio: number } }
    | { type: 'fitClipToBeats'; payload: { clipId: string; targetBeats: number } };

type StretchActionOf<ActionType extends StretchAction['type']> = Extract<StretchAction, { type: ActionType }>;

type StretchHandlers = {
    setClipStretchMode: StretchHandler<StretchActionOf<'setClipStretchMode'>>;
    setClipStretchRatio: StretchHandler<StretchActionOf<'setClipStretchRatio'>>;
    fitClipToBeats: StretchHandler<StretchActionOf<'fitClipToBeats'>>;
};

export const stretchHandlers: StretchHandlers = {
    setClipStretchMode: {
        execute: (a) => {
            setClipStretchMode(a.payload.clipId, a.payload.mode);
        },
        describe: (a) => ({ label: `Set clip stretch mode to ${a.payload.mode}` }),
        undoable: true,
    },

    setClipStretchRatio: {
        execute: (a) => {
            setClipStretchRatio(a.payload.clipId, a.payload.ratio);
        },
        describe: (a) => ({ label: `Set clip stretch ratio to ${a.payload.ratio}` }),
        undoable: true,
    },

    fitClipToBeats: {
        execute: (a) => {
            fitClipToBeats(a.payload.clipId, a.payload.targetBeats);
        },
        describe: (a) => ({ label: `Fit clip to ${a.payload.targetBeats} beats` }),
        undoable: true,
    },
};
