import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
    forgetLatchedLiveMidiControls,
    noteLiveMidiControl,
    readLatchedLiveMidiControls,
} from '../../../services/liveMidiControlLatch';
import { externalLatencyRegistry } from '../../latencyCompensation/compensation/externalLatencyRegistry';
import { resetAudioGraph } from '../resetAudioGraph';

const resetGraphMock = vi.hoisted(() => vi.fn());

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        resetGraph: resetGraphMock,
    },
}));

describe('resetAudioGraph', () => {
    beforeEach(() => {
        externalLatencyRegistry.clear();
        forgetLatchedLiveMidiControls();
        resetGraphMock.mockClear();
    });

    it('should reset the live engine graph before clearing reported external latency', () => {
        externalLatencyRegistry.set('dev-a', 5);
        externalLatencyRegistry.set('dev-b', 12);

        resetGraphMock.mockImplementationOnce(() => {
            expect(externalLatencyRegistry.size).toBe(2);
        });

        resetAudioGraph();

        expect(resetGraphMock).toHaveBeenCalledTimes(1);
        expect(externalLatencyRegistry.size).toBe(0);
    });

    it('should keep every latched live pedal, because a reset also happens inside one project', () => {
        // A graph reset is not a project boundary: repairRuntimeGraphFromProject
        // resets, rebuilds the strips and resumes playback in the same project,
        // and a load that aborts after its teardown restores the old graph. The
        // player's foot has not moved through either, so forgetting here would
        // bring the rebuilt bodies up with the damper raised.
        const heldDamper = {
            trackId: 'track-1',
            deviceId: 'grand-1',
            controller: 64,
            value: 127,
            channel: 0,
        };
        noteLiveMidiControl(heldDamper);

        resetAudioGraph();

        expect(readLatchedLiveMidiControls()).toEqual([heldDamper]);
    });
});
