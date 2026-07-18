import { setMarqueeSelection } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleSetMarqueeSelection = createHandler<'setMarqueeSelection'>({
    execute: (alpha) => {
        setMarqueeSelection(alpha.payload.selection);
    },
    describe: () => ({ label: 'Set marquee selection' }),
    undoable: false, // selection isn't typically undoable in a DAW unless explicitly modeled as such
});
