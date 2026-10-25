import { change, clone } from '@automerge/automerge';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { useStore } from '#/infra/store/useStore';
import { trackStore } from '#/modules/Arrangement/stores';
import * as arrangement from '#/modules/Arrangement/useCases';
import * as command from '#/modules/Command/useCases';
import {
    captureProjectRootIdentity,
    createCrdtDoc,
    getCrdtDoc,
    removeCrdtDoc,
    replaceCrdtDoc,
    replaceCrdtDocInLineage,
} from '#/modules/CrdtDocument/useCases';
import { runProjectLoadTransaction, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';

import { type DeviceParameterView } from '../../../models/PluginDescriptorViewTypes';
import { useDeviceParameterGesture } from '../useDeviceParameterGesture';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

type QueuedAction = {
    action: Parameters<typeof command.executeUserAppAction>[0];
    options: Parameters<typeof command.executeUserAppAction>[1];
    completion: ReturnType<typeof Promise.withResolvers<void>>;
};

const queued: QueuedAction[] = [];
const samples: { deviceId: string; paramId: string; value: number; suppressed: boolean }[] = [];

function parameter(id: string): DeviceParameterView {
    return {
        id,
        deviceId: 'distortion',
        name: id,
        type: 'float',
        value: 20,
        defaultValue: 20,
        minValue: 0,
        maxValue: 100,
        unit: '%',
        automatable: true,
        hasAutomation: false,
    };
}

function mountGesture(paramId = 'dist-drive', deviceId = 'device-1') {
    return renderHook(() => {
        const state = useStore(trackStore, { tracks: [], selectedTrackId: null });
        const device = state.tracks[0]?.devices.find((candidate) => candidate.id === deviceId);
        if (!device) {
            throw new Error('Required device is absent');
        }
        return useDeviceParameterGesture({ trackId: 'track-1', device, param: parameter(paramId) });
    });
}

function replaceRoot(inLineage = false): void {
    const doc = getCrdtDoc<Record<string, unknown>>('root');
    if (!doc) {
        throw new Error('Required installed root is absent');
    }
    if (inLineage) {
        replaceCrdtDocInLineage({
            id: 'root',
            doc: change(clone(doc), (draft) => {
                draft.unrelated = 'peer edit';
            }),
        });
        return;
    }
    replaceCrdtDoc({ id: 'root', doc: clone(doc) });
}

describe('shared continuous device parameter gesture authority', () => {
    beforeEach(async () => {
        configureAutomergeStoragePort(null);
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        const transition = runProjectLoadTransaction();
        expect(await transition.prepare()).toBe(true);
        expect(transition.activate()).toBe(true);
        removeCrdtDoc('root');
        createCrdtDoc('root');
        trackStore.set({
            tracks: [
                {
                    ...arrangement.createTrack({
                        id: 'track-1',
                        name: 'Guitar',
                        kind: 'audio',
                        withoutDefaultDevice: true,
                    }),
                    devices: ['device-1', 'device-2'].map((id) => ({
                        id,
                        name: 'Distortion',
                        type: 'builtin-distortion',
                        bypassed: false,
                        parameterValues: { 'dist-drive': 20, 'dist-mix': 20 },
                    })),
                },
            ],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });
        samples.length = 0;
        queued.length = 0;
        // The hook and subscriptions stay real. These are the outside-owner
        // runtime sample and deferred command ports, not a history substitute.
        vi.spyOn(arrangement, 'setDeviceParameter').mockImplementation((deviceId, paramId, value, options) => {
            samples.push({ deviceId, paramId, value, suppressed: options?.automationRecordingPolicy === 'suppressed' });
            return true;
        });
        vi.spyOn(command, 'executeUserAppAction').mockImplementation((action, options) => {
            const completion = Promise.withResolvers<void>();
            queued.push({ action, options, completion });
            return completion.promise;
        });
    });

    afterEach(async () => {
        cleanup();
        await act(async () => {
            for (const entry of queued) {
                entry.completion.resolve();
                await entry.completion.promise;
            }
        });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        removeCrdtDoc('root');
        vi.restoreAllMocks();
    });

    it('shares the newest preview across two mounted hooks without an acquisition sample', () => {
        const curve = mountGesture();
        const knob = mountGesture();
        let curveToken = -1;
        act(() => {
            curveToken = curve.result.current.startGesture();
            curve.result.current.change(30, true);
        });
        expect(curve.result.current.value).toBe(30);
        expect(knob.result.current.value).toBe(30);
        let knobToken = -1;
        act(() => {
            knobToken = knob.result.current.startGesture();
        });
        expect(curve.result.current.isGestureCurrent(curveToken)).toBe(false);
        expect(knob.result.current.isGestureCurrent(knobToken)).toBe(true);
        expect(samples.map(({ value }) => value)).toEqual([30]);
        act(() => knob.result.current.change(40, true));
        expect(curve.result.current.previewValue).toBe(40);
        expect(knob.result.current.value).toBe(40);
        expect(samples.map(({ value }) => value)).toEqual([30, 40]);
        expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues['dist-drive']).toBe(20);
    });

    it.each(['cancel', 'unmount', 'release', 'sample'] as const)(
        'prevents the old owner from restoring or settling over its successor after %s',
        (finish) => {
            const curve = mountGesture();
            const knob = mountGesture();
            act(() => {
                curve.result.current.startGesture();
                curve.result.current.change(30, true);
                knob.result.current.startGesture();
                knob.result.current.change(40, true);
            });
            act(() => {
                if (finish === 'unmount') {
                    curve.unmount();
                } else if (finish === 'cancel') {
                    curve.result.current.cancel();
                } else if (finish === 'release') {
                    curve.result.current.settleGesture();
                } else {
                    curve.result.current.change(50, true);
                }
            });
            expect(samples.map(({ value }) => value)).toEqual([30, 40]);
            expect(knob.result.current.value).toBe(40);
            expect(queued).toHaveLength(0);
            act(() => knob.result.current.settleGesture());
            expect(queued).toHaveLength(1);
            expect(queued[0]?.options?.shouldExecute?.()).toBe(true);
            expect(queued[0]?.action).toMatchObject({
                type: 'setDeviceParameter',
                payload: { value: 40, expectedValue: 20, automationRecordingPolicy: 'suppressed' },
            });
        }
    );

    it.each([false, true])(
        'restores inherited preview when the successor cancels after its first sample=%s',
        (sample) => {
            const curve = mountGesture();
            const knob = mountGesture();
            act(() => {
                curve.result.current.startGesture();
                curve.result.current.change(30, true);
                knob.result.current.startGesture();
                if (sample) {
                    knob.result.current.change(40, true);
                }
                knob.result.current.cancel();
            });
            expect(samples.map(({ value }) => value)).toEqual(sample ? [30, 40, 20] : [30, 20]);
            expect(samples.at(-1)?.suppressed).toBe(true);
            expect(curve.result.current.value).toBe(20);
            expect(knob.result.current.value).toBe(20);
            expect(queued).toHaveLength(0);
        }
    );

    it('revokes queued admission synchronously on takeover and fences the old completion', async () => {
        const curve = mountGesture();
        const knob = mountGesture();
        act(() => {
            curve.result.current.startGesture();
            curve.result.current.change(30, true);
            curve.result.current.settleGesture();
        });
        const old = queued[0];
        expect(old).toBeDefined();
        expect(old?.options?.shouldExecute?.()).toBe(true);
        act(() => {
            knob.result.current.startGesture();
            expect(old?.options?.shouldExecute?.()).toBe(false);
            knob.result.current.change(40, true);
        });
        await act(async () => {
            old?.completion.resolve();
            await old?.completion.promise;
        });
        expect(samples.map(({ value }) => value)).toEqual([30, 40]);
        expect(curve.result.current.value).toBe(40);
        expect(knob.result.current.value).toBe(40);
    });

    it.each(['sample', 'cancel', 'queued'] as const)(
        'fences old %s after identity replacement with equal target values',
        async (route) => {
            const curve = mountGesture();
            act(() => {
                curve.result.current.startGesture();
                curve.result.current.change(30, true);
                if (route === 'queued') {
                    curve.result.current.settleGesture();
                }
            });
            const identity = captureProjectRootIdentity();
            act(() => replaceRoot());
            expect(captureProjectRootIdentity()).not.toBe(identity);
            samples.length = 0;
            if (route === 'queued') {
                expect(queued[0]?.options?.shouldExecute?.()).toBe(false);
                await act(async () => {
                    queued[0]?.completion.resolve();
                    await queued[0]?.completion.promise;
                });
            } else {
                act(() => {
                    if (route === 'sample') {
                        curve.result.current.change(40, true);
                        curve.result.current.settleGesture();
                    } else {
                        curve.result.current.cancel();
                    }
                });
                expect(queued).toHaveLength(0);
            }
            expect(samples).toEqual([]);
        }
    );

    it('admits settlement across unrelated edits in the installed lineage', () => {
        const curve = mountGesture();
        act(() => {
            curve.result.current.startGesture();
            curve.result.current.change(30, true);
            curve.result.current.settleGesture();
        });
        const identity = captureProjectRootIdentity();
        act(() => replaceRoot(true));
        expect(captureProjectRootIdentity()).toBe(identity);
        expect(queued[0]?.options?.shouldExecute?.()).toBe(true);
    });

    it.each([
        { paramId: 'dist-mix', deviceId: 'device-1' },
        { paramId: 'dist-drive', deviceId: 'device-2' },
    ])('keeps $deviceId/$paramId independent of another target', ({ paramId, deviceId }) => {
        const curve = mountGesture();
        const other = mountGesture(paramId, deviceId);
        let token = -1;
        act(() => {
            token = curve.result.current.startGesture();
            curve.result.current.change(30, true);
            other.result.current.startGesture();
            other.result.current.change(40, true);
        });
        expect(curve.result.current.isGestureCurrent(token)).toBe(true);
        expect(curve.result.current.value).toBe(30);
        expect(other.result.current.value).toBe(40);
        act(() => curve.result.current.cancel());
        expect(other.result.current.value).toBe(40);
        expect(samples.at(-1)).toMatchObject({ deviceId: 'device-1', paramId: 'dist-drive', value: 20 });
    });
});
