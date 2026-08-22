import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    apply: vi.fn(),
    hydrate: vi.fn(),
    controls: {
        ready: true,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        noteOnMidi2: vi.fn(),
        setParam: vi.fn(),
        setSustain: vi.fn(),
        setUnaCorda: vi.fn(),
        setSostenuto: vi.fn(),
        setTemperament: vi.fn(),
        loadAttackClip: vi.fn(),
        allNotesOff: vi.fn(),
    },
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getAllTracks: () => [{ id: 'track-1', devices: [{ id: 'grand-1' }] }],
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    ensureTrackStrip: () => ({
        deviceNodes: [{ deviceId: 'grand-1', grandBouleControls: mocks.controls }],
        analyserNode: null,
    }),
    getAudioSampleRate: () => 48_000,
}));
vi.mock('../../repositories/grandBouleEngineHandle', () => ({ createDisconnectedGrandBouleEngineHandle: vi.fn() }));
vi.mock('../applyGrandBouleMorphState', () => ({ applyGrandBouleMorphState: mocks.apply }));
vi.mock('../hydrateGrandBouleMorphStateFromProject', () => ({ hydrateGrandBouleMorphStateFromProject: mocks.hydrate }));

import { resolveGrandBouleEngine } from '../resolveGrandBouleEngine';

describe('resolveGrandBouleEngine', () => {
    it('hydrates and applies saved voicing when the live controls become ready', () => {
        const morph = {
            modelA: 'mellow-grand',
            modelB: 'singing-grand',
            morphPosition: 0.4,
            layerBalance: 0.2,
            enabled: true,
        };
        mocks.hydrate.mockReturnValue(morph);

        resolveGrandBouleEngine({ deviceId: 'grand-1' });

        expect(mocks.hydrate).toHaveBeenCalledWith('grand-1');
        expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({ setParam: expect.any(Function) }), morph);
    });
});
