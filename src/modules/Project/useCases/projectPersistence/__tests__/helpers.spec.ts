import { describe, it, expect, beforeEach, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { clearUndoHistory } from '#/modules/Command/useCases/clearUndoHistory';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';

import { type ProjectData } from '../../../models/ProjectData';
import { hydrateModuleStoresFromProjectData } from '../helpers/hydrateModuleStoresFromProjectData';
import { resetModuleStoresToDefault } from '../helpers/resetModuleStoresToDefault';
import { verifyAudioBufferReferences } from '../helpers/verifyAudioBufferReferences';

const mocks = vi.hoisted(() => ({
    undoStoreSet: vi.fn(),
    trackStoreSet: vi.fn(),
    markerStoreSet: vi.fn(),
    takeLaneStoreSet: vi.fn(),
    transportStoreSet: vi.fn(),
    tempoMapStoreSet: vi.fn(),
    timeSignatureMapStoreSet: vi.fn(),
    automationStoreSet: vi.fn(),
    midiStoreSet: vi.fn(),
    setSidechainRoutes: vi.fn(),
    notifyUser: vi.fn(),
}));

vi.mock('#/modules/Command/stores/undoStore', () => ({
    undoStore: { value: { past: [1], future: [2] }, set: mocks.undoStoreSet },
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        ...actual,
        trackStore: { value: null, set: mocks.trackStoreSet },
        markerStore: { value: null, set: mocks.markerStoreSet },
        takeLaneStore: { value: null, set: mocks.takeLaneStoreSet },
    };
});

vi.mock('#/modules/Transport/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Transport/stores')>();
    return {
        ...actual,
        transportStore: { value: null, set: mocks.transportStoreSet },
        tempoMapStore: { value: null, set: mocks.tempoMapStoreSet },
        timeSignatureMapStore: { value: null, set: mocks.timeSignatureMapStoreSet },
    };
});

vi.mock('#/modules/Automation/stores/automationStore', () => ({
    automationStore: { value: null, set: mocks.automationStoreSet },
}));

vi.mock('#/modules/MIDI/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/MIDI/stores')>();
    return {
        ...actual,
        midiStore: { value: null, set: mocks.midiStoreSet },
    };
});

vi.mock('#/modules/Routing/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Routing/useCases')>();
    return {
        ...actual,
        setSidechainRoutes: mocks.setSidechainRoutes,
    };
});

vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: { has: vi.fn(() => false) },
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

describe('clearUndoHistory', () => {
    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
    });

    it('clears undo stacks', async () => {
        clearUndoHistory();
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({ past: [], future: [] });
    });
});

describe('resetModuleStoresToDefault', () => {
    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
    });

    it('resets all module stores and sidechain routes', async () => {
        resetModuleStoresToDefault();

        expect(mocks.trackStoreSet).toHaveBeenCalledWith({ tracks: [], selectedTrackId: null });
        expect(mocks.transportStoreSet).toHaveBeenCalledWith(defaultTransportState);
        expect(mocks.automationStoreSet).toHaveBeenCalledWith({ lanes: [] });
        expect(mocks.midiStoreSet).toHaveBeenCalledWith({
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        expect(mocks.tempoMapStoreSet).toHaveBeenCalledWith({ changes: [] });
        expect(mocks.timeSignatureMapStoreSet).toHaveBeenCalledWith({ changes: [] });
        expect(mocks.markerStoreSet).toHaveBeenCalledWith({ markers: [], sections: [] });
        expect(mocks.takeLaneStoreSet).toHaveBeenCalledWith({ lanes: [] });
        expect(mocks.setSidechainRoutes).toHaveBeenCalledWith([]);
    });
});

describe('hydrateModuleStoresFromProjectData', () => {
    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
    });

    it('applies arrangement tracks', async () => {
        const data = {
            version: 1,
            arrangement: { tracks: [] },
            automation: { lanes: [] },
        } as unknown as ProjectData;

        hydrateModuleStoresFromProjectData(data);

        expect(mocks.trackStoreSet).toHaveBeenCalled();
    });
});

describe('verifyAudioBufferReferences', () => {
    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
    });

    it('warns when a referenced buffer is missing', async () => {
        const { trackStore } = await import('#/modules/Arrangement/stores');

        trackStore.value = {
            tracks: [
                {
                    id: 'tr',
                    name: 'Tr',
                    kind: 'audio',
                    clips: [
                        {
                            id: 'c1',
                            trackId: 'tr',
                            name: 'Clip A',
                            startBeat: 0,
                            endBeat: 4,
                            type: 'audio',
                            audioBufferId: 'buf-missing',
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                            gain: 1,
                            color: '',
                            locked: false,
                            muted: false,
                        },
                    ],
                    devices: [],
                    gain: 1,
                    pan: 0,
                    muted: false,
                    solo: false,
                    armed: false,
                    disabled: false,
                    height: 48,
                    outputId: 'hw_out',
                    sends: [],
                    parentId: null,
                    color: '',
                },
            ],
            selectedTrackId: null,
        } as any;

        verifyAudioBufferReferences();

        expect(mocks.notifyUser).toHaveBeenCalledWith(
            expect.stringContaining('Missing audio buffers for: Clip A'),
            'warning'
        );
    });
});
