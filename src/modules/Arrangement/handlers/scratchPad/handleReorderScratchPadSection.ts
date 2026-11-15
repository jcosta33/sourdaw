import { createHandler } from '#/utils/createHandler';

import { projectScratchPadSectionReorder } from '../../useCases/scratchPad/scratchPadCrud/projectScratchPadSectionReorder';
import { reorderScratchPadSection } from '../../useCases/scratchPad/scratchPadCrud/reorderScratchPadSection';

import { describeScratchPadSectionEdit, isScratchPadEditNoop } from './createScratchPadSectionEdit';

export const handleReorderScratchPadSection = createHandler<'reorderScratchPadSection'>({
    execute: (action) => {
        reorderScratchPadSection(action.payload.sectionId, action.payload.direction);
    },
    describe: (action) =>
        describeScratchPadSectionEdit('Reorder Scratch Pad Section', (sections) =>
            projectScratchPadSectionReorder(sections, action.payload.sectionId, action.payload.direction)
        ),
    isNoop: (action) =>
        isScratchPadEditNoop((sections) =>
            projectScratchPadSectionReorder(sections, action.payload.sectionId, action.payload.direction)
        ),
    undoable: true,
});
