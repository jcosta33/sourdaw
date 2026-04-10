import { inject } from '#/infra/di/inject';
import { createHandler, createHandlers } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { setClipStretchMode, setClipStretchRatio, fitClipToBeats } from '#/modules/Arrangement/useCases/clipStretch';

type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

export const executeSetClipStretchMode = inject({ setClipStretchMode })(
    ({ setClipStretchMode }) =>
        function executeSetClipStretchMode(a: Extract<AppAction, 'setClipStretchMode'>): void {
            setClipStretchMode(a.payload.clipId, a.payload.mode);
        }
);

export const executeSetClipStretchRatio = inject({ setClipStretchRatio })(
    ({ setClipStretchRatio }) =>
        function executeSetClipStretchRatio(a: Extract<AppAction, 'setClipStretchRatio'>): void {
            setClipStretchRatio(a.payload.clipId, a.payload.ratio);
        }
);

export const executeFitClipToBeats = inject({ fitClipToBeats })(
    ({ fitClipToBeats }) =>
        function executeFitClipToBeats(a: Extract<AppAction, 'fitClipToBeats'>): void {
            fitClipToBeats(a.payload.clipId, a.payload.targetBeats);
        }
);

/** Built at handler-module scope — not inside `getArrangementHandlers` or other use cases. */
export const handleSetClipStretchMode = createHandler<'setClipStretchMode'>({
    execute: executeSetClipStretchMode,
    describe: (a) => ({ label: `Set clip stretch mode to ${a.payload.mode}` }),
    undoable: true,
});

export const handleSetClipStretchRatio = createHandler<'setClipStretchRatio'>({
    execute: executeSetClipStretchRatio,
    describe: (a) => ({ label: `Set clip stretch ratio to ${a.payload.ratio}` }),
    undoable: true,
});

export const handleFitClipToBeats = createHandler<'fitClipToBeats'>({
    execute: executeFitClipToBeats,
    describe: (a) => ({ label: `Fit clip to ${a.payload.targetBeats} beats` }),
    undoable: true,
});

export const stretchHandlers = createHandlers({
    setClipStretchMode: handleSetClipStretchMode,
    setClipStretchRatio: handleSetClipStretchRatio,
    fitClipToBeats: handleFitClipToBeats,
});
