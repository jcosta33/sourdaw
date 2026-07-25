import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleLoadExternalPlugin } from '../handleLoadExternalPlugin';

const mocks = vi.hoisted(() => ({
    addExternalDevice: vi.fn(),
    addTrack: vi.fn(),
    findPluginByName: vi.fn(),
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    findPluginByName: mocks.findPluginByName,
}));

vi.mock('../../../useCases/addTrack', () => ({
    addTrack: mocks.addTrack,
}));

vi.mock('../../../useCases/device/addExternalDevice', () => ({
    addExternalDevice: mocks.addExternalDevice,
}));

describe('handleLoadExternalPlugin', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.findPluginByName.mockReturnValue({ name: 'Compressor', category: 'Effect' });
    });

    it('reports a write when the external device is added to a provided track', async () => {
        mocks.addExternalDevice.mockReturnValue({ id: 'device-1' });

        const result = await handleLoadExternalPlugin.execute({
            type: 'loadExternalPlugin',
            payload: { pluginId: 'plugin-1', trackId: 'audio-1' },
        });

        expect(mocks.addExternalDevice).toHaveBeenCalledWith('audio-1', 'plugin-1', 'Compressor');
        expect(result).toEqual({ status: 'written' });
    });

    it('reports no-write when a provided dormant VCA rejects the device', async () => {
        mocks.addExternalDevice.mockReturnValue(null);

        const result = await handleLoadExternalPlugin.execute({
            type: 'loadExternalPlugin',
            payload: { pluginId: 'plugin-1', trackId: 'vca-1' },
        });

        expect(mocks.addTrack).not.toHaveBeenCalled();
        expect(result).toEqual({ status: 'no-write' });
    });

    it('reports the new track creation as a write even if device addition is rejected afterward', async () => {
        mocks.addTrack.mockReturnValue({ id: 'new-track' });
        mocks.addExternalDevice.mockReturnValue(null);

        const result = await handleLoadExternalPlugin.execute({
            type: 'loadExternalPlugin',
            payload: { pluginId: 'plugin-1' },
        });

        expect(mocks.addExternalDevice).toHaveBeenCalledWith('new-track', 'plugin-1', 'Compressor');
        expect(result).toEqual({ status: 'written' });
    });

    it('reports no-write when implicit track creation fails', async () => {
        mocks.addTrack.mockReturnValue(null);

        const result = await handleLoadExternalPlugin.execute({
            type: 'loadExternalPlugin',
            payload: { pluginId: 'plugin-1' },
        });

        expect(mocks.addExternalDevice).not.toHaveBeenCalled();
        expect(result).toEqual({ status: 'no-write' });
    });

    it('creates a midi track for an instrument plugin when no track is provided', async () => {
        mocks.findPluginByName.mockReturnValue({ name: 'Synth', category: 'Instrument' });
        mocks.addTrack.mockReturnValue({ id: 'midi-track' });
        mocks.addExternalDevice.mockReturnValue({ id: 'device-1' });

        const result = await handleLoadExternalPlugin.execute({
            type: 'loadExternalPlugin',
            payload: { pluginId: 'plugin-1' },
        });

        expect(mocks.addTrack).toHaveBeenCalledWith({ name: 'Synth', kind: 'midi' });
        expect(result).toEqual({ status: 'written' });
    });

    it('falls back to a default name and an audio track when the plugin is unknown', async () => {
        mocks.findPluginByName.mockReturnValue(undefined);
        mocks.addTrack.mockReturnValue({ id: 'audio-track' });
        mocks.addExternalDevice.mockReturnValue({ id: 'device-1' });

        await handleLoadExternalPlugin.execute({
            type: 'loadExternalPlugin',
            payload: { pluginId: 'plugin-1' },
        });

        expect(mocks.addTrack).toHaveBeenCalledWith({ name: 'Plugin', kind: 'audio' });
        // addExternalDevice uses the raw pluginId as the name when no plugin is found.
        expect(mocks.addExternalDevice).toHaveBeenCalledWith('audio-track', 'plugin-1', 'plugin-1');
    });

    it('provides a description naming the plugin id', () => {
        const desc = handleLoadExternalPlugin.describe({
            type: 'loadExternalPlugin',
            payload: { pluginId: 'compressor-x' },
        });
        expect(desc.label).toBe('Load external plugin "compressor-x"');
    });

    it('is not undoable', () => {
        expect(handleLoadExternalPlugin.undoable).toBe(false);
    });
});
