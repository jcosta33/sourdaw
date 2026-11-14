import { type FermenterPatch } from '../models/FermenterPatch';

import { prepareFermenterPatchWrite } from './prepareFermenterPatchWrite';

type CommitFermenterPatchInput = { deviceId: string; patch: FermenterPatch; label: string };

/** One discrete patch edit owns one undo unit, including the pending draft it replaces. */
export async function commitFermenterPatch(input: CommitFermenterPatchInput): Promise<boolean> {
    return prepareFermenterPatchWrite(input)?.commit() ?? false;
}
