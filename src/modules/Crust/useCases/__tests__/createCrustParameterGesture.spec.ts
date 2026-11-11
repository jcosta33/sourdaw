import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockAudioContext } from '#/helpers/__tests__/audioContext.mock';
import { createEventBus } from '#/infra/events/createEventBus';
import * as automergeStorage from '#/infra/store/storage/createAutomergeStorage';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { type Track, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers } from '#/modules/Arrangement/useCases';
import * as engineApi from '#/modules/AudioEngine/useCases';
import * as automationApi from '#/modules/Automation/useCases';
import { setAutomationRecordingDependencies, stopAutomationRecording } from '#/modules/Automation/useCases';
import { leaveSession } from '#/modules/Collaboration/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    captureUndoHistory,
    clearUndoHistory,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import * as crdtApi from '#/modules/CrdtDocument/useCases';
import {
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    markActionHistoryEntryReverted,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { runProjectLoadTransaction, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';
import { defaultTransportState, setGestureClockSource, transportStore } from '#/modules/Transport/stores';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { crustStore, getCrustState } from '../../stores/crustStore';
import { createCrustParameterGesture } from '../createCrustParameterGesture';
import { setCrustParamWithAudio } from '../crustParamBridge/setCrustParamWithAudio';

const audio = vi.hoisted(() => ({ updateDeviceParam: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    updateDeviceParam: audio.updateDeviceParam,
}));

const TRACK = 'crust-track';
const DEVICE = 'crust-device';

function projectedDevice() {
    const device = trackStore.value?.tracks
        .find((track) => track.id === TRACK)
        ?.devices.find((device) => device.id === DEVICE);
    if (!device) {
        throw new Error('Crust device is missing from projection');
    }
    return device;
}

function rawDevice() {
    const root = getCrdtDoc<{ tracks: { tracks: Track[] } }>('root');
    const device = root?.tracks.tracks
        .find((track) => track.id === TRACK)
        ?.devices.find((device) => device.id === DEVICE);
    if (!device) {
        throw new Error('Crust device is missing from raw authority');
    }
    return device;
}

const controllers: ReturnType<typeof createCrustParameterGesture>[] = [];
function controller(id = DEVICE) {
    const result = createCrustParameterGesture(id);
    controllers.push(result);
    return result;
}

describe('Crust numeric controller with real Command and CRDT', () => {
    let notices: NotifyPayload[];

    beforeEach(async () => {
        notices = [];
        const bus = createEventBus<{
            'ui.notify': NotifyPayload;
            'ui.confirm': ConfirmPayload;
            'ui.prompt': PromptPayload;
        }>();
        bus.on('ui.notify', (notice) => {
            notices.push(notice);
        });
        setNotificationEventBus(bus);
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: leaveSession });
        const transition = runProjectLoadTransaction();
        expect(await transition.prepare()).toBe(true);
        expect(transition.activate()).toBe(true);
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Crust parameter integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        projectStore.set({ ...defaultProjectStoreState, createdAt: 100, updatedAt: 100, loading: false });
        trackStore.set({
            tracks: [
                {
                    ...createTrack({ id: TRACK, name: 'Crust', kind: 'audio' }),
                    color: '#123456',
                    devices: [
                        {
                            id: DEVICE,
                            type: 'crust',
                            name: 'Crust',
                            bypassed: false,
                            parameterValues: { gain: 0, ceiling: -0.3 },
                        },
                    ],
                },
            ],
            selectedTrackId: TRACK,
            ghostClips: [],
        });
        crustStore.set({});
        flushAutomergeStorageWrites();
        audio.updateDeviceParam.mockReset();
        setGestureClockSource({ getAudioTimeSeconds: () => 0, readNativeCursorBeats: () => 0 });
        transportStore.set({ ...defaultTransportState, isPlaying: false });
        vi.stubGlobal(
            'AudioContext',
            vi.fn(function () {
                return createMockAudioContext();
            })
        );
        const context = new AudioContext();
        setAutomationRecordingDependencies({ getAudioContext: () => context, getCompensationDelay: () => 0 });
    });

    afterEach(() => {
        for (const current of controllers.splice(0)) {
            current.dispose();
        }
        vi.restoreAllMocks();
        stopAutomationRecording();
        transportStore.set({ ...defaultTransportState, isPlaying: false });
        setGestureClockSource({ getAudioTimeSeconds: () => 0, readNativeCursorBeats: () => 0 });
        vi.unstubAllGlobals();
        agentProjectRepairStateStore.set(null);
        registerCrdtStorageRuntime();
        flushAutomergeStorageWrites();
        clearHandlerRegistry();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
    });

    it('keeps samples runtime-only then records one clamped final action and replays it', async () => {
        const edit = controller();
        edit.start('gain');
        await edit.change('gain', 3, true);
        await edit.change('gain', 99, true);
        expect(rawDevice().parameterValues.gain).toBe(0);
        expect(getCrustState(DEVICE).patch.gain).toBe(18);
        expect(captureUndoHistory().past).toHaveLength(0);
        await edit.settle('gain');
        expect(rawDevice().parameterValues.gain).toBe(18);
        expect(projectedDevice()).toEqual(rawDevice());
        expect(captureUndoHistory().past).toHaveLength(1);
        await undo();
        expect(rawDevice().parameterValues.gain).toBe(0);
        expect(getCrustState(DEVICE).patch.gain).toBe(0);
        await redo();
        expect(rawDevice().parameterValues.gain).toBe(18);
        await undo();
        expect(rawDevice().parameterValues.gain).toBe(0);
    });

    it('keeps independent settled parameters and gestures as distinct history entries', async () => {
        const edit = controller();
        await edit.change('gain', 3);
        await edit.change('ceiling', -1);
        await edit.change('gain', 6);
        expect(captureUndoHistory().past).toHaveLength(3);
        await undo();
        expect(rawDevice().parameterValues).toMatchObject({ gain: 3, ceiling: -1 });
        await undo();
        expect(rawDevice().parameterValues).toMatchObject({ gain: 3, ceiling: -0.3 });
        await undo();
        expect(rawDevice().parameterValues.gain).toBe(0);
    });

    it('settles a return-to-start preview without a canonical write or history', async () => {
        const before = crdtApi.captureProjectRevision();
        const edit = controller();
        await edit.change('gain', 9, true);
        await edit.change('gain', 0, true);
        await edit.settle('gain');
        expect(crdtApi.captureProjectRevision()).toBe(before);
        expect(captureUndoHistory().past).toHaveLength(0);
        expect(getCrustState(DEVICE).patch.gain).toBe(0);
    });

    it('preserves a successor started while retiring a no-op commit', async () => {
        let edit: ReturnType<typeof createCrustParameterGesture>;
        let shouldStartSuccessor = true;
        let successorToken = -1;
        vi.spyOn(engineApi, 'captureDeviceParameterRuntimeWriteAuthority').mockReturnValueOnce({
            owner: Symbol('controlled engine receipt'),
            isCurrent: () => true,
            canCommit: () => true,
            release: () => {
                if (!shouldStartSuccessor) {
                    return;
                }
                shouldStartSuccessor = false;
                successorToken = edit.start('gain');
            },
        });
        edit = controller();
        await edit.change('gain', 9, true);
        await edit.change('gain', 0, true);

        await edit.settle('gain');

        expect(successorToken).toBeGreaterThan(0);
        expect(edit.isCurrent('gain', successorToken)).toBe(true);
    });

    it('reports a no-op runtime release failure and recovers with one canonical write', async () => {
        const recordingRelease = vi.fn();
        const runtimeRelease = vi.fn(() => {
            throw new Error('Runtime release failed');
        });
        vi.spyOn(automationApi, 'captureTouchAutomationRecordingAuthority').mockReturnValueOnce({
            owner: Symbol('controlled recording receipt'),
            release: recordingRelease,
        });
        vi.spyOn(engineApi, 'captureDeviceParameterRuntimeWriteAuthority').mockReturnValueOnce({
            owner: Symbol('controlled engine receipt'),
            isCurrent: () => true,
            canCommit: () => true,
            release: runtimeRelease,
        });
        const edit = controller();
        await edit.change('gain', 9, true);
        await edit.change('gain', 0, true);

        const failed = edit.settle('gain');
        await failed.catch(() => undefined);

        expect(notices).toEqual([{ message: 'Runtime release failed', level: 'error' }]);
        expect(recordingRelease).toHaveBeenCalledTimes(2);
        expect(runtimeRelease).toHaveBeenCalledTimes(1);
        expect(rawDevice().parameterValues.gain).toBe(0);
        expect(captureUndoHistory().past).toHaveLength(0);

        const token = edit.start('gain');
        const recovered = edit.change('gain', 6);
        expect(token).toBeGreaterThan(0);
        expect(recovered).not.toBe(failed);
        await recovered;

        expect(rawDevice().parameterValues.gain).toBe(6);
        expect(projectedDevice()).toEqual(rawDevice());
        expect(getCrustState(DEVICE).patch.gain).toBe(6);
        expect(captureUndoHistory().past).toHaveLength(1);
    });

    it('reports an initial recording release failure and recovers with one canonical write', async () => {
        const recordingRelease = vi.fn().mockImplementationOnce(() => {
            throw new Error('Recording release failed');
        });
        const runtimeRelease = vi.fn();
        vi.spyOn(automationApi, 'captureTouchAutomationRecordingAuthority').mockReturnValueOnce({
            owner: Symbol('controlled recording receipt'),
            release: recordingRelease,
        });
        vi.spyOn(engineApi, 'captureDeviceParameterRuntimeWriteAuthority').mockReturnValueOnce({
            owner: Symbol('controlled engine receipt'),
            isCurrent: () => true,
            canCommit: () => true,
            release: runtimeRelease,
        });
        const edit = controller();
        await edit.change('gain', 9, true);

        const failed = edit.settle('gain');
        await failed.catch(() => undefined);

        expect(notices).toEqual([{ message: 'Recording release failed', level: 'error' }]);
        expect(recordingRelease).toHaveBeenCalledTimes(2);
        expect(runtimeRelease).toHaveBeenCalledTimes(1);
        expect(rawDevice().parameterValues.gain).toBe(0);
        expect(captureUndoHistory().past).toHaveLength(0);

        const token = edit.start('gain');
        const recovered = edit.change('gain', 6);
        expect(token).toBeGreaterThan(0);
        expect(recovered).not.toBe(failed);
        await recovered;

        expect(rawDevice().parameterValues.gain).toBe(6);
        expect(projectedDevice()).toEqual(rawDevice());
        expect(getCrustState(DEVICE).patch.gain).toBe(6);
        expect(captureUndoHistory().past).toHaveLength(1);
    });

    it('reports canonical and restoration failures once with the original error', async () => {
        const runtimeRelease = vi.fn();
        vi.spyOn(engineApi, 'captureDeviceParameterRuntimeWriteAuthority').mockReturnValueOnce({
            owner: Symbol('controlled engine receipt'),
            isCurrent: () => true,
            canCommit: () => true,
            release: runtimeRelease,
        });
        const edit = controller();
        await edit.change('gain', 9, true);
        audio.updateDeviceParam
            .mockImplementationOnce(() => {
                throw new Error('Canonical write failed');
            })
            .mockImplementation(() => {
                throw new Error('Restoration failed');
            });

        const failed = edit.settle('gain');
        await failed.catch(() => undefined);

        expect(notices).toHaveLength(1);
        expect(notices[0]?.level).toBe('error');
        expect(notices[0]?.message).toContain('Canonical write failed');
        expect(notices[0]?.message).toContain('Runtime parameter rollback failed');
        expect(notices[0]?.message).toContain('Restoration failed');
        expect(runtimeRelease).toHaveBeenCalledTimes(1);
        expect(rawDevice().parameterValues.gain).toBe(0);
        expect(captureUndoHistory().past).toHaveLength(0);
    });

    it('restores and releases after persistent recording failures before a healthy edit', async () => {
        const recordingRelease = vi.fn(() => {
            throw new Error('Recording release failed');
        });
        const runtimeRelease = vi.fn();
        vi.spyOn(automationApi, 'captureTouchAutomationRecordingAuthority').mockReturnValueOnce({
            owner: Symbol('controlled recording receipt'),
            release: recordingRelease,
        });
        vi.spyOn(engineApi, 'captureDeviceParameterRuntimeWriteAuthority').mockReturnValueOnce({
            owner: Symbol('controlled engine receipt'),
            isCurrent: () => true,
            canCommit: () => true,
            release: runtimeRelease,
        });
        const edit = controller();
        await edit.change('gain', 9, true);

        const failed = edit.settle('gain');
        await failed.catch(() => undefined);

        expect(recordingRelease).toHaveBeenCalledTimes(2);
        expect(runtimeRelease).toHaveBeenCalledTimes(1);
        expect(notices).toEqual([{ message: 'Recording release failed', level: 'error' }]);
        expect(rawDevice().parameterValues.gain).toBe(0);
        expect(projectedDevice()).toEqual(rawDevice());
        expect(getCrustState(DEVICE).patch.gain).toBe(0);
        expect(audio.updateDeviceParam).toHaveBeenLastCalledWith(TRACK, DEVICE, 'gain', 0);
        expect(captureUndoHistory().past).toHaveLength(0);

        const token = edit.start('gain');
        const recovered = edit.change('gain', 6);
        expect(token).toBeGreaterThan(0);
        expect(recovered).not.toBe(failed);
        await recovered;

        expect(rawDevice().parameterValues.gain).toBe(6);
        expect(projectedDevice()).toEqual(rawDevice());
        expect(getCrustState(DEVICE).patch.gain).toBe(6);
        expect(captureUndoHistory().past).toHaveLength(1);
    });

    it('reports every distinct compound cleanup fault once', async () => {
        const recordingRelease = vi
            .fn()
            .mockImplementationOnce(() => undefined)
            .mockImplementationOnce(() => {
                throw new Error('Final recording release failed');
            });
        const runtimeRelease = vi.fn(() => {
            throw new Error('Runtime release failed');
        });
        vi.spyOn(automationApi, 'captureTouchAutomationRecordingAuthority').mockReturnValueOnce({
            owner: Symbol('controlled recording receipt'),
            release: recordingRelease,
        });
        vi.spyOn(engineApi, 'captureDeviceParameterRuntimeWriteAuthority').mockReturnValueOnce({
            owner: Symbol('controlled engine receipt'),
            isCurrent: () => true,
            canCommit: () => true,
            release: runtimeRelease,
        });
        const edit = controller();
        await edit.change('gain', 9, true);
        audio.updateDeviceParam
            .mockImplementationOnce(() => {
                throw new Error('Canonical write failed');
            })
            .mockImplementation(() => {
                throw new Error('Restoration failed');
            });

        const failed = edit.settle('gain');
        await failed.catch(() => undefined);

        expect(notices).toHaveLength(1);
        const message = notices[0]?.message ?? '';
        expect(message).toContain('Canonical write failed');
        expect(message).toContain('Runtime parameter rollback failed');
        expect(message).toContain('Final recording release failed');
        expect(message).toContain('Runtime release failed');
        expect(message.match(/Restoration failed/g)).toHaveLength(1);
        expect(recordingRelease).toHaveBeenCalledTimes(2);
        expect(runtimeRelease).toHaveBeenCalledTimes(1);
        expect(rawDevice().parameterValues.gain).toBe(0);
        expect(captureUndoHistory().past).toHaveLength(0);
    });

    it('hydrates the durable baseline when the restoration write fails', async () => {
        const runtimeRelease = vi.fn();
        vi.spyOn(engineApi, 'captureDeviceParameterRuntimeWriteAuthority').mockReturnValueOnce({
            owner: Symbol('controlled engine receipt'),
            isCurrent: () => true,
            canCommit: () => true,
            release: runtimeRelease,
        });
        const edit = controller();
        await edit.change('gain', 9, true);
        audio.updateDeviceParam
            .mockImplementationOnce(() => {
                throw new Error('Canonical write failed');
            })
            .mockImplementation(() => {
                throw new Error('Restoration failed');
            });

        const failed = edit.settle('gain');
        await failed.catch(() => undefined);

        expect(rawDevice().parameterValues.gain).toBe(0);
        expect(projectedDevice()).toEqual(rawDevice());
        expect(getCrustState(DEVICE).patch.gain).toBe(0);
        expect(runtimeRelease).toHaveBeenCalledTimes(1);
        expect(notices).toHaveLength(1);
        expect(captureUndoHistory().past).toHaveLength(0);

        audio.updateDeviceParam.mockReset();
        const token = edit.start('gain');
        const recovered = edit.change('gain', 6);
        expect(token).toBeGreaterThan(0);
        expect(recovered).not.toBe(failed);
        await recovered;
        expect(rawDevice().parameterValues.gain).toBe(6);
        expect(getCrustState(DEVICE).patch.gain).toBe(6);
        expect(captureUndoHistory().past).toHaveLength(1);

        await undo();
        expect(rawDevice().parameterValues.gain).toBe(0);
        expect(getCrustState(DEVICE).patch.gain).toBe(0);
        await redo();
        expect(rawDevice().parameterValues.gain).toBe(6);
        expect(getCrustState(DEVICE).patch.gain).toBe(6);
    });

    it.each(['removed', 'duplicate', 'frozen'] as const)(
        'refuses a preview terminal after its %s target changes',
        async (change) => {
            const edit = controller();
            await edit.change('gain', 9, true);
            const track = trackStore.value?.tracks[0];
            if (!track) {
                throw new Error('Missing track');
            }
            let changedTrack: Track;
            if (change === 'removed') {
                changedTrack = { ...track, devices: [] };
            } else if (change === 'duplicate') {
                changedTrack = { ...track, devices: [...track.devices, ...track.devices] };
            } else {
                changedTrack = { ...track, frozen: true };
            }
            trackStore.set({
                tracks: [changedTrack],
                selectedTrackId: TRACK,
                ghostClips: [],
            });
            flushAutomergeStorageWrites();
            await edit.settle('gain');
            expect(captureUndoHistory().past).toHaveLength(0);
            expect(trackStore.value?.tracks[0]?.devices.every((device) => device.parameterValues.gain === 0)).toBe(
                true
            );
        }
    );

    it('fences a queued final against project transition even when all visible IDs survive', async () => {
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const admitted = Promise.withResolvers<void>();
        const waitOriginal = automergeStorage.waitForAutomergeSnapshotTransaction;
        const wait = vi.spyOn(automergeStorage, 'waitForAutomergeSnapshotTransaction').mockImplementation((...args) => {
            admitted.resolve();
            return waitOriginal(...args);
        });
        let snapshot: ReturnType<typeof crdtApi.transactSnapshot> | undefined;
        let pending: Promise<void> | undefined;
        try {
            snapshot = crdtApi.transactSnapshot(async () => {
                entered.resolve();
                await release.promise;
            });
            await entered.promise;
            const edit = controller();
            pending = edit.change('gain', 9);
            await admitted.promise;
            const transition = runProjectLoadTransaction();
            expect(await transition.prepare()).toBe(true);
            expect(transition.activate()).toBe(true);
        } finally {
            release.resolve();
            await Promise.allSettled([snapshot, pending]);
            wait.mockRestore();
        }
        await pending;
        expect(rawDevice().parameterValues.gain).toBe(0);
        expect(captureUndoHistory().past).toHaveLength(0);
    });

    it('keeps a same-key legacy frame from overwriting the later numeric command', async () => {
        const frame = Promise.withResolvers<FrameRequestCallback>();
        const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementationOnce((callback) => {
            frame.resolve(callback);
            return 12345;
        });
        setCrustParamWithAudio(DEVICE, 'gain', 12);
        const callback = await frame.promise;
        raf.mockRestore();
        const edit = controller();
        await edit.change('gain', 3);
        callback(0);
        flushAutomergeStorageWrites();
        expect(rawDevice().parameterValues.gain).toBe(3);
        expect(getCrustState(DEVICE).patch.gain).toBe(3);
        expect(captureUndoHistory().past).toHaveLength(1);
    });

    it('reacquires a cancelled preview for a later terminal edit without an explicit start', async () => {
        const edit = controller();
        await edit.change('gain', 9, true);
        edit.cancel('gain');
        expect(rawDevice().parameterValues.gain).toBe(0);
        expect(getCrustState(DEVICE).patch.gain).toBe(0);
        expect(captureUndoHistory().past).toHaveLength(0);

        await edit.change('gain', 6);

        expect(rawDevice().parameterValues.gain).toBe(6);
        expect(projectedDevice()).toEqual(rawDevice());
        expect(getCrustState(DEVICE).patch.gain).toBe(6);
        expect(captureUndoHistory().past).toHaveLength(1);
    });

    it('restores an emitted preview after a later engine failure without adding history', async () => {
        const edit = controller();
        await edit.change('gain', 9, true);
        expect(rawDevice().parameterValues.gain).toBe(0);
        expect(getCrustState(DEVICE).patch.gain).toBe(9);
        expect(audio.updateDeviceParam).toHaveBeenLastCalledWith(TRACK, DEVICE, 'gain', 9, expect.any(Symbol));

        audio.updateDeviceParam.mockImplementationOnce(() => {
            throw new Error('Engine refused gain');
        });
        await edit.change('gain', 12);

        expect(rawDevice().parameterValues.gain).toBe(0);
        expect(getCrustState(DEVICE).patch.gain).toBe(0);
        expect(captureUndoHistory().past).toHaveLength(0);
    });

    it('clears a failed commit after restoration failure so a recovered edit can start', async () => {
        vi.spyOn(engineApi, 'captureDeviceParameterRuntimeWriteAuthority').mockReturnValueOnce({
            owner: Symbol('controlled engine receipt'),
            isCurrent: () => true,
            canCommit: () => true,
            release: vi.fn(),
        });
        const edit = controller();
        await edit.change('gain', 9, true);
        audio.updateDeviceParam.mockImplementation(() => {
            throw new Error('Engine refused gain');
        });

        const failed = edit.settle('gain');
        await failed.catch(() => undefined);
        expect(rawDevice().parameterValues.gain).toBe(0);
        expect(captureUndoHistory().past).toHaveLength(0);

        audio.updateDeviceParam.mockReset();
        const token = edit.start('gain');
        const recovered = edit.change('gain', 6);
        expect(token).toBeGreaterThan(0);
        expect(recovered).not.toBe(failed);
        await recovered;

        expect(rawDevice().parameterValues.gain).toBe(6);
        expect(projectedDevice()).toEqual(rawDevice());
        expect(getCrustState(DEVICE).patch.gain).toBe(6);
        expect(captureUndoHistory().past).toHaveLength(1);
    });

    it('does not restore over a newer runtime producer under controlled public runtime authority', async () => {
        let current = true;
        const release = vi.fn();
        vi.spyOn(engineApi, 'captureDeviceParameterRuntimeWriteAuthority').mockReturnValueOnce({
            owner: Symbol('controlled engine receipt'),
            isCurrent: () => current,
            canCommit: () => current,
            release,
        });
        const edit = controller();
        await edit.change('gain', 9, true);
        current = false;
        engineApi.updateDeviceParam(TRACK, DEVICE, 'gain', 2);
        const calls = audio.updateDeviceParam.mock.calls.length;
        edit.cancel('gain');
        expect(audio.updateDeviceParam).toHaveBeenCalledTimes(calls);
        expect(rawDevice().parameterValues.gain).toBe(0);
        expect(captureUndoHistory().past).toHaveLength(0);
        expect(release).toHaveBeenCalledTimes(1);
    });

    it.each(['write', 'touch', 'latch'] as const)(
        'records actual %s samples at movement and physical release while suppressing canonical/replay recording',
        async (automationMode) => {
            let beat = 1;
            setGestureClockSource({ getAudioTimeSeconds: () => 0, readNativeCursorBeats: () => beat });
            const track = trackStore.value?.tracks[0];
            if (!track) {
                throw new Error('Missing track');
            }
            trackStore.set({ tracks: [{ ...track, automationMode }], selectedTrackId: TRACK, ghostClips: [] });
            flushAutomergeStorageWrites();
            transportStore.set({ ...defaultTransportState, isPlaying: true, tempo: 120 });
            const recording = vi.spyOn(automationApi, 'recordAutomationValue');
            const edit = controller();
            await edit.change('gain', 3, true);
            beat = 2;
            await edit.change('gain', 6, true);
            expect(recording.mock.calls).toEqual([
                [TRACK, `${DEVICE}:gain`, 3, 1, expect.any(Symbol)],
                [TRACK, `${DEVICE}:gain`, 6, 2, expect.any(Symbol)],
            ]);
            beat = 9;
            await edit.change('gain', 6, false);
            expect(recording.mock.calls).toEqual([
                [TRACK, `${DEVICE}:gain`, 3, 1, expect.any(Symbol)],
                [TRACK, `${DEVICE}:gain`, 6, 2, expect.any(Symbol)],
                [TRACK, `${DEVICE}:gain`, 6, 9, expect.any(Symbol)],
            ]);
            expect(captureUndoHistory().past).toHaveLength(1);
            await undo();
            await redo();
            expect(recording).toHaveBeenCalledTimes(3);
        }
    );
    it('replays a hidden bit-depth choice with exact absent-field restoration and effective engine default', async () => {
        const edit = controller();
        expect(Object.hasOwn(rawDevice().parameterValues, 'outputBitDepth')).toBe(false);
        expect(getCrustState(DEVICE).patch.outputBitDepth).toBe(24);
        await edit.change('outputBitDepth', 32);
        expect(rawDevice().parameterValues.outputBitDepth).toBe(32);
        expect(projectedDevice()).toEqual(rawDevice());
        expect(getCrustState(DEVICE).patch.outputBitDepth).toBe(32);
        expect(captureUndoHistory().past).toHaveLength(1);
        expect(captureUndoHistory().past[0]).toMatchObject({
            kind: 'action',
            action: {
                type: 'setDeviceParameter',
                payload: { paramId: 'outputBitDepth', value: 32, expectedValuePresent: false },
            },
            inverseAction: {
                type: 'setDeviceParameter',
                payload: { paramId: 'outputBitDepth', value: 24, deleteParameter: true },
            },
        });
        audio.updateDeviceParam.mockClear();
        await undo();
        expect(Object.hasOwn(rawDevice().parameterValues, 'outputBitDepth')).toBe(false);
        expect(projectedDevice()).toEqual(rawDevice());
        expect(getCrustState(DEVICE).patch.outputBitDepth).toBe(24);
        expect(audio.updateDeviceParam).toHaveBeenLastCalledWith(TRACK, DEVICE, 'outputBitDepth', 24);
        await redo();
        expect(rawDevice().parameterValues.outputBitDepth).toBe(32);
        expect(audio.updateDeviceParam).toHaveBeenLastCalledWith(TRACK, DEVICE, 'outputBitDepth', 32);
        await undo();
        expect(Object.hasOwn(rawDevice().parameterValues, 'outputBitDepth')).toBe(false);
        expect(getCrustState(DEVICE).patch.outputBitDepth).toBe(24);
        expect(audio.updateDeviceParam).toHaveBeenLastCalledWith(TRACK, DEVICE, 'outputBitDepth', 24);
    });

    it.each(['write', 'touch', 'latch'] as const)(
        'commits the hidden 32-bit choice in %s without recording automation',
        async (automationMode) => {
            const track = trackStore.value?.tracks[0];
            if (!track) {
                throw new Error('Missing track');
            }
            trackStore.set({ tracks: [{ ...track, automationMode }], selectedTrackId: TRACK, ghostClips: [] });
            flushAutomergeStorageWrites();
            setGestureClockSource({ getAudioTimeSeconds: () => 0, readNativeCursorBeats: () => 1 });
            transportStore.set({ ...defaultTransportState, isPlaying: true });
            const recording = vi.spyOn(automationApi, 'recordAutomationValue');
            const edit = controller();
            await edit.change('outputBitDepth', 32);
            expect(rawDevice().parameterValues.outputBitDepth).toBe(32);
            expect(captureUndoHistory().past).toHaveLength(1);
            expect(recording).not.toHaveBeenCalled();
            await undo();
            expect(Object.hasOwn(rawDevice().parameterValues, 'outputBitDepth')).toBe(false);
            await redo();
            expect(rawDevice().parameterValues.outputBitDepth).toBe(32);
            expect(recording).not.toHaveBeenCalled();
        }
    );

    it.each([0, 17, 64])(
        'refuses invalid hidden bit depth %s without project, history or runtime writes',
        async (value) => {
            const edit = controller();
            await edit.change('outputBitDepth', value);
            expect(Object.hasOwn(rawDevice().parameterValues, 'outputBitDepth')).toBe(false);
            expect(captureUndoHistory().past).toHaveLength(0);
            expect(audio.updateDeviceParam).not.toHaveBeenCalled();
        }
    );
});
