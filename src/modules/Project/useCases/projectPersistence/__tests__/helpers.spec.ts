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

vi.mock('#/modules/Arrangement/stores/trackStore', () => ({
    trackStore: { value: null, set: mocks.trackStoreSet },
}));

vi.mock('#/modules/Arrangement/stores/markerStore', () => ({
    markerStore: { value: null, set: mocks.markerStoreSet },
}));

vi.mock('#/modules/Arrangement/stores/takeLaneStore', () => ({
    takeLaneStore: { value: null, set: mocks.takeLaneStoreSet },
}));

vi.mock('#/modules/Transport/stores/transportStore', () => ({
    transportStore: { value: null, set: mocks.transportStoreSet },
}));

vi.mock('#/modules/Transport/stores/tempoMapStore', () => ({
    tempoMapStore: { value: null, set: mocks.tempoMapStoreSet },
}));

vi.mock('#/modules/Transport/stores/timeSignatureMapStore', () => ({
    timeSignatureMapStore: { value: null, set: mocks.timeSignatureMapStoreSet },
}));

vi.mock('#/modules/Automation/stores/automationStore', () => ({
    automationStore: { value: null, set: mocks.automationStoreSet },
}));

vi.mock('#/modules/MIDI/stores/midiStore', () => ({
    midiStore: { value: null, set: mocks.midiStoreSet },
}));

vi.mock('#/modules/Routing/useCases/sidechain/setSidechainRoutes', () => ({
    setSidechainRoutes: mocks.setSidechainRoutes,
}));

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

    it('clears undo stacks', () => {
        clearUndoHistory();
        expect(mocks.undoStoreSet).toHaveBeenCalledWith({ past: [], future: [] });
    });
});

describe('resetModuleStoresToDefault', () => {
    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
    });

    it('resets all module stores and sidechain routes', () => {
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

    it('applies arrangement tracks', () => {
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
                    freezeState: { status: 'unfrozen' },
                },
            ],
            selectedTrackId: null,
        } as unknown as typeof trackStore.value;

        verifyAudioBufferReferences();

        expect(mocks.notifyUser).toHaveBeenCalledWith(
            expect.stringContaining('Missing audio buffers for: Clip A'),
            'warning'
        );
    });
});
