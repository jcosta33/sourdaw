import { logger } from '#/infra/logger/appLogger';
import { clipSelectionStore } from '#/modules/Arrangement/stores';
import { captureProjectIdentity } from '#/modules/CrdtDocument/stores';

import { duplicateClipSelectingCopy } from './duplicateClipSelectingCopy';
import { duplicateSelectedClipsForward } from './duplicateSelectedClipsForward';

type DuplicateType = 'duplicateClip' | 'duplicateClipToNextBar';
type DuplicateChain = {
    projectIdentity: string;
    // The memory adapter preserves references; every selection writer allocates a new state.
    // Comparing values or counting coalesced notifications misses an away-and-back selection.
    selection: typeof clipSelectionStore.value;
    retired: boolean;
};

let currentChain: DuplicateChain | undefined;
let pending: Promise<void> | undefined;

function ownsSelection(chain: DuplicateChain): boolean {
    return (
        !chain.retired &&
        chain.projectIdentity === captureProjectIdentity() &&
        chain.selection === clipSelectionStore.value
    );
}

async function runDuplicate(chain: DuplicateChain, type: DuplicateType): Promise<void> {
    if (!ownsSelection(chain)) {
        chain.retired = true;
        return;
    }
    const selection = chain.selection;
    const authority = {
        shouldExecute: () => ownsSelection(chain),
        // Advance the token in the same synchronous turn as our selection write, before another input.
        onSelected: () => {
            chain.selection = clipSelectionStore.value;
        },
    };
    try {
        let copied = false;
        if (type === 'duplicateClip' && selection && selection.selectedClipIds.length > 1) {
            copied = await duplicateSelectedClipsForward(selection.selectedClipIds, authority);
        } else if (selection?.selectedClipId && selection.selectedClipIds.length <= 1) {
            copied = await duplicateClipSelectingCopy(type, selection.selectedClipId, authority);
        }
        if (!copied) {
            chain.retired = true;
        }
    } catch (error) {
        chain.retired = true;
        logger.error(new Error('Keyboard shortcut duplicate failed', { cause: error }));
    }
}

/** Orders clip-copy intents only; the idle operation still starts synchronously. */
export function enqueueClipDuplicate(type: DuplicateType): Promise<void> {
    if (!currentChain || !ownsSelection(currentChain)) {
        if (currentChain) {
            currentChain.retired = true;
        }
        currentChain = {
            projectIdentity: captureProjectIdentity(),
            selection: clipSelectionStore.value,
            retired: false,
        };
    }
    const chain = currentChain;
    const operation = pending ? pending.then(() => runDuplicate(chain, type)) : runDuplicate(chain, type);
    pending = operation;
    void operation.then(() => {
        if (pending === operation) {
            pending = undefined;
        }
    });
    return operation;
}
