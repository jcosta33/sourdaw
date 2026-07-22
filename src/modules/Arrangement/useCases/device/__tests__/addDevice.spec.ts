import { describe, it, expect, vi, beforeEach } from 'vitest';

import { addDevice } from '../addDevice';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    updateTrack: vi.fn(),
    getPlatformPlugins: vi.fn(),
    addDeviceToStrip: vi.fn(),
    updateDeviceParam: vi.fn(),
    compileFaustDSP: vi.fn(),
    loadPlugin: vi.fn(),
    projectTrackToLiveStrip: vi.fn(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('../../getPlatformPlugins', () => ({
    getPlatformPlugins: mocks.getPlatformPlugins,
}));

vi.mock('../../projectTrackToLiveStrip', () => ({
    projectTrackToLiveStrip: mocks.projectTrackToLiveStrip,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    addDeviceToStrip: mocks.addDeviceToStrip,
    updateDeviceParam: mocks.updateDeviceParam,
}));

vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/PluginHost/useCases')>()),
    compileFaustDSP: mocks.compileFaustDSP,
    loadPlugin: mocks.loadPlugin,
}));

describe('addDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', kind: 'audio', devices: [] }] });
        mocks.getPlatformPlugins.mockReturnValue([]);
    });

    it('adds a generic device if plugin is not found', () => {
        const result = addDevice('t1', 'CustomEffect');

        expect(result).toMatchObject({
            name: 'CustomEffect',
            type: 'CustomEffect',
            bypassed: false,
        });
        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        expect(mocks.addDeviceToStrip).not.toHaveBeenCalled();
    });

    it('adds a registered plugin and notifies engine', () => {
        const mockPlugin = {
            id: 'p1',
            name: 'Reverb',
            parameters: [{ id: 'wet', value: 0.5 }],
        };
        mocks.getPlatformPlugins.mockReturnValue([mockPlugin]);

        const result = addDevice('t1', 'Reverb');

        expect(result).toMatchObject({
            name: 'Reverb',
            type: 'p1',
            parameterValues: { wet: 0.5 },
        });
        expect(mocks.addDeviceToStrip).toHaveBeenCalledWith('t1', result?.id, 'p1');
        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('t1', result?.id, 'wet', 0.5);
    });

    it('persists a registered non-Toaster on an ordinary folder without allocating an engine strip', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 'folder-1', kind: 'folder', devices: [] }] });
        mocks.getPlatformPlugins.mockReturnValue([
            { id: 'p1', name: 'Reverb', parameters: [{ id: 'wet', value: 0.5 }] },
        ]);

        const result = addDevice('folder-1', 'Reverb');

        expect(result).toMatchObject({ type: 'p1' });
        expect(mocks.updateTrack).toHaveBeenCalledWith('folder-1', expect.any(Function));
        expect(mocks.addDeviceToStrip).not.toHaveBeenCalled();
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
    });

    it('delegates a false-to-true folder transition to owner-safe projection without direct retained work', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                {
                    id: 'folder-1',
                    kind: 'folder',
                    devices: [
                        { id: 'reverb-1', type: 'p1', bypassed: true, parameterValues: { wet: 0.25, room: 0.5 } },
                        { id: 'faust-1', type: 'faust-delay', parameterValues: { feedback: 0.4 } },
                        {
                            id: 'external-1',
                            type: 'external-plugin',
                            parameterValues: { mix: 0.8 },
                            externalPluginId: 'plugin-1',
                            externalInstanceId: 'instance-1',
                        },
                    ],
                },
                { id: 'other', kind: 'audio', devices: [{ id: 'reverb-1', type: 'p1' }] },
            ],
        });
        mocks.getPlatformPlugins.mockReturnValue([
            { id: 'toaster', name: 'Toaster', parameters: [{ id: 'swing', value: 0.2 }] },
        ]);
        const result = addDevice('folder-1', 'Toaster');

        expect(result).toMatchObject({ type: 'toaster' });
        expect(mocks.projectTrackToLiveStrip).toHaveBeenCalledWith({
            trackId: 'folder-1',
            activateDormantExternalPlugins: true,
        });
        expect(mocks.addDeviceToStrip).not.toHaveBeenCalled();
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(mocks.compileFaustDSP).not.toHaveBeenCalled();
        expect(mocks.loadPlugin).not.toHaveBeenCalled();
    });

    it('adds a supported device to an already-live Toaster folder', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'folder-1', kind: 'folder', devices: [{ id: 'toaster-1', type: 'toaster' }] }],
        });
        mocks.getPlatformPlugins.mockReturnValue([
            { id: 'p1', name: 'Reverb', parameters: [{ id: 'wet', value: 0.5 }] },
        ]);

        const result = addDevice('folder-1', 'Reverb');

        expect(mocks.addDeviceToStrip).toHaveBeenCalledTimes(1);
        expect(mocks.addDeviceToStrip).toHaveBeenCalledWith('folder-1', result?.id, 'p1');
        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('folder-1', result?.id, 'wet', 0.5);
    });

    it('compiles Faust DSP if it starts with faust-', async () => {
        const mockPlugin = {
            id: 'faust-synth',
            name: 'Faust Synth',
            parameters: [],
        };
        mocks.getPlatformPlugins.mockReturnValue([mockPlugin]);

        addDevice('t1', 'faust-synth');

        await vi.waitFor(() => {
            expect(mocks.compileFaustDSP).toHaveBeenCalledWith('faust-synth');
        });
    });

    it('rejects duplicate track identity before truth or runtime work', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                { id: 'duplicate', kind: 'audio', devices: [] },
                { id: 'duplicate', kind: 'audio', devices: [] },
            ],
        });
        mocks.getPlatformPlugins.mockReturnValue([
            { id: 'faust-synth', name: 'Faust Synth', parameters: [{ id: 'gain', value: 0.5 }] },
        ]);

        expect(addDevice('duplicate', 'faust-synth')).toBeNull();
        expect(mocks.getPlatformPlugins).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.addDeviceToStrip).not.toHaveBeenCalled();
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(mocks.compileFaustDSP).not.toHaveBeenCalled();
        expect(mocks.projectTrackToLiveStrip).not.toHaveBeenCalled();
    });

    it('rejects a dormant VCA before ID allocation, store writes, engine calls, or plugin compilation', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 'vca-1', kind: 'vca', devices: [] }] });
        mocks.getPlatformPlugins.mockReturnValue([{ id: 'faust-synth', name: 'Faust Synth', parameters: [] }]);

        expect(addDevice('vca-1', 'faust-synth')).toBeNull();
        expect(mocks.getPlatformPlugins).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.addDeviceToStrip).not.toHaveBeenCalled();
        expect(mocks.compileFaustDSP).not.toHaveBeenCalled();
    });
});
