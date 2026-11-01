import { createRafBatcher } from '#/utils/DOM/createRafBatcher';

export type FermenterBatchEntry = { deviceId: string; dspKey: string; key: string; value: number };

export const fermenterParamBatcher = createRafBatcher<FermenterBatchEntry>();
