import { createHandler } from '#/utils/createHandler';

import { addSection } from '../../useCases/marker/sectionOperations/addSection';

type AddSectionAction = { payload: { startBeat: number; endBeat: number; name: string; sectionId?: string } };

// Mirror of handleDuplicateClip's ensureTargetClipId: the inverse needs the
// new section's id before execute runs, so describe mints it onto the payload
// and execute reuses it (describe always runs before execute).
function ensureSectionId(action: AddSectionAction): string {
    if (action.payload.sectionId) {
        return action.payload.sectionId;
    }
    const sectionId = `section-${crypto.randomUUID().slice(0, 8)}`;
    action.payload.sectionId = sectionId;
    return sectionId;
}

export const handleAddSection = createHandler<'addSection'>({
    execute: (action) => {
        addSection(action.payload.startBeat, action.payload.endBeat, action.payload.name, ensureSectionId(action));
    },
    describe: (action) => ({
        label: `Add section "${action.payload.name}"`,
        inverseAction: { type: 'removeSection', payload: { sectionId: ensureSectionId(action) } },
    }),
    undoable: true,
});
