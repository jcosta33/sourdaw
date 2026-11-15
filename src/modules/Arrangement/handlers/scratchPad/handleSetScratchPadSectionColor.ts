import { createHandler } from '#/utils/createHandler';

import { projectScratchPadSectionColor } from '../../useCases/scratchPad/scratchPadCrud/projectScratchPadSectionColor';
import { setScratchPadSectionColor } from '../../useCases/scratchPad/scratchPadCrud/setScratchPadSectionColor';

import { describeScratchPadSectionEdit, isScratchPadEditNoop } from './createScratchPadSectionEdit';

export const handleSetScratchPadSectionColor = createHandler<'setScratchPadSectionColor'>({
    execute: (action) => {
        setScratchPadSectionColor(action.payload.sectionId, action.payload.color);
    },
    describe: (action) =>
        describeScratchPadSectionEdit('Set Scratch Pad Section Color', (sections) =>
            projectScratchPadSectionColor(sections, action.payload.sectionId, action.payload.color)
        ),
    isNoop: (action) =>
        isScratchPadEditNoop((sections) =>
            projectScratchPadSectionColor(sections, action.payload.sectionId, action.payload.color)
        ),
    undoable: true,
});
