import { describe, it, expect, beforeEach, vi } from 'vitest';

import { registerProjectLifecycle } from '#/app/registerProjectLifecycle';
import { Container } from '#/infra/di/Container';
import { type TrackStoreState } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultPreferences } from '#/modules/Preferences/useCases';
import { tempoMapStore, timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';
import { defaultTransportState } from '#/modules/Transport/useCases';

import { resetModuleStoresToDefault } from '../helpers/resetModuleStoresToDefault';
import { verifyAudioBufferReferences } from '../helpers/verifyAudioBufferReferences';

const mocks = vi.hoisted(() => ({
    resetArrangementStoresForProject: vi.fn(),
    trackStoreValue: { value: null as TrackStoreState | null },
    trackStoreSet: vi.fn(),
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
    nativeEngineRearmStore: { subscribe: vi.fn(() => vi.fn()) },
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

describe('resetModuleStoresToDefault', () => {
    beforeEach(() => {
        Container.clear();
        // The reset seeds the incoming transport from the Recording
        // preferences; pin them to their defaults so the seeded transport
        // expectation below is deterministic.
        preferencesStore.set(defaultPreferences);
        registerProjectLifecycle();
        transportStore.set({ ...defaultTransportState, tempo: 97, isLooping: true });
        automationStore.set({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    parameterId: 'volume',
                    parameterName: 'Volume',
                    points: [],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        });
        tempoMapStore.set({ changes: [{ id: 'tempo-1', beat: 4, tempo: 90, curve: 'instant' }] });
        timeSignatureMapStore.set({ changes: [{ id: 'meter-1', beat: 4, numerator: 6, denominator: 8 }] });
        vi.clearAllMocks();
    });

    it('resets all module stores and sidechain routes', () => {
        resetModuleStoresToDefault();

        expect(mocks.resetArrangementStoresForProject).toHaveBeenCalledTimes(1);
        // With the Recording preferences at their shipped defaults (count-in
        // off, pre-roll off, 2 bars), the incoming transport carries those
        // seeds; they coincide with the model default for every field.
        expect(transportStore.value).toEqual({
            ...defaultTransportState,
            countInEnabled: false,
            countInBars: 1,
            preRollEnabled: false,
            preRollBars: 2,
        });
        expect(automationStore.value).toEqual({ lanes: [] });
        expect(mocks.resetMidiStoreForProject).toHaveBeenCalledWith({ generateProbabilitySeed: false });
        expect(tempoMapStore.value).toEqual({ changes: [] });
        expect(timeSignatureMapStore.value).toEqual({ changes: [] });
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
