import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { type Clip, type Track, trackStore } from '#/modules/Arrangement/stores';
import { relinkClipAudioSource } from '#/modules/Arrangement/useCases';
import { audioEngine } from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { createAutomationLane } from '#/modules/Automation/useCases';
import {
    captureProjectRootIdentity,
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { isTransportIdle } from '#/modules/Transport/useCases';

import { type ArrangementSnapshot, arrangementStore } from '../../../stores/arrangementStore';
import { missingMediaStore } from '../../../stores/missingMediaStore';
import { defaultProjectStoreState, projectStore } from '../../../stores/projectStore';
import { runProjectLoadTransaction } from '../../projectPersistence/helpers/runProjectLoadTransaction';
import { verifyAudioBufferReferences } from '../../projectPersistence/helpers/verifyAudioBufferReferences';
import { setProjectIdentityTransitionDependencies } from '../../projectPersistence/projectIdentityTransitionDependencies';
import * as subject from '../switchArrangement';

const mocks = vi.hoisted(() => ({
    getCachedAudioBuffer: vi.fn<(input: { bufferId: string }) => AudioBuffer | null>(),
    prepareCachedAudioBuffersFromIdb:
        vi.fn<
            (input: {
                audioContext: unknown;
                bufferIds: readonly string[];
                shouldContinue: () => boolean;
            }) => Promise<{ publish: () => void; cancel: () => void } | null>
        >(),
    getAudioContext: vi.fn<() => unknown>(() => null),
    stopAllScheduled: vi.fn(),
    cancelTrackAutomationRamps: vi.fn(),
    clearUndoHistory: vi.fn(),
    pushUndoEntry: vi.fn(),
    stopPlayback: vi.fn(async () => {}),
    markDirty: vi.fn(),
    notifyUser: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getAudioContext: mocks.getAudioContext,
    prepareCachedAudioBuffersFromIdb: mocks.prepareCachedAudioBuffersFromIdb,
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
    stopAllScheduled: mocks.stopAllScheduled,
    cancelTrackAutomationRamps: mocks.cancelTrackAutomationRamps,
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    clearUndoHistory: mocks.clearUndoHistory,
    pushUndoEntry: mocks.pushUndoEntry,
}));

vi.mock('#/modules/Transport/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/useCases')>()),
    stopPlayback: mocks.stopPlayback,
}));

vi.mock('../../projectPersistence/saveProject/markDirty', () => ({ markDirty: mocks.markDirty }));

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

const resolvedBuffer = {} as AudioBuffer;

const clipA: Clip = {
    id: 'clip-a',
    trackId: 'track-1',
    name: 'A',
    startBeat: 0,
    endBeat: 4,
    type: 'audio',
    audioBufferId: 'buf-x',
    fadeInBeats: 0,
    fadeOutBeats: 0,
    gain: 1,
    color: '',
    locked: false,
    muted: false,
};

const clipB: Clip = {
    ...clipA,
    id: 'clip-b',
    name: 'B',
};

function trackFixture(clips: Clip[]): Track {
    return {
        id: 'track-1',
        name: 'Track 1',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips,
        devices: [],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'track-1-alt',
        alternatives: [{ id: 'track-1-alt', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
    };
}

function snapshotFixture(id: string, name: string, tracks: Track[]): ArrangementSnapshot {
    return {
        id,
        name,
        tracks: { tracks, selectedTrackId: null },
        automation: { lanes: [] },
        midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
    };
}

describe('switchArrangement', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.stopPlayback.mockReset().mockResolvedValue(undefined);
        mocks.clearUndoHistory.mockReset();
        mocks.markDirty.mockReset();
        // buf-x is missing from the cache (the repair premise); buf-new, the
        // relink replacement, resolves.
        mocks.getCachedAudioBuffer.mockImplementation(({ bufferId }) =>
            bufferId === 'buf-new' ? resolvedBuffer : null
        );
        mocks.prepareCachedAudioBuffersFromIdb.mockResolvedValue({ publish: () => {}, cancel: () => {} });
        arrangementStore.set({
            arrangements: [
                snapshotFixture('arr-a', 'Arrangement A', []),
                snapshotFixture('arr-b', 'Arrangement B', [trackFixture([clipB])]),
            ],
            activeArrangementId: 'arr-a',
        });
        trackStore.set({ tracks: [trackFixture([clipA])], selectedTrackId: null });
    });

    it('should export switchArrangement', () => {
        expect(subject.switchArrangement).toBeDefined();
        const time = typeof subject.switchArrangement;
        expect(time === 'function' || time === 'object').toBe(true);
    });

    it('re-flags the missing-media panel when the switched-to arrangement still references the missing source', async () => {
        // Repair arrangement A the way the waveform-editor drop does: relink
        // every clip sharing buf-x, then re-scan — the panel clears.
        const relink = relinkClipAudioSource({ sourceBufferId: 'buf-x', replacementBufferId: 'buf-new' });
        expect(relink).toMatchObject({ status: 'relinked', relinkedClipIds: ['clip-a'] });
        verifyAudioBufferReferences();
        expect(missingMediaStore.value?.items).toEqual([]);

        await subject.switchArrangement('arr-b');

        // Arrangement B's stored clips still carry buf-x; the switch hydrated
        // them into live state and the scan re-flagged them for repair.
        expect(trackStore.value?.tracks[0]?.clips[0]).toMatchObject({ id: 'clip-b', audioBufferId: 'buf-x' });
        expect(missingMediaStore.value?.items).toHaveLength(1);
        expect(missingMediaStore.value?.items[0]).toMatchObject({
            bufferId: 'buf-x',
            clipId: 'clip-b',
            kind: 'clip',
            trackId: 'track-1',
        });
    });

    it('calls through real Stop before loading a same-root arrangement with reused IDs', async () => {
        const actualTransport =
            await vi.importActual<typeof import('#/modules/Transport/useCases')>('#/modules/Transport/useCases');
        const actualCommand =
            await vi.importActual<typeof import('#/modules/Command/useCases')>('#/modules/Command/useCases');
        const actualDirty = await vi.importActual<typeof import('../../projectPersistence/saveProject/markDirty')>(
            '../../projectPersistence/saveProject/markDirty'
        );
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        const transition = runProjectLoadTransaction();
        expect(await transition.prepare()).toBe(true);
        expect(transition.activate()).toBe(true);
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('same-root arrangement switch');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        mocks.stopPlayback.mockImplementation(actualTransport.stopPlayback);
        mocks.clearUndoHistory.mockImplementation(actualCommand.clearUndoHistory);
        mocks.markDirty.mockImplementation(actualDirty.markDirty);
        mocks.getAudioContext.mockReturnValue({ currentTime: 5, sampleRate: 48000 });
        vi.spyOn(audioEngine, 'setTransportInfo').mockImplementation(() => {});
        try {
            const outgoing = {
                ...trackFixture([]),
                devices: [
                    {
                        id: 'same-device',
                        type: 'bacteria',
                        name: 'Bacteria',
                        bypassed: false,
                        parameterValues: { mix: 0.5 },
                    },
                ],
            };
            const incoming = {
                ...outgoing,
                automationMode: 'off' as const,
                devices: outgoing.devices.map((device) => ({ ...device, parameterValues: { mix: 0.2 } })),
            };
            const lane = {
                ...createAutomationLane(outgoing.id, 'same-device:mix', 'Mix'),
                id: 'same-lane',
                points: [{ beat: 0, value: 0.9, curve: 'linear' as const, tension: 0 }],
            };
            trackStore.set({ tracks: [outgoing], selectedTrackId: outgoing.id });
            automationStore.set({ lanes: [lane] });
            arrangementStore.set({
                arrangements: [
                    snapshotFixture('arr-a', 'A', [outgoing]),
                    { ...snapshotFixture('arr-b', 'B', [incoming]), automation: { lanes: [lane] } },
                ],
                activeArrangementId: 'arr-a',
            });
            projectStore.set({ ...defaultProjectStoreState, loading: false });
            transportStore.set({ ...defaultTransportState, isPlaying: true });
            flushAutomergeStorageWrites();
            expect(automationStore.value?.lanes[0]?.id).toBe(lane.id);
            const rootIdentity = captureProjectRootIdentity();
            const publish = vi.fn(() => {
                expect(transportStore.value?.isPlaying).toBe(false);
                expect(isTransportIdle()).toBe(true);
                expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues.mix).toBe(0.5);
                expect(captureProjectRootIdentity()).toBe(rootIdentity);
            });
            mocks.prepareCachedAudioBuffersFromIdb.mockResolvedValue({ publish, cancel: vi.fn() });
            await subject.switchArrangement('arr-b');
            expect(mocks.stopPlayback).toHaveBeenCalledOnce();
            expect(publish).toHaveBeenCalledOnce();
            expect(captureProjectRootIdentity()).toBe(rootIdentity);
            expect(transportStore.value?.isPlaying).toBe(false);
            expect(isTransportIdle()).toBe(true);
            expect(arrangementStore.value?.activeArrangementId).toBe('arr-b');
            expect(trackStore.value?.tracks[0]).toMatchObject({
                id: outgoing.id,
                automationMode: 'off',
                devices: [{ id: 'same-device', parameterValues: { mix: 0.2 } }],
            });
            expect(automationStore.value?.lanes[0]?.id).toBe(lane.id);
            expect(projectStore.value?.dirty).toBe(true);
        } finally {
            flushAutomergeStorageWrites();
            configureAutomergeStoragePort(null);
            removeCrdtDoc('root');
            vi.restoreAllMocks();
        }
    });
});
