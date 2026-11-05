import { type AppAction, type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { jsonValuesEqual } from '#/utils/jsonSemanticEquality';

import { isProductionBrief, type ProductionBrief } from '../../models/ProductionBrief';
import { authorizeProductionBriefReplay } from '../../stores/productionBriefReplayAuthority';

type ProductionBriefAction = Extract<AppAction, { type: 'setProductionBrief' }>;
type BriefWrite = { action: ProductionBriefAction; brief: ProductionBrief };

/** A brief write `execute` could accept: a whole brief one revision past the one it names. */
function readBriefWrite(action: AppAction | null | undefined): BriefWrite | null {
    if (action?.type !== 'setProductionBrief') {
        return null;
    }
    const { expectedRevision, brief } = action.payload;
    if (
        !Number.isSafeInteger(expectedRevision) ||
        !isProductionBrief(brief) ||
        brief.revision !== expectedRevision + 1
    ) {
        return null;
    }
    return { action, brief };
}

type BriefReplays = { inverse: ProductionBriefAction; redo: ProductionBriefAction };

/**
 * The inverse and redo of a persisted brief entry, when they are exactly the pair
 * `handleSetProductionBrief.describe` builds for its forward write: the inverse lands on the
 * forward revision, the redo on the inverse's, and the redo rewrites the forward brief unchanged.
 */
function readBriefReplays(entry: HandlerSessionActionEntry): BriefReplays | null {
    const forward = readBriefWrite(entry.action);
    const inverse = readBriefWrite(entry.inverseAction);
    const redo = readBriefWrite(entry.redoAction);
    if (!forward || !inverse || !redo) {
        return null;
    }
    const written = forward.brief.revision;
    if (
        inverse.action.payload.expectedRevision !== written ||
        redo.action.payload.expectedRevision !== written + 1 ||
        !jsonValuesEqual({ ...redo.brief, revision: written }, forward.brief)
    ) {
        return null;
    }
    return { inverse: inverse.action, redo: redo.action };
}

export function isProductionBriefSessionEntry(entry: HandlerSessionActionEntry): boolean {
    return readBriefReplays(entry) !== null;
}

/**
 * A restored entry's inverse and redo are new objects, so the replay authority `describe` gave the
 * originals is gone. Grant it again only to a pair that is still the one `describe` builds.
 */
export function restoreProductionBriefSessionEntry(entry: HandlerSessionActionEntry): void {
    const replays = readBriefReplays(entry);
    if (!replays) {
        return;
    }
    authorizeProductionBriefReplay(replays.inverse);
    authorizeProductionBriefReplay(replays.redo);
}
