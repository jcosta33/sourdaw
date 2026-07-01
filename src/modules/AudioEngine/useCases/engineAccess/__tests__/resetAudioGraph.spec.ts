import { describe, it, expect, beforeEach, vi } from 'vitest';

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
});
