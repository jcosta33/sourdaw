import { createRafBatcher } from '#/utils/DOM/createRafBatcher';

import { type FermenterPatch } from '../../models/FermenterPatch';
import { commitFermenterPatchFrame } from '../commitFermenterPatchFrame';
import { type prepareFermenterPatchWrite } from '../prepareFermenterPatchWrite';

type PreparedWrite = NonNullable<ReturnType<typeof prepareFermenterPatchWrite>>;
const pending = new Map<string, PreparedWrite>();
const frames = createRafBatcher<null>();
const FRAME_KEY = 'patch-writes';

export const fermenterPatchBatcher = {
    schedule(deviceId: string, write: PreparedWrite): void {
        pending.set(deviceId, write);
        frames.schedule(FRAME_KEY, null, () => {
            const writes = [...pending.values()];
            pending.clear();
            void commitFermenterPatchFrame(writes);
        });
    },
    cancel(deviceId: string): void {
        pending.delete(deviceId);
        if (pending.size === 0) {
            frames.cancel(FRAME_KEY);
        }
    },
    cancelParameter(deviceId: string, key: keyof FermenterPatch): void {
        pending.get(deviceId)?.cancelParameter(key);
    },
};
