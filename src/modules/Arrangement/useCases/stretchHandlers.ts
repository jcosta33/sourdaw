import { createHandler } from '#/helpers/createHandler';
import { setClipStretchMode, setClipStretchRatio, fitClipToBeats } from '#/modules/Arrangement/useCases/clipStretch';

/** Built in this module — not inside `getArrangementHandlers`. */
export const handleSetClipStretchMode = createHandler<'setClipStretchMode'>({
    execute: (action) => {
        setClipStretchMode(action.payload.clipId, action.payload.mode);
    },
    describe: (a) => ({ label: `Set clip stretch mode to ${a.payload.mode}` }),
    undoable: true,
});

export const handleSetClipStretchRatio = createHandler<'setClipStretchRatio'>({
    execute: (action) => {
        setClipStretchRatio(action.payload.clipId, action.payload.ratio);
    },
    describe: (a) => ({ label: `Set clip stretch ratio to ${a.payload.ratio}` }),
    undoable: true,
});

export const handleFitClipToBeats = createHandler<'fitClipToBeats'>({
    execute: (action) => {
        fitClipToBeats(action.payload.clipId, action.payload.targetBeats);
    },
    describe: (a) => ({ label: `Fit clip to ${a.payload.targetBeats} beats` }),
    undoable: true,
});

export const stretchHandlers = {
    setClipStretchMode: handleSetClipStretchMode,
    setClipStretchRatio: handleSetClipStretchRatio,
    fitClipToBeats: handleFitClipToBeats,
};
