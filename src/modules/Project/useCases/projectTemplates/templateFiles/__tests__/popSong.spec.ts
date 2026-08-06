import { beforeEach, describe, expect, it, vi } from 'vitest';

const { builderMocks } = vi.hoisted(() => ({
    builderMocks: {
        addDeviceChain: vi.fn(),
        addMarkers: vi.fn(),
        addSections: vi.fn(),
        addSend: vi.fn(),
        attachSidechainCompressor: vi.fn(() => 'sc-id'),
        createBus: vi.fn(() => ({ id: 'track-bus' })),
        createFolder: vi.fn(() => ({ id: 'track-folder' })),
        createInstrumentTrack: vi.fn(() => ({ id: 'track-instr' })),
        createVca: vi.fn(() => ({ id: 'vca' })),
        finalizeTemplate: vi.fn().mockResolvedValue(undefined),
        initProject: vi.fn(() => ({ id: 'track-master' })),
        setChordProgression: vi.fn(),
        setGroove: vi.fn(),
        setMasterChain: vi.fn(),
    },
}));

vi.mock('#/modules/Transport/stores', () => {
    throw new Error('PopSong template must not import Transport stores');
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
vi.mock('../../templateHelpers/setGroove', () => ({ setGroove: builderMocks.setGroove }));
vi.mock('../../templateHelpers/setMasterChain', () => ({ setMasterChain: builderMocks.setMasterChain }));

import { createPopSongTemplate } from '../popSong';

describe('createPopSongTemplate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('initializes with pop settings (C major, 100 bpm)', async () => {
        await createPopSongTemplate();
        expect(builderMocks.initProject).toHaveBeenCalledExactlyOnceWith({
            name: 'Pop Song',
            bpm: 100,
            timeSig: [4, 4],
            keyRoot: 0,
            scaleName: 'major',
            loopEnd: 64,
        });
    });

    it('applies a subtle pop swing groove', async () => {
        await createPopSongTemplate();
        expect(builderMocks.setGroove).toHaveBeenCalledExactlyOnceWith({
            id: 'pop-subtle-swing',
            name: 'Subtle Pop Swing',
            offsets: [0, 0.02, 0, 0.02],
            resolution: 0.25,
            intensity: 0.25,
        });
    });

    it('sets an I-vi-IV-V chord progression', async () => {
        await createPopSongTemplate();
        expect(builderMocks.setChordProgression).toHaveBeenCalledExactlyOnceWith({
            chords: [
                { root: 0, quality: 'major', duration: 16 },
                { root: 9, quality: 'minor', duration: 16 },
                { root: 5, quality: 'major', duration: 16 },
                { root: 7, quality: 'major', duration: 16 },
            ],
            repeatUntilBeat: 64,
        });
    });

    it('adds five song-structure sections', async () => {
        await createPopSongTemplate();
        expect(builderMocks.addSections).toHaveBeenCalledExactlyOnceWith([
            { startBeat: 0, endBeat: 8, name: 'Intro', color: 'oklch(0.38 0.08 270)' },
            { startBeat: 8, endBeat: 24, name: 'Verse', color: 'oklch(0.40 0.07 200)' },
            { startBeat: 24, endBeat: 40, name: 'Chorus', color: 'oklch(0.38 0.09 20)' },
            { startBeat: 40, endBeat: 52, name: 'Bridge', color: 'oklch(0.38 0.08 300)' },
            { startBeat: 52, endBeat: 64, name: 'Outro', color: 'oklch(0.38 0.08 270)' },
        ]);
    });

    it('creates three VCA groups', async () => {
        await createPopSongTemplate();
        expect(builderMocks.createVca).toHaveBeenCalledTimes(3);
        const calls = builderMocks.createVca.mock.calls as Array<Array<{ name?: string }>>;
        expect(calls.map((c) => c[0]?.name)).toEqual(['Drums VCA', 'Melody VCA', 'Vocals VCA']);
    });

    it('finalizes with sidechain routes for kick-to-bass ducking', async () => {
        await createPopSongTemplate();
        const call = builderMocks.finalizeTemplate.mock.calls[0]?.[0];
        expect(call.tracks).toHaveLength(19);
        expect(call.vcaGroups).toHaveLength(3);
        expect(call.sidechainRoutes).toHaveLength(1);
    });
});
