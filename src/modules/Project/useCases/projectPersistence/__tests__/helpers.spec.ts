import { describe, it, expect, beforeEach, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { type TrackStoreState } from '#/modules/Arrangement/stores';
import { defaultTransportState } from '#/modules/Transport/useCases';

import { resetModuleStoresToDefault } from '../helpers/resetModuleStoresToDefault';
import { verifyAudioBufferReferences } from '../helpers/verifyAudioBufferReferences';

const mocks = vi.hoisted(() => ({
    resetArrangementStoresForProject: vi.fn(),
    trackStoreValue: { value: null as TrackStoreState | null },
    trackStoreSet: vi.fn(),
    transportStoreSet: vi.fn(),
    tempoMapStoreSet: vi.fn(),
    timeSignatureMapStoreSet: vi.fn(),
    automationStoreSet: vi.fn(),
    midiStoreSet: vi.fn(),
    resetMidiStoreForProject: vi.fn(),
    setSidechainRoutes: vi.fn(),
    notifyUser: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return { ...actual, resetArrangementStoresForProject: mocks.resetArrangementStoresForProject };
});

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        ...actual,
        trackStore: {
            get value() {
                return mocks.trackStoreValue.value;
            },
            set: mocks.trackStoreSet,
            // Real subscribe: the Yeast stores module subscribes at import
            // time, and a mock without it crashes that module's evaluation.
            subscribe: actual.trackStore.subscribe.bind(actual.trackStore),
        },
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

vi.mock('#/modules/Automation/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Automation/stores')>();
    return { ...actual, automationStore: { value: null, set: mocks.automationStoreSet } };
});

vi.mock('#/modules/MIDI/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/MIDI/stores')>();
    return { ...actual, midiStore: { value: null, set: mocks.midiStoreSet } };
});

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/MIDI/useCases')>();
    return { ...actual, resetMidiStoreForProject: mocks.resetMidiStoreForProject };
});

vi.mock('#/modules/Routing/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Routing/useCases')>();
    return { ...actual, setSidechainRoutes: mocks.setSidechainRoutes };
});

vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: { has: vi.fn(() => false) },
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

describe('resetModuleStoresToDefault', () => {
    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
    });

    it('resets all module stores and sidechain routes', () => {
        resetModuleStoresToDefault();

        expect(mocks.resetArrangementStoresForProject).toHaveBeenCalledTimes(1);
        expect(mocks.transportStoreSet).toHaveBeenCalledWith(defaultTransportState);
        expect(mocks.automationStoreSet).toHaveBeenCalledWith({ lanes: [] });
        expect(mocks.resetMidiStoreForProject).toHaveBeenCalledWith({ generateProbabilitySeed: false });
        expect(mocks.tempoMapStoreSet).toHaveBeenCalledWith({ changes: [] });
        expect(mocks.timeSignatureMapStoreSet).toHaveBeenCalledWith({ changes: [] });
        expect(mocks.setSidechainRoutes).toHaveBeenCalledWith([]);
    });
});

describe('verifyAudioBufferReferences', () => {
    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
    });

    it('warns when a referenced buffer is missing', () => {
        mocks.trackStoreValue.value = {
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
                    soloed: false,
                    armed: false,
                    disabled: false,
                    height: 48,
                    outputId: 'hw_out',
                    sends: [],
                    midiFx: [],
                    frozen: false,
                    parentId: null,
                    collapsed: false,
                    inputMonitoring: 'auto',
                    hidden: false,
                    automationMode: 'read',
                    groupId: null,
                    soloSafe: false,
                    notes: '',
                    inputId: null,
                    activeAlternativeId: 'tr-alt',
                    alternatives: [],
                    vcaGroupId: null,
                    midiOutputTrackId: null,
                    followChordTrack: false,
                    color: '',
                    freezeState: { status: 'unfrozen' },
                },
            ],
            selectedTrackId: null,
        };

        verifyAudioBufferReferences();

        expect(mocks.notifyUser).toHaveBeenCalledWith(
            expect.stringContaining('Missing audio buffers for: Clip A'),
            'warning'
        );
    });
});
