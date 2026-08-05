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
    throw new Error('HipHopTrap template must not import Transport stores');
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

import { createHipHopTrapTemplate } from '../hipHopTrap';

describe('createHipHopTrapTemplate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('initializes with hip-hop settings (F minor, 140 bpm)', async () => {
        await createHipHopTrapTemplate();
        expect(builderMocks.initProject).toHaveBeenCalledExactlyOnceWith({
            name: 'Hip-Hop / Trap',
            bpm: 140,
            timeSig: [4, 4],
            keyRoot: 5,
            scaleName: 'minor',
            loopEnd: 64,
        });
    });

    it('sets an Fm-Db-Bbm-Eb chord progression', async () => {
        await createHipHopTrapTemplate();
        expect(builderMocks.setChordProgression).toHaveBeenCalledExactlyOnceWith({
            chords: [
                { root: 5, quality: 'minor', duration: 16 },
                { root: 1, quality: 'major', duration: 16 },
                { root: 10, quality: 'minor', duration: 16 },
                { root: 3, quality: 'major', duration: 16 },
            ],
            repeatUntilBeat: 64,
        });
    });

    it('creates four VCA groups', async () => {
        await createHipHopTrapTemplate();
        expect(builderMocks.createVca).toHaveBeenCalledTimes(4);
    });

    it('finalizes with sidechain route for 808 ducking', async () => {
        await createHipHopTrapTemplate();
        const call = builderMocks.finalizeTemplate.mock.calls[0]?.[0];
        expect(call.sidechainRoutes).toHaveLength(1);
        expect(call.vcaGroups).toHaveLength(4);
    });
});
