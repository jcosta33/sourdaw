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
        setGroove: vi.fn(),
        setMasterChain: vi.fn(),
    },
}));

vi.mock('#/modules/Transport/stores', () => {
    throw new Error('Lo-fi template must not import Transport stores');
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
vi.mock('../../templateHelpers/setGroove', () => ({ setGroove: builderMocks.setGroove }));
vi.mock('../../templateHelpers/setMasterChain', () => ({ setMasterChain: builderMocks.setMasterChain }));

import { createLofiTemplate } from '../lofi';

describe('createLofiTemplate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('initializes the project with lo-fi settings (D dorian, 80 bpm)', async () => {
        await createLofiTemplate();
        expect(builderMocks.initProject).toHaveBeenCalledExactlyOnceWith({
            name: 'Lo-fi',
            bpm: 80,
            timeSig: [4, 4],
            keyRoot: 2,
            scaleName: 'dorian',
            loopEnd: 64,
        });
    });

    it('applies an MPC-60 groove template with 65% swing', async () => {
        await createLofiTemplate();
        expect(builderMocks.setGroove).toHaveBeenCalledExactlyOnceWith({
            id: 'mpc60-65',
            name: 'MPC-60 Swing 65%',
            offsets: [0, 0.13, 0, 0.13],
            resolution: 0.25,
            intensity: 0.6,
        });
    });

    it('creates three buses (Spring Reverb, Tape Delay, Vinyl Bus)', async () => {
        await createLofiTemplate();
        expect(builderMocks.createBus).toHaveBeenCalledTimes(3);
        const calls = builderMocks.createBus.mock.calls as Array<Array<{ name?: string }>>;
        expect(calls.map((c) => c[0]?.name)).toEqual(['Spring Reverb', 'Tape Delay', 'Vinyl Bus']);
    });

    it('sets a Dmin9-G7-Cmaj7-Fmaj7 chord progression', async () => {
        await createLofiTemplate();
        expect(builderMocks.setChordProgression).toHaveBeenCalledExactlyOnceWith({
            chords: [
                { root: 2, quality: 'min9', duration: 16 },
                { root: 7, quality: '7', duration: 16 },
                { root: 0, quality: 'maj7', duration: 16 },
                { root: 5, quality: 'maj7', duration: 16 },
            ],
            repeatUntilBeat: 64,
        });
    });

    it('adds four lo-fi sections (Intro, Loop A, Loop B, Outro)', async () => {
        await createLofiTemplate();
        expect(builderMocks.addSections).toHaveBeenCalledExactlyOnceWith([
            { startBeat: 0, endBeat: 8, name: 'Intro', color: 'oklch(0.38 0.08 270)' },
            { startBeat: 8, endBeat: 32, name: 'Loop A', color: 'oklch(0.40 0.07 200)' },
            { startBeat: 32, endBeat: 56, name: 'Loop B', color: 'oklch(0.40 0.08 150)' },
            { startBeat: 56, endBeat: 64, name: 'Outro', color: 'oklch(0.38 0.08 270)' },
        ]);
    });

    it('finalizes with all tracks and 2 VCA groups', async () => {
        await createLofiTemplate();
        const call = builderMocks.finalizeTemplate.mock.calls[0]?.[0];
        expect(call.tracks).toHaveLength(17);
        expect(call.vcaGroups).toHaveLength(2);
    });
});
