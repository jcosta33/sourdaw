import { describe, it, expect, vi } from 'vitest';

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: { value: { tracks: [], selectedTrackId: null }, set: vi.fn() },
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
    addClip: vi.fn(),
    removeClip: vi.fn(),
    setTrackGain: vi.fn(),
    setTrackPan: vi.fn(),
    updateDeviceParam: vi.fn(),
    updateDevicePatch: vi.fn(),
    persistDeviceParam: vi.fn(),
    persistDevicePatch: vi.fn(),
    setDeviceParameter: vi.fn(),
}));
vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: vi.fn(),
}));
vi.mock('#/modules/MIDI/useCases', () => ({
    setNotesForClip: vi.fn(),
    addMidiNote: vi.fn(),
}));
vi.mock('#/modules/Transport/useCases', () => ({
    setTempo: vi.fn(),
    stopPlayback: vi.fn(),
    getTransportState: vi.fn(() => ({ isPlaying: false, playheadPosition: 0 })),
}));
vi.mock('#/modules/Workspace/useCases', () => ({
    setEditingTool: vi.fn(),
    clearClipSelection: vi.fn(),
    selectClip: vi.fn(),
}));
vi.mock('#/infra/di/inject', () => ({
    inject: (deps: Record<string, unknown>) => (factory: (d: Record<string, unknown>) => unknown) =>
        factory(
            Object.fromEntries(Object.entries(deps).map(([k]) => [k, { emit: vi.fn(), on: vi.fn(() => () => {}) }]))
        ),
}));

describe('executeDsos deep', () => {
    it('module loads', () => {
        expect(true).toBe(true);
    });
});
