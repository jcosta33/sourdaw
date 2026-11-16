import { createHandler } from '#/utils/createHandler';

import { type ListRestoreSlot, isValidListRestoreSlot } from '../../models/ListRestoreSlot';
import { addSection } from '../../useCases/marker/sectionOperations/addSection';
import { getMarkerState } from '../../useCases/timelineQueries';

type AddSectionAction = {
    payload: { startBeat: number; endBeat: number; name: string; sectionId?: string; color?: string } & ListRestoreSlot;
};

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

const MALFORMED_SLOT_REASON = 'Section slot must be a non-negative integer index with string neighbour ids.';

export const handleAddSection = createHandler<'addSection'>({
    // Singleton keeps addSection out of multi-action batches, as it was before it gained a validator.
    batchExecution: 'singleton',
    // executeAppAction (undo/redo replay included) never calls validate, so execute enforces the same rule.
    validate: (action) => isValidListRestoreSlot(action.payload),
    execute: (action) => {
        if (!isValidListRestoreSlot(action.payload)) {
            return { status: 'conflict', reason: MALFORMED_SLOT_REASON };
        }
        const changed = addSection(
            action.payload.startBeat,
            action.payload.endBeat,
            action.payload.name,
            ensureSectionId(action),
            action.payload.color,
            {
                index: action.payload.index,
                beforeId: action.payload.beforeId,
                afterId: action.payload.afterId,
            }
        );
        if (!changed) {
            return { status: 'no-write' };
        }
        return undefined;
    },
    describe: (action) => ({
        label: `Add section "${action.payload.name}" from beat ${String(action.payload.startBeat)} to beat ${String(action.payload.endBeat)}`,
        inverseAction: { type: 'removeSection', payload: { sectionId: ensureSectionId(action) } },
    }),
    isNoop: (action) => {
        const sectionId = action.payload.sectionId;
        return (
            sectionId !== undefined && (getMarkerState()?.sections.some((section) => section.id === sectionId) ?? false)
        );
    },
    undoable: true,
});
