import { createHandler } from '#/utils/createHandler';

import { projectScratchPadSectionRename } from '../../useCases/scratchPad/scratchPadCrud/projectScratchPadSectionRename';
import { renameScratchPadSection } from '../../useCases/scratchPad/scratchPadCrud/renameScratchPadSection';

import { describeScratchPadSectionEdit, isScratchPadEditNoop } from './createScratchPadSectionEdit';

export const handleRenameScratchPadSection = createHandler<'renameScratchPadSection'>({
    execute: (action) => {
        renameScratchPadSection(action.payload.sectionId, action.payload.name);
    },
    describe: (action) =>
        describeScratchPadSectionEdit('Rename Scratch Pad Section', (sections) =>
            projectScratchPadSectionRename(sections, action.payload.sectionId, action.payload.name)
        ),
    isNoop: (action) =>
        isScratchPadEditNoop((sections) =>
            projectScratchPadSectionRename(sections, action.payload.sectionId, action.payload.name)
        ),
    undoable: true,
});
