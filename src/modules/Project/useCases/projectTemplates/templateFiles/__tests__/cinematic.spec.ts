import { beforeEach, describe, expect, it, vi } from 'vitest';

const { builderMocks, transportMocks } = vi.hoisted(() => {
    const createTrack = vi.fn(() => ({ id: 'track' }));
    return {
        builderMocks: {
            addDeviceChain: vi.fn(),
            addMarkers: vi.fn(),
            addSections: vi.fn(),
            addSend: vi.fn(),
            createBus: createTrack,
            createFolder: createTrack,
            createInstrumentTrack: createTrack,
            createVca: vi.fn(() => ({ id: 'vca' })),
            finalizeTemplate: vi.fn().mockResolvedValue(undefined),
            initProject: createTrack,
            setChordProgression: vi.fn(),
            setMasterChain: vi.fn(),
        },
        transportMocks: {
            replaceTempoMap: vi.fn(),
            replaceTimeSignatureMap: vi.fn(),
        },
    };
});

vi.mock('#/modules/Transport/stores', () => {
    throw new Error('Cinematic template must not import Transport stores');
});

vi.mock('#/modules/Transport/useCases', () => transportMocks);

vi.mock('../../templateHelpers/builder', () => builderMocks);

import { createCinematicTemplate } from '../cinematic';

describe('createCinematicTemplate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('replaces each Transport map once through the bulk boundaries', async () => {
        await createCinematicTemplate();

        expect(transportMocks.replaceTimeSignatureMap).toHaveBeenCalledExactlyOnceWith({
            changes: [
                { beat: 0, numerator: 4, denominator: 4 },
                { beat: 48, numerator: 6, denominator: 8 },
                { beat: 72, numerator: 4, denominator: 4 },
            ],
        });
        expect(transportMocks.replaceTempoMap).toHaveBeenCalledExactlyOnceWith({
            changes: [
                { beat: 0, tempo: 90, curve: 'instant' },
                { beat: 88, tempo: 72, curve: 'linear' },
            ],
        });
        const timeSignatureCallOrder = transportMocks.replaceTimeSignatureMap.mock.invocationCallOrder[0]!;
        const tempoCallOrder = transportMocks.replaceTempoMap.mock.invocationCallOrder[0]!;
        expect(timeSignatureCallOrder).toBeLessThan(tempoCallOrder);
    });
});
