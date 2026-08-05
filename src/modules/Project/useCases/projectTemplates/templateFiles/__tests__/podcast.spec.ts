import { beforeEach, describe, expect, it, vi } from 'vitest';

const { builderMocks } = vi.hoisted(() => ({
    builderMocks: {
        addMarkers: vi.fn(),
        addSections: vi.fn(),
        addSend: vi.fn(),
        attachSidechainCompressor: vi.fn(),
        createAudioTrack: vi.fn(() => ({ id: 'track-audio' })),
        createBus: vi.fn(() => ({ id: 'track-bus' })),
        createFolder: vi.fn(() => ({ id: 'track-folder' })),
        createVca: vi.fn(() => ({ id: 'vca' })),
        finalizeTemplate: vi.fn().mockResolvedValue(undefined),
        initProject: vi.fn(() => ({ id: 'track-master' })),
        setMasterChain: vi.fn(),
    },
}));

vi.mock('#/modules/Transport/stores', () => {
    throw new Error('Podcast template must not import Transport stores');
});
vi.mock('#/modules/Transport/useCases', () => ({
    replaceTempoMap: vi.fn(),
    replaceTimeSignatureMap: vi.fn(),
}));
vi.mock('../../templateHelpers/addMarkers', () => ({ addMarkers: builderMocks.addMarkers }));
vi.mock('../../templateHelpers/addSections', () => ({ addSections: builderMocks.addSections }));
vi.mock('../../templateHelpers/addSend', () => ({ addSend: builderMocks.addSend }));
vi.mock('../../templateHelpers/attachSidechainCompressor', () => ({
    attachSidechainCompressor: builderMocks.attachSidechainCompressor,
}));
vi.mock('../../templateHelpers/createAudioTrack', () => ({ createAudioTrack: builderMocks.createAudioTrack }));
vi.mock('../../templateHelpers/createBus', () => ({ createBus: builderMocks.createBus }));
vi.mock('../../templateHelpers/createFolder', () => ({ createFolder: builderMocks.createFolder }));
vi.mock('../../templateHelpers/createVca', () => ({ createVca: builderMocks.createVca }));
vi.mock('../../templateHelpers/finalizeTemplate', () => ({ finalizeTemplate: builderMocks.finalizeTemplate }));
vi.mock('../../templateHelpers/initProject', () => ({ initProject: builderMocks.initProject }));
vi.mock('../../templateHelpers/setMasterChain', () => ({ setMasterChain: builderMocks.setMasterChain }));

import { createPodcastTemplate } from '../podcast';

describe('createPodcastTemplate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('initializes with podcast settings (chromatic, 120 bpm)', async () => {
        await createPodcastTemplate();
        expect(builderMocks.initProject).toHaveBeenCalledExactlyOnceWith({
            name: 'Podcast',
            bpm: 120,
            timeSig: [4, 4],
            keyRoot: 0,
            scaleName: 'chromatic',
            loopEnd: 64,
        });
    });

    it('creates VCA groups for voices and music', async () => {
        await createPodcastTemplate();
        const calls = builderMocks.createVca.mock.calls as Array<Array<{ name?: string }>>;
        expect(calls.map((c) => c[0]?.name)).toEqual(['Voices VCA', 'Music VCA']);
    });

    it('finalizes with sidechain routes for ducking', async () => {
        await createPodcastTemplate();
        const call = builderMocks.finalizeTemplate.mock.calls[0]?.[0];
        expect(call.sidechainRoutes).toHaveLength(1);
        expect(call.vcaGroups).toHaveLength(2);
    });
});
