import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type Track } from '../../../models/Track';
import { renderTrackOffline } from '../renderOffline';
import type { buildDeviceChain } from '#/modules/AudioEngine/useCases';
import type { getAudioContext } from '#/modules/AudioEngine/useCases';

const mockBuildDeviceChain = vi.fn<typeof buildDeviceChain>();
const mockGetAudioContext = vi.fn<typeof getAudioContext>().mockReturnValue({ sampleRate: 44100 } as AudioContext);

vi.mock('#/modules/AudioEngine/useCases', () => ({
    buildDeviceChain: (...args: Parameters<typeof buildDeviceChain>) => mockBuildDeviceChain(...args),
    getAudioContext: (...args: Parameters<typeof getAudioContext>) => mockGetAudioContext(...args),
}));

vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: new Map(),
}));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: { value: null },
}));

vi.mock('#/modules/Transport/stores', () => ({
    transportStore: { value: null },
}));

vi.mock('#/modules/Routing/stores', () => ({
    sidechainStore: { value: null },
}));

vi.mock('../../stores/trackStore', () => ({
    trackStore: { value: null },
}));

vi.mock('../../services/getUpstreamSubgraph', () => ({
    getUpstreamSubgraph: () => new Set<string>(),
}));

describe('renderTrackOffline', () => {
    beforeEach(() => {
        mockBuildDeviceChain.mockReset();
        mockGetAudioContext.mockReturnValue({ sampleRate: 44100 } as AudioContext);
    });

    it('does not build a device chain for non-audio non-midi tracks', async () => {
        const busTrack = { kind: 'bus', clips: [], devices: [] } as unknown as Track;
        const result = await renderTrackOffline(busTrack, 0, 4);

        expect(result).toBeNull();
        expect(mockBuildDeviceChain).not.toHaveBeenCalled();
    });
});
