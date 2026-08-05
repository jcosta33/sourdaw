import { beforeEach, describe, expect, it, vi } from 'vitest';

const { builderMocks } = vi.hoisted(() => ({
    builderMocks: {
        addDeviceChain: vi.fn(),
        addMarkers: vi.fn(),
        addSections: vi.fn(),
        addSend: vi.fn(),
        attachSidechainCompressor: vi.fn(() => 'sidechain-id'),
        createAudioTrack: vi.fn(() => ({ id: 'track-audio' })),
        createBus: vi.fn(() => ({ id: 'track-bus' })),
        createFolder: vi.fn(() => ({ id: 'track-folder' })),
        createInstrumentTrack: vi.fn(() => ({ id: 'track-instr' })),
        createVca: vi.fn(() => ({ id: 'vca' })),
        finalizeTemplate: vi.fn().mockResolvedValue(undefined),
        initProject: vi.fn(() => ({ id: 'track-master' })),
        setChordProgression: vi.fn(),
        setMasterChain: vi.fn(),
    },
}));

vi.mock('#/modules/Transport/stores', () => {
    throw new Error('EDM template must not import Transport stores');
});
vi.mock('#/modules/Transport/useCases', () => ({
    replaceTempoMap: vi.fn(),
    replaceTimeSignatureMap: vi.fn(),
}));
vi.mock('../../templateHelpers/addDeviceChain', () => ({ addDeviceChain: builderMocks.addDeviceChain }));
vi.mock('../../templateHelpers/addMarkers', () => ({ addMarkers: builderMocks.addMarkers }));
vi.mock('../../templateHelpers/addSections', () => ({ addSections: builderMocks.addSections }));
vi.mock('../../templateHelpers/addSend', () => ({ addSend: builderMocks.addSend }));
vi.mock('../../templateHelpers/attachSidechainCompressor', () => ({
    attachSidechainCompressor: builderMocks.attachSidechainCompressor,
}));
vi.mock('../../templateHelpers/createAudioTrack', () => ({ createAudioTrack: builderMocks.createAudioTrack }));
vi.mock('../../templateHelpers/createBus', () => ({ createBus: builderMocks.createBus }));
vi.mock('../../templateHelpers/createFolder', () => ({ createFolder: builderMocks.createFolder }));
vi.mock('../../templateHelpers/createInstrumentTrack', () => ({
    createInstrumentTrack: builderMocks.createInstrumentTrack,
}));
vi.mock('../../templateHelpers/createVca', () => ({ createVca: builderMocks.createVca }));
vi.mock('../../templateHelpers/finalizeTemplate', () => ({ finalizeTemplate: builderMocks.finalizeTemplate }));
vi.mock('../../templateHelpers/initProject', () => ({ initProject: builderMocks.initProject }));
vi.mock('../../templateHelpers/setChordProgression', () => ({
    setChordProgression: builderMocks.setChordProgression,
}));
vi.mock('../../templateHelpers/setMasterChain', () => ({ setMasterChain: builderMocks.setMasterChain }));

import { createEdmTemplate } from '../edm';

describe('createEdmTemplate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('initializes with EDM settings (C minor, 128 bpm, 128 beats)', async () => {
        await createEdmTemplate();
        expect(builderMocks.initProject).toHaveBeenCalledExactlyOnceWith({
            name: 'EDM',
            bpm: 128,
            timeSig: [4, 4],
            keyRoot: 0,
            scaleName: 'minor',
            loopEnd: 128,
        });
    });

    it('sets an i-VI-III-VII minor chord progression', async () => {
        await createEdmTemplate();
        expect(builderMocks.setChordProgression).toHaveBeenCalledExactlyOnceWith({
            chords: [
                { root: 0, quality: 'minor', duration: 16 },
                { root: 8, quality: 'major', duration: 16 },
                { root: 3, quality: 'major', duration: 16 },
                { root: 10, quality: 'major', duration: 16 },
            ],
            repeatUntilBeat: 128,
        });
    });

    it('creates four VCA groups (drums, bass, leads, pads)', async () => {
        await createEdmTemplate();
        expect(builderMocks.createVca).toHaveBeenCalledTimes(4);
        const calls = builderMocks.createVca.mock.calls as Array<Array<{ name?: string }>>;
        expect(calls.map((c) => c[0]?.name)).toEqual(['Drums VCA', 'Bass VCA', 'Leads VCA', 'Pads VCA']);
    });

    it('finalizes with sidechain routes for kick ducking', async () => {
        await createEdmTemplate();
        const call = builderMocks.finalizeTemplate.mock.calls[0]?.[0];
        expect(call.sidechainRoutes).toHaveLength(2);
        expect(call.vcaGroups).toHaveLength(4);
    });
});
