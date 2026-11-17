import { describe, expectTypeOf, it } from 'vitest';

import { type DeviceSnapshotState } from '../../models/DeviceSnapshot';
import { type DeviceStateChunkSnapshot } from '../arrangementDeviceStateSnapshots';

describe('DeviceStateChunkSnapshot', () => {
    it('is exactly the read-only device state a device snapshot model carries', () => {
        // Models may not import events, so the model declares its own copy.
        expectTypeOf<DeviceSnapshotState>().toEqualTypeOf<DeviceStateChunkSnapshot>();
    });
});
