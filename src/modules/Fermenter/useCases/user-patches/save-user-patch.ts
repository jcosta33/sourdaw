import { type FermenterPatch } from '../../models/FermenterPatch';
import { writeUserPatchesText } from '../../repositories/user-patches/write-user-patches-text';

import { loadUserPatches } from './load-user-patches';

type SaveUserPatchInput = {
    name: string;
    patch: FermenterPatch;
};

export function saveUserPatch({ name, patch }: SaveUserPatchInput): boolean {
    const userPatches = loadUserPatches();
    const nextPatches = [...userPatches, { id: `user-${Date.now()}`, name, patch: { ...patch, name } }];

    return writeUserPatchesText(JSON.stringify(nextPatches));
}
