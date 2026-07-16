import { describe, it, expect, vi } from 'vitest';

vi.mock('../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        context: { currentTime: 0, sampleRate: 48000, state: 'running', destination: {} },
        masterGain: { gain: { value: 1, setValueAtTime: vi.fn() } },
    },
    ensureEngine: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/stores/audioBufferCache', () => ({
    audioBufferCache: { get: vi.fn(), set: vi.fn(), has: vi.fn(() => false) },
}));

vi.mock('#/modules/Transport/stores', () => ({
    linkStatusStore: { value: { active: false }, set: vi.fn() },
}));

import { getAudioContext } from '../engineAccess/getAudioContext';

describe('engineAccess', () => {
    it('getAudioContext returns context', () => {
        const ctx = getAudioContext();
        expect(ctx).toBeDefined();
    });
});
