import { describe, it, expect, beforeEach, vi } from 'vitest';

import { noteLiveMidiControl, readLatchedLiveMidiControls } from '../../../services/liveMidiControlLatch';
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

    it('should forget every latched live pedal, because the next project starts with its foot up', () => {
        // Track and device ids survive a save, so a damper left latched under
        // the project being torn down would be replayed onto the first native
        // body of the next one.
        noteLiveMidiControl({
            trackId: 'track-1',
            deviceId: 'grand-1',
            controller: 64,
            value: 127,
            channel: 0,
        });
        expect(readLatchedLiveMidiControls()).toHaveLength(1);

        resetAudioGraph();

        expect(readLatchedLiveMidiControls()).toEqual([]);
    });
});
