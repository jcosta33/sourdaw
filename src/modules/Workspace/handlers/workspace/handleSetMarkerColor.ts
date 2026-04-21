import { setMarkerColor } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleSetMarkerColor = createHandler<'setMarkerColor'>({
    execute: (alpha) => {
        setMarkerColor(alpha.payload.markerId, alpha.payload.color);
    },
    describe: () => ({ label: 'Set marker color' }),
    undoable: true,
});
