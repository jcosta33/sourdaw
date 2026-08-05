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
    throw new Error('SingerSongwriter template must not import Transport stores');
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

import { createSingerSongwriterTemplate } from '../singerSongwriter';

describe('createSingerSongwriterTemplate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('initializes the project with songwriter settings (G major, 90 bpm)', async () => {
        await createSingerSongwriterTemplate();
        expect(builderMocks.initProject).toHaveBeenCalledExactlyOnceWith({
            name: 'Singer-Songwriter',
            bpm: 90,
            timeSig: [4, 4],
            keyRoot: 7,
            scaleName: 'major',
            loopEnd: 64,
        });
    });

    it('creates three FX buses', async () => {
        await createSingerSongwriterTemplate();
        expect(builderMocks.createBus).toHaveBeenCalledTimes(3);
        const calls = builderMocks.createBus.mock.calls as Array<Array<{ name?: string }>>;
        expect(calls.map((c) => c[0]?.name)).toEqual(['Plate Short', 'Plate Long', 'Slap Delay']);
    });

    it('sets a G-Em-C-D chord progression', async () => {
        await createSingerSongwriterTemplate();
        expect(builderMocks.setChordProgression).toHaveBeenCalledExactlyOnceWith({
            chords: [
                { root: 7, quality: 'major', duration: 16 },
                { root: 4, quality: 'minor', duration: 16 },
                { root: 0, quality: 'major', duration: 16 },
                { root: 2, quality: 'major', duration: 16 },
            ],
            repeatUntilBeat: 64,
        });
    });

    it('adds five song-structure sections (Verse/Chorus/Bridge)', async () => {
        await createSingerSongwriterTemplate();
        expect(builderMocks.addSections).toHaveBeenCalledExactlyOnceWith([
            { startBeat: 0, endBeat: 16, name: 'Verse', color: 'oklch(0.40 0.07 200)' },
            { startBeat: 16, endBeat: 32, name: 'Chorus', color: 'oklch(0.38 0.09 20)' },
            { startBeat: 32, endBeat: 40, name: 'Verse', color: 'oklch(0.40 0.07 200)' },
            { startBeat: 40, endBeat: 48, name: 'Bridge', color: 'oklch(0.38 0.08 300)' },
            { startBeat: 48, endBeat: 64, name: 'Chorus', color: 'oklch(0.38 0.09 20)' },
        ]);
    });

    it('finalizes with 11 tracks and 2 VCA groups', async () => {
        await createSingerSongwriterTemplate();
        const call = builderMocks.finalizeTemplate.mock.calls[0]?.[0];
        expect(call.tracks).toHaveLength(11);
        expect(call.vcaGroups).toHaveLength(2);
        expect(call.selectTrackId).toBe('track-instr');
    });

    it('wires sends from vocals and instruments to FX buses', async () => {
        await createSingerSongwriterTemplate();
        // Lead vocal: 2, Harmony: 2, Acoustic Gtr: 2, Piano: 2 = 8 total
        expect(builderMocks.addSend).toHaveBeenCalledTimes(8);
    });
});
