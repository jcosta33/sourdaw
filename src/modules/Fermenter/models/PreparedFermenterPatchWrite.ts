import { type AppAction } from '#/utils/handlerContract';

import { type FermenterPatch } from './FermenterPatch';

/** Capabilities an atomic frame consumes, independent of the write's producer. */
export type FermenterPatchFrameWrite = {
    action: () => Extract<AppAction, { type: 'setFermenterPatch' }>;
    isCurrent: () => boolean;
    markCommitted: () => void;
    settle: () => boolean;
    release: () => void;
    reconcileRefusal: () => void;
};

export type QueuedFermenterPatchWrite = FermenterPatchFrameWrite & {
    cancelParameter: (key: keyof FermenterPatch) => void;
};

export type PreparedFermenterPatchWrite = QueuedFermenterPatchWrite & {
    patch: FermenterPatch;
    commit: () => Promise<boolean>;
};
