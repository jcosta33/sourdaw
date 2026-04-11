import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { defaultTransportState } from '#/modules/Transport/useCases/transportQueries/helpers';
import { clearUndoHistory } from '#/modules/Command/useCases';
import { hydrateModuleStoresFromProjectData } from './helpers/hydrateModuleStoresFromProjectData';
import { resetModuleStoresToDefault } from './helpers/resetModuleStoresToDefault';
import { verifyAudioBufferReferences } from './helpers/verifyAudioBufferReferences';
import { type ProjectData } from '../../models/ProjectData';

function mockStore<T>(value: T | null) {
    return {
        value,
        set: vi.fn(),
    };
}

describe('clearUndoHistory', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('clears undo stacks', () => {
        const undoStore = mockStore({ past: [1], future: [2] } as never);
        injectDependencies(clearUndoHistory, {
            undoStore: undoStore as never,
        });
        clearUndoHistory();
        expect(undoStore.set).toHaveBeenCalledWith({ past: [], future: [] });
    });
});

describe('resetModuleStoresToDefault', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('resets all module stores and sidechain routes', () => {
        const trackStore = mockStore(null);
        const transportStore = mockStore(null);
        const automationStore = mockStore(null);
        const midiStore = mockStore(null);
        const tempoMapStore = mockStore(null);
        const timeSignatureMapStore = mockStore(null);
        const markerStore = mockStore(null);
        const takeLaneStore = mockStore(null);
        const setSidechainRoutes = vi.fn();

        injectDependencies(resetModuleStoresToDefault, {
            trackStore: trackStore as never,
            transportStore: transportStore as never,
            automationStore: automationStore as never,
            midiStore: midiStore as never,
            tempoMapStore: tempoMapStore as never,
            timeSignatureMapStore: timeSignatureMapStore as never,
            markerStore: markerStore as never,
            takeLaneStore: takeLaneStore as never,
            setSidechainRoutes,
            defaultTransportState,
        });

        resetModuleStoresToDefault();

        expect(trackStore.set).toHaveBeenCalledWith({ tracks: [], selectedTrackId: null });
        expect(transportStore.set).toHaveBeenCalledWith(defaultTransportState);
        expect(automationStore.set).toHaveBeenCalledWith({ lanes: [] });
        expect(midiStore.set).toHaveBeenCalledWith({
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        expect(tempoMapStore.set).toHaveBeenCalledWith({ changes: [] });
        expect(timeSignatureMapStore.set).toHaveBeenCalledWith({ changes: [] });
        expect(markerStore.set).toHaveBeenCalledWith({ markers: [], sections: [] });
        expect(takeLaneStore.set).toHaveBeenCalledWith({ lanes: [] });
        expect(setSidechainRoutes).toHaveBeenCalledWith([]);
    });
});

describe('hydrateModuleStoresFromProjectData', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('applies tracks and transport', () => {
        const trackStore = mockStore(null);
        const transportStore = mockStore(null);
        const automationStore = mockStore(null);
        const midiStore = mockStore(null);
        const tempoMapStore = mockStore(null);
        const timeSignatureMapStore = mockStore(null);
        const markerStore = mockStore(null);
        const takeLaneStore = mockStore(null);
        const setSidechainRoutes = vi.fn();

        injectDependencies(hydrateModuleStoresFromProjectData, {
            trackStore: trackStore as never,
            transportStore: transportStore as never,
            automationStore: automationStore as never,
            midiStore: midiStore as never,
            tempoMapStore: tempoMapStore as never,
            timeSignatureMapStore: timeSignatureMapStore as never,
            markerStore: markerStore as never,
            takeLaneStore: takeLaneStore as never,
            setSidechainRoutes,
            defaultTransportState,
        });

        const tracksState = { tracks: [], selectedTrackId: null } as never;
        const data: ProjectData = {
            version: 1,
            name: 'p',
            createdAt: 0,
            updatedAt: 0,
            tracks: tracksState,
            transport: { tempo: 99 },
            automation: { lanes: [] },
            midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
        };

        hydrateModuleStoresFromProjectData(data);

        expect(trackStore.set).toHaveBeenCalledWith(tracksState);
        expect(transportStore.set).toHaveBeenCalledWith({
            ...defaultTransportState,
            ...data.transport,
        });
    });
});

describe('verifyAudioBufferReferences', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('warns when a referenced buffer is missing', () => {
        const notifyUser = vi.fn();
        injectDependencies(verifyAudioBufferReferences, {
            trackStore: {
                value: {
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
                },
                set: vi.fn(),
            } as never,
            audioBufferCache: {
                has: vi.fn(() => false),
            } as never,
            notifyUser,
        });

        verifyAudioBufferReferences();

        expect(notifyUser).toHaveBeenCalledWith(
            expect.stringContaining('Missing audio buffers for: Clip A'),
            'warning'
        );
    });
});
