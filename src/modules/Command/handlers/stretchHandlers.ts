import { type ActionHandler } from '../models/ActionHandler';
import { type AppAction } from '../models/AppAction';
import { setClipStretchMode, setClipStretchRatio, fitClipToBeats } from '#/modules/Track/useCases/clipStretchUseCases';

type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

export const stretchHandlers = {
    setClipStretchMode: {
        execute: (a) => {
            setClipStretchMode(a.payload.clipId, a.payload.mode);
        },
        describe: (a) => ({ label: `Set clip stretch mode to ${a.payload.mode}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setClipStretchMode'>>,

    setClipStretchRatio: {
        execute: (a) => {
            setClipStretchRatio(a.payload.clipId, a.payload.ratio);
        },
        describe: (a) => ({ label: `Set clip stretch ratio to ${a.payload.ratio}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setClipStretchRatio'>>,

    fitClipToBeats: {
        execute: (a) => {
            fitClipToBeats(a.payload.clipId, a.payload.targetBeats);
        },
        describe: (a) => ({ label: `Fit clip to ${a.payload.targetBeats} beats` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'fitClipToBeats'>>,
};
