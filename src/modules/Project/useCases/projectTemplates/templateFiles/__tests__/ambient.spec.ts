import { beforeEach, describe, expect, it, vi } from 'vitest';

const { builderMocks } = vi.hoisted(() => {
    return {
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
    };
});

vi.mock('#/modules/Transport/stores', () => {
    throw new Error('Ambient template must not import Transport stores');
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

import { createAmbientTemplate } from '../ambient';

describe('createAmbientTemplate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('initializes the project with ambient settings', async () => {
        await createAmbientTemplate();
        expect(builderMocks.initProject).toHaveBeenCalledExactlyOnceWith({
            name: 'Ambient',
            bpm: 60,
            timeSig: [4, 4],
            keyRoot: 0,
            scaleName: 'lydian',
            loopEnd: 128,
        });
    });

    it('creates three buses (Cathedral Reverb, Tape Delay, Spring Reverb)', async () => {
        await createAmbientTemplate();
        expect(builderMocks.createBus).toHaveBeenCalledTimes(3);
        const calls = builderMocks.createBus.mock.calls as Array<Array<{ name?: string }>>;
        const busNames = calls.map((call) => call[0]?.name);
        expect(busNames).toEqual(['Cathedral Reverb', 'Tape Delay', 'Spring Reverb']);
    });

    it('sets a 4-chord progression that repeats to beat 128', async () => {
        await createAmbientTemplate();
        expect(builderMocks.setChordProgression).toHaveBeenCalledExactlyOnceWith({
            chords: [
                { root: 0, quality: '9', duration: 32 },
                { root: 5, quality: 'maj7', duration: 32 },
                { root: 9, quality: 'min9', duration: 32 },
                { root: 7, quality: '7', duration: 32 },
            ],
            repeatUntilBeat: 128,
        });
    });

    it('adds four sections spanning the full project', async () => {
        await createAmbientTemplate();
        expect(builderMocks.addSections).toHaveBeenCalledExactlyOnceWith([
            { startBeat: 0, endBeat: 32, name: 'Dawn', color: 'oklch(0.38 0.08 70)' },
            { startBeat: 32, endBeat: 64, name: 'Horizon', color: 'oklch(0.40 0.07 200)' },
            { startBeat: 64, endBeat: 96, name: 'Drift', color: 'oklch(0.38 0.08 300)' },
            { startBeat: 96, endBeat: 128, name: 'Dusk', color: 'oklch(0.38 0.08 270)' },
        ]);
    });

    it('finalizes the template with all tracks and VCA groups', async () => {
        await createAmbientTemplate();
        expect(builderMocks.finalizeTemplate).toHaveBeenCalledTimes(1);
        const finalizeCall = builderMocks.finalizeTemplate.mock.calls[0]?.[0];
        expect(finalizeCall.tracks).toHaveLength(17);
        expect(finalizeCall.vcaGroups).toHaveLength(3);
    });

    it('wires sends from every drone and melodic track to the reverb/delay buses', async () => {
        await createAmbientTemplate();
        // 3 drones × 2 sends + 2 pads × 2 sends + 3 melodic × 2 sends = 16 total
        expect(builderMocks.addSend).toHaveBeenCalledTimes(16);
        const calls = builderMocks.addSend.mock.calls as Array<Array<{ to?: { id?: string } }>>;
        // Every send targets a bus (id: 'track-bus')
        for (const call of calls) {
            const target = call[0]?.to;
            expect(target).toEqual({ id: 'track-bus' });
        }
    });
});
