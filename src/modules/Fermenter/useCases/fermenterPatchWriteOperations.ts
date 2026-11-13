import { type FermenterPatch } from '../models/FermenterPatch';

type PatchWriteOperation = {
    superseded: boolean;
    continuous: boolean;
    patch: FermenterPatch;
    admittedRevision: string;
    committedRevision: string | null;
    ownsProject: () => boolean;
};

// The same ephemeral operation owns queued work and its committed UI echo.
// A project/replay revision never inherits a previous operation's authority.
export const fermenterPatchWriteOperations = new Map<string, PatchWriteOperation>();
