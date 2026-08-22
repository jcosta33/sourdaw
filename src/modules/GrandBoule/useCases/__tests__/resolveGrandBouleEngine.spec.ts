import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
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

import { resolveGrandBouleEngine } from '../resolveGrandBouleEngine';

describe('resolveGrandBouleEngine', () => {
    it('resolves the addressed ready controls without mutating project or session state', () => {
        const engine = resolveGrandBouleEngine({ deviceId: 'grand-1' });

        engine.setParam({ name: 'tone_color', value: 0.2 });
        expect(mocks.controls.setParam).toHaveBeenCalledWith('tone_color', 0.2);
    });
});
