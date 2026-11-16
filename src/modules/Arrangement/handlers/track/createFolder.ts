import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { captureTrackRemovalSnapshot } from '../../useCases/captureTrackRemovalSnapshot';
import { createFolder } from '../../useCases/folder/createFolder';

import { captureCreatedTrackGuards } from './captureCreatedTrackGuards';

type MutableDescribeResult = {
    label: string;
    inverseAction: AppAction | null;
    redoAction?: AppAction;
};

// Keyed by action so execute can finalize the describe-time inverse and redo from the
// committed folder, as handleLoadTrackTemplate does.
const pendingDescribeResults = new WeakMap<object, MutableDescribeResult>();

/**
 * The guard is the committed folder, so the undo refuses once anyone edits it. Redo
 * restores this exact folder rather than creating it again: a fresh creation mints a
 * new initial alternative id and palette color, so the guard would no longer match
 * what redo made and the second undo would refuse. Inverse and redo are emitted
 * together or not at all.
 */
function describeCreatedFolder(pending: MutableDescribeResult, folderTrackId: string): void {
    const generatedMidiStateGuards = captureCreatedTrackGuards([folderTrackId]);
    const restore = captureTrackRemovalSnapshot(folderTrackId);
    if (generatedMidiStateGuards === null || restore === null) {
        pending.inverseAction = null;
        pending.redoAction = undefined;
        return;
    }
    pending.inverseAction = {
        type: 'discardCreatedTracks',
        payload: { trackIds: [folderTrackId], generatedMidiStateGuards },
    };
    pending.redoAction = { type: 'restoreTracks', payload: { restores: [restore] } };
}

export const handleCreateFolder = createHandler<'createFolder'>({
    execute: (action) => {
        const created = createFolder(action.payload.name, action.payload.folderTrackId);
        const pending = pendingDescribeResults.get(action);
        const folderTrackId = action.payload.folderTrackId;
        if (pending && folderTrackId) {
            describeCreatedFolder(pending, folderTrackId);
        }
        return { status: created ? 'written' : 'no-write' };
    },
    describe: (alpha) => {
        const label = `Create folder "${alpha.payload.name}"`;
        // `folderTrackId` is materialized before `describe` runs (see
        // `materializeCommandApplicationIds`). Its absence means the command layer never
        // assigned an id for this dispatch, so there is nothing for an inverse to name.
        const result: MutableDescribeResult = { label, inverseAction: null };
        if (alpha.payload.folderTrackId) {
            pendingDescribeResults.set(alpha, result);
        }
        return result;
    },
    undoable: true,
});
