import { beforeEach, describe, expect, it, vi } from 'vitest';

const { builderMocks } = vi.hoisted(() => ({
    builderMocks: {
        addDeviceChain: vi.fn(),
        addMarkers: vi.fn(),
        addSections: vi.fn(),
        addSend: vi.fn(),
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
    throw new Error('RockBand template must not import Transport stores');
});
vi.mock('#/modules/Transport/useCases', () => ({
    replaceTempoMap: vi.fn(),
    replaceTimeSignatureMap: vi.fn(),
}));
vi.mock('../../templateHelpers/addDeviceChain', () => ({ addDeviceChain: builderMocks.addDeviceChain }));
vi.mock('../../templateHelpers/addMarkers', () => ({ addMarkers: builderMocks.addMarkers }));
vi.mock('../../templateHelpers/addSections', () => ({ addSections: builderMocks.addSections }));
vi.mock('../../templateHelpers/addSend', () => ({ addSend: builderMocks.addSend }));
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

import { createRockBandTemplate } from '../rockBand';

describe('createRockBandTemplate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('initializes with rock settings (E minor, 120 bpm)', async () => {
        await createRockBandTemplate();
        expect(builderMocks.initProject).toHaveBeenCalledExactlyOnceWith({
            name: 'Rock Band',
            bpm: 120,
            timeSig: [4, 4],
            keyRoot: 4,
            scaleName: 'minor',
            loopEnd: 64,
        });
    });

    it('sets an Em-C-G-D chord progression', async () => {
        await createRockBandTemplate();
        expect(builderMocks.setChordProgression).toHaveBeenCalledExactlyOnceWith({
            chords: [
                { root: 4, quality: 'minor', duration: 16 },
                { root: 0, quality: 'major', duration: 16 },
                { root: 7, quality: 'major', duration: 16 },
                { root: 2, quality: 'major', duration: 16 },
            ],
            repeatUntilBeat: 64,
        });
    });

    it('creates four VCA groups (drums, bass, guitars, vocals)', async () => {
        await createRockBandTemplate();
        expect(builderMocks.createVca).toHaveBeenCalledTimes(4);
        const calls = builderMocks.createVca.mock.calls as Array<Array<{ name?: string }>>;
        expect(calls.map((c) => c[0]?.name)).toEqual(['Drums VCA', 'Bass VCA', 'Guitars VCA', 'Vocals VCA']);
    });

    it('finalizes without sidechain routes', async () => {
        await createRockBandTemplate();
        const call = builderMocks.finalizeTemplate.mock.calls[0]?.[0];
        expect(call.vcaGroups).toHaveLength(4);
    });
});
