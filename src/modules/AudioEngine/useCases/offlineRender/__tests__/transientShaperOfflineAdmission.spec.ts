import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTrack } from '#/modules/Arrangement/useCases';

import { type NativeGraphAvailability } from '../../../repositories/nativeGraph/probeNativeGraphTransport';
import { selectOfflineRenderEngine } from '../selectOfflineRenderEngine';

const state = vi.hoisted(() => ({
    availability: { available: false, reason: 'browser', runtime: 'browser' } as NativeGraphAvailability,
}));
vi.mock('../../../repositories/nativeGraph/probeNativeGraphTransport', () => ({
    probeNativeGraphTransport: () => Promise.resolve(state.availability),
}));
afterEach(() => vi.restoreAllMocks());

const transport = {
    registerTimelineSample: vi.fn(),
    beginLevainBank: vi.fn(),
    registerLevainSample: vi.fn(),
    commitLevainBank: vi.fn(),
    releaseLevainBank: vi.fn(),
    renderGraphOffline: vi.fn(),
    mapGraphBatch: vi.fn(),
    applyGraphCommands: vi.fn(),
};
const shaper = {
    id: 'shaper',
    name: 'Transient Shaper',
    type: 'transient-shaper',
    bypassed: false,
    parameterValues: { attackGain: 1.5, sustainGain: 0.5 },
};
const track = { ...createTrack({ id: 'audio', name: 'Drums', kind: 'audio' }), devices: [shaper] };
const input = { renderableTracks: [track], scheduledTracks: [track], sidechainRoutes: [], gainEnvelopes: {} };

describe('Transient Shaper offline backend admission', () => {
    it('selects the actual native body for an otherwise eligible shaper chain', async () => {
        state.availability = { available: true, transport };
        expect(await selectOfflineRenderEngine(input)).toEqual({ engine: 'native/offline', transport });
    });
    it('uses WASM/Web Audio when native is unavailable', async () => {
        state.availability = { available: false, reason: 'browser', runtime: 'browser' };
        expect(await selectOfflineRenderEngine(input)).toEqual({
            engine: 'web-audio/offline',
            reason: 'browser',
            degraded: false,
        });
    });
    it('retains the existing external-plugin offline limit honestly', async () => {
        state.availability = { available: true, transport };
        const hosted = {
            ...track,
            devices: [
                shaper,
                {
                    id: 'plugin',
                    name: 'Plugin',
                    type: 'external-plugin',
                    bypassed: false,
                    parameterValues: {},
                    externalPluginId: 'clap:test',
                    externalInstanceId: 'attached',
                },
            ],
        };
        expect(
            await selectOfflineRenderEngine({ ...input, renderableTracks: [hosted], scheduledTracks: [hosted] })
        ).toMatchObject({ engine: 'web-audio/offline', degraded: true });
    });
});
