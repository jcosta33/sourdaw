import { createHandler } from '#/utils/createHandler';

import { projectScratchPadSectionRemoval } from '../../useCases/scratchPad/scratchPadCrud/projectScratchPadSectionRemoval';
import { removeScratchPadSection } from '../../useCases/scratchPad/scratchPadCrud/removeScratchPadSection';

import { describeScratchPadSectionEdit, isScratchPadEditNoop } from './createScratchPadSectionEdit';

export const handleRemoveScratchPadSection = createHandler<'removeScratchPadSection'>({
    execute: (action) => {
        removeScratchPadSection(action.payload.sectionId);
    },
    describe: (action) =>
        describeScratchPadSectionEdit('Remove Scratch Pad Section', (sections) =>
            projectScratchPadSectionRemoval(sections, action.payload.sectionId)
        ),
    isNoop: (action) =>
        isScratchPadEditNoop((sections) => projectScratchPadSectionRemoval(sections, action.payload.sectionId)),
    undoable: true,
});
