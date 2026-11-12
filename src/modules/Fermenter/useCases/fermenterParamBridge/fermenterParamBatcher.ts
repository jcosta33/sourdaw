import { createRafBatcher } from '#/utils/DOM/createRafBatcher';

import { type FermenterPatch } from '../../models/FermenterPatch';

export type FermenterBatchEntry = { deviceId: string; dspKey: string; key: string; value: number };
export type FermenterPatchBatchEntry = { deviceId: string; patch: FermenterPatch };

export const fermenterParamBatcher = createRafBatcher<FermenterBatchEntry>();

// Coalesce full-patch engine + persistence writes to once per frame, keyed by
// deviceId so rapid writes collapse to the latest patch on the next frame.
export const fermenterPatchBatcher = createRafBatcher<FermenterPatchBatchEntry>();
