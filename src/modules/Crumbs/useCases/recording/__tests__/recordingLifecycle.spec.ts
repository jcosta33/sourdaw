import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CrumbsRecordingSnapshot } from '../../../stores/crumbsRecordingStore';

const devicePopulation = vi.hoisted(() => ({
    subscribe:
        vi.fn<
            (handler: (state: { tracks: { devices: { id: string; type: string }[] }[] } | null) => void) => () => void
        >(),
}));
vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: devicePopulation }));
vi.mock('../../crumbsLifecycle/ensureCrumbsInstanceFromProject', () => ({ ensureCrumbsInstanceFromProject: vi.fn() }));

const bridge = vi.hoisted(() => ({
    create: vi.fn<() => Promise<{ attached: boolean }>>(),
    arm: vi.fn<(...args: unknown[]) => Promise<{ take_id: string } | null>>(),
    stop: vi.fn<(...args: unknown[]) => Promise<void>>(),
    get: vi.fn<(id: string) => Promise<CrumbsRecordingSnapshot | null>>(),
    on: vi.fn<(handler: (snapshot: CrumbsRecordingSnapshot) => void) => Promise<() => void>>(),
}));
vi.mock('../../../repositories/crumbsBridge/isCrumbsNativeAvailable', () => ({ isCrumbsNativeAvailable: () => true }));
vi.mock('../../../repositories/crumbsBridge/createCrumbsInstance', () => ({ createCrumbsInstance: bridge.create }));
vi.mock('../../../repositories/crumbsBridge/destroyCrumbsInstance', () => ({
    destroyCrumbsInstance: async () => undefined,
}));
vi.mock('../../../repositories/crumbsBridge/armRecording', () => ({ armRecording: bridge.arm }));
vi.mock('../../../repositories/crumbsBridge/stopRecording', () => ({ stopRecording: bridge.stop }));
vi.mock('../../../repositories/crumbsBridge/getCrumbsRecordingState', () => ({ getCrumbsRecordingState: bridge.get }));
vi.mock('../../../repositories/crumbsBridge/onCrumbsRecordingState', () => ({ onCrumbsRecordingState: bridge.on }));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { crumbsRecordingOwners, crumbsRecordingStore } from '../../../stores/crumbsRecordingStore';
import { ensurePadInstance, padStore } from '../../../stores/padStore';
import { armCrumbsRecording } from '../armCrumbsRecording';
import { stopCrumbsRecording } from '../stopCrumbsRecording';
import { syncCrumbsNativeInstances } from '../../crumbsLifecycle/syncCrumbsNativeInstances';
import { syncCrumbsRecordingState } from '../syncCrumbsRecordingState';

const DEVICE = 'sampler';
const unlisten = vi.fn();
let receive: (snapshot: CrumbsRecordingSnapshot) => void;
function snapshot(overrides: Partial<CrumbsRecordingSnapshot> = {}): CrumbsRecordingSnapshot {
    return {
        instance_id: DEVICE,
        instance_incarnation: '1',
        take_id: '0',
        revision: '0',
        phase: 'idle',
        first_input: null,
        failure: null,
        ...overrides,
    };
}
function inputSnapshot(overrides: Partial<CrumbsRecordingSnapshot> = {}): CrumbsRecordingSnapshot {
    return snapshot({
        take_id: '7',
        revision: '1',
        phase: 'waiting',
        first_input: { position_frames: '9007199254740993', frames: 128 },
        ...overrides,
    });
}

beforeEach(async () => {
    bridge.create.mockReset().mockResolvedValue({ attached: true });
    devicePopulation.subscribe.mockReset().mockReturnValue(() => undefined);
    bridge.arm.mockReset().mockResolvedValue({ take_id: '7' });
    bridge.stop.mockReset().mockResolvedValue(undefined);
    bridge.get.mockReset().mockImplementation(async () => snapshot());
    bridge.on.mockReset().mockImplementation(async (handler) => {
        receive = handler;
        return unlisten;
    });
    unlisten.mockClear();
    padStore.set({});
    ensurePadInstance(DEVICE);
    crumbsRecordingStore.set({});
    await syncCrumbsRecordingState(DEVICE, 'attach');
});
afterEach(async () => {
    for (const id of crumbsRecordingOwners.keys()) {
        await syncCrumbsRecordingState(id, 'detach');
    }
});

describe('native recording lifecycle', () => {
    it('queues an early Stop after arm admission without waiting for readiness', async () => {
        const admission = Promise.withResolvers<{ take_id: string }>();
        bridge.arm.mockReturnValueOnce(admission.promise);
        const arming = armCrumbsRecording(DEVICE, 0.1, 0, 60);
        await waitFor(() => expect(bridge.arm).toHaveBeenCalledOnce());
        const stopping = stopCrumbsRecording(DEVICE);
        expect(crumbsRecordingStore.value?.[DEVICE]?.phase).toBe('finishing');
        expect(bridge.stop).not.toHaveBeenCalled();
        admission.resolve({ take_id: '7' });
        await Promise.all([arming, stopping]);
        expect(bridge.stop).toHaveBeenCalledExactlyOnceWith(DEVICE, '7');
        receive(inputSnapshot());
        expect(crumbsRecordingStore.value?.[DEVICE]?.phase).toBe('finishing');
        receive(snapshot({ take_id: '7', revision: '2', phase: 'cancelled' }));
        expect(crumbsRecordingStore.value?.[DEVICE]?.phase).toBe('cancelled');
    });

    it('binds the recorder listener to persistent device creation and retracts late setup on disposal', async () => {
        await syncCrumbsRecordingState(DEVICE, 'detach');
        const create = Promise.withResolvers<{ attached: boolean }>();
        bridge.create.mockReturnValueOnce(create.promise);
        const dispose = syncCrumbsNativeInstances();
        const populate = devicePopulation.subscribe.mock.calls[0]?.[0];
        expect(populate).toBeDefined();
        populate?.({ tracks: [{ devices: [{ id: DEVICE, type: 'builtin-crumbs' }] }] });
        await waitFor(() => expect(bridge.create).toHaveBeenCalledOnce());
        dispose();
        create.resolve({ attached: true });
        await waitFor(() => expect(unlisten).toHaveBeenCalledTimes(2));
        expect(crumbsRecordingOwners.has(DEVICE)).toBe(false);
    });

    it('keeps native completion independent of panel subscription lifetime', async () => {
        const detachPanel = crumbsRecordingStore.subscribe(vi.fn());
        await armCrumbsRecording(DEVICE, 0.1, 0, 60);
        detachPanel();
        expect(unlisten).not.toHaveBeenCalled();
        receive(inputSnapshot({ phase: 'recording' }));
        receive(inputSnapshot({ revision: '2', phase: 'completed' }));
        expect(crumbsRecordingStore.value?.[DEVICE]?.phase).toBe('completed');
        expect(bridge.stop).not.toHaveBeenCalled();
        await syncCrumbsRecordingState(DEVICE, 'detach');
        expect(unlisten).toHaveBeenCalledOnce();
    });

    it('projects only the current instance incarnation and increasing revision', async () => {
        receive(inputSnapshot({ revision: '10' }));
        receive(inputSnapshot({ revision: '9', phase: 'recording' }));
        receive(inputSnapshot({ instance_incarnation: '0', revision: '99', phase: 'failed' }));
        receive(inputSnapshot({ instance_id: 'foreign', revision: '99', phase: 'failed' }));
        expect(crumbsRecordingStore.value?.[DEVICE]?.phase).toBe('waiting');
        bridge.get.mockResolvedValue(snapshot({ instance_incarnation: '2' }));
        await syncCrumbsRecordingState(DEVICE, 'reconcile');
        receive(inputSnapshot({ revision: '100', phase: 'recording' }));
        expect(crumbsRecordingStore.value?.[DEVICE]?.snapshot?.instance_incarnation).toBe('2');
        expect(crumbsRecordingStore.value?.[DEVICE]?.phase).toBe('idle');
    });

    it('reconciles an event racing listener setup without accepting an old incarnation', async () => {
        await syncCrumbsRecordingState(DEVICE, 'detach');
        const baseline = Promise.withResolvers<CrumbsRecordingSnapshot>();
        bridge.get.mockReturnValueOnce(baseline.promise);
        const attaching = syncCrumbsRecordingState(DEVICE, 'attach');
        await waitFor(() => expect(bridge.get).toHaveBeenCalledTimes(2));
        receive(inputSnapshot({ instance_incarnation: '3', revision: '2' }));
        baseline.resolve(snapshot({ instance_incarnation: '3' }));
        await attaching;
        expect(crumbsRecordingStore.value?.[DEVICE]?.phase).toBe('waiting');
    });

    it('cancels late admission by its exact token without touching a replacement instance', async () => {
        const admission = Promise.withResolvers<{ take_id: string }>();
        bridge.arm.mockReturnValueOnce(admission.promise);
        const oldArm = armCrumbsRecording(DEVICE, 0.1, 0, 60);
        await waitFor(() => expect(bridge.arm).toHaveBeenCalledOnce());
        const oldReceive = receive;
        await syncCrumbsRecordingState(DEVICE, 'detach');
        bridge.get.mockResolvedValue(snapshot({ instance_incarnation: '2' }));
        await syncCrumbsRecordingState(DEVICE, 'attach');
        bridge.arm.mockResolvedValueOnce({ take_id: '8' });
        await armCrumbsRecording(DEVICE, 0.1, 0, 60);
        receive(inputSnapshot({ instance_incarnation: '2', take_id: '8' }));
        admission.resolve({ take_id: '7' });
        await expect(oldArm).resolves.toBe(false);
        await waitFor(() => expect(bridge.stop).toHaveBeenCalledExactlyOnceWith(DEVICE, '7'));
        oldReceive(inputSnapshot({ revision: '100', phase: 'completed' }));
        receive(inputSnapshot({ instance_incarnation: '2', take_id: '7', revision: '100', phase: 'completed' }));
        expect(crumbsRecordingStore.value?.[DEVICE]?.phase).toBe('waiting');
        expect(crumbsRecordingStore.value?.[DEVICE]?.snapshot?.take_id).toBe('8');
    });

    it('keeps a refused Stop active and exposes the refusal until an actual terminal', async () => {
        await armCrumbsRecording(DEVICE, 0.1, 0, 60);
        receive(inputSnapshot({ phase: 'recording' }));
        bridge.stop.mockRejectedValueOnce(new Error('Command queue full'));
        await expect(stopCrumbsRecording(DEVICE)).rejects.toThrow('Command queue full');
        expect(crumbsRecordingStore.value?.[DEVICE]?.phase).toBe('recording');
        expect(crumbsRecordingStore.value?.[DEVICE]?.failure).toContain('Command queue full');
        await expect(armCrumbsRecording(DEVICE, 0.1, 0, 60)).resolves.toBe(false);
        receive(inputSnapshot({ revision: '2', phase: 'completed' }));
        bridge.arm.mockResolvedValueOnce({ take_id: '8' });
        await expect(armCrumbsRecording(DEVICE, 0.1, 0, 60)).resolves.toBe(true);
    });
});
