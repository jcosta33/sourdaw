import { beforeEach, describe, expect, it } from 'vitest';

import {
    forgetLatchedLiveMidiControls,
    noteLiveMidiControl,
    readLatchedLiveMidiControls,
} from '../../../services/liveMidiControlLatch';
import { forgetProjectLatchedPedals } from '../forgetProjectLatchedPedals';

describe('forgetProjectLatchedPedals', () => {
    beforeEach(() => {
        forgetLatchedLiveMidiControls();
    });

    it('empties the latch, so the next project builds its first bodies with every pedal up', () => {
        noteLiveMidiControl({
            trackId: 'track-1',
            deviceId: 'grand-1',
            controller: 64,
            value: 127,
            channel: 0,
        });
        noteLiveMidiControl({
            trackId: 'track-2',
            deviceId: 'grand-2',
            controller: 66,
            value: 90,
            channel: 3,
        });
        expect(readLatchedLiveMidiControls()).toHaveLength(2);

        forgetProjectLatchedPedals();

        expect(readLatchedLiveMidiControls()).toEqual([]);
    });
});
