import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type Track } from '../../../models/Track';
import { renderTrackOffline } from '../renderOffline';

const buildDeviceChain = vi.fn();
const getAudioContext = vi.fn().mockReturnValue({ sampleRate: 44100 });

vi.mock('#/modules/AudioEngine/useCases', () => ({
    buildDeviceChain: (...args: any[]) => buildDeviceChain(...args),
    getAudioContext: (...args: any[]) => getAudioContext(...args),
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
        buildDeviceChain.mockReset();
        getAudioContext.mockReturnValue({ sampleRate: 44100 });
    });

    it('does not build a device chain for non-audio non-midi tracks', async () => {
        const busTrack = { kind: 'bus', clips: [], devices: [] } as unknown as Track;
        const result = await renderTrackOffline(busTrack, 0, 4);

        expect(result).toBeNull();
        expect(buildDeviceChain).not.toHaveBeenCalled();
    });
});
