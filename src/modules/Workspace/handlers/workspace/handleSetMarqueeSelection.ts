import { createHandler } from '#/utils/createHandler';

import { setMarqueeSelection } from '../../useCases/setMarqueeSelection';

export const handleSetMarqueeSelection = createHandler<'setMarqueeSelection'>({
    execute: (a) => {
        setMarqueeSelection(a.payload.selection);
    },
    describe: () => ({ label: 'Set marquee selection' }),
    undoable: false, // selection isn't typically undoable in a DAW unless explicitly modeled as such
});
