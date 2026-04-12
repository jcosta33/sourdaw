import { createHandler } from '#/utils/createHandler';
import { setMarkerColor } from '#/modules/Arrangement/useCases';

export const handleSetMarkerColor = createHandler<'setMarkerColor'>({
    execute: (a) => {
        setMarkerColor(a.payload.markerId, a.payload.color);
    },
    describe: () => ({ label: 'Set marker color' }),
    undoable: true,
});
