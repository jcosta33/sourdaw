import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createMockAudioContext, type MockAudioContext } from '#/helpers/__tests__/audioContext.mock';

import { setAudioDeviceRuntimeSink } from '../../engine/audioDeviceRuntimeSink';

import {
    createAudioEngineTopologyTestHarness as createAudioEngine,
    type AudioEngineTopologyTestHarness,
} from './createAudioEngineTopologyTestHarness';

import type { GrandBouleNodeResult } from '../../engine/GrandBouleNode';
import type { ToasterNodeResult } from '../../engine/ToasterNode';

const toasterFactory = vi.hoisted(() => ({ createToasterNode: vi.fn() }));
const grandBouleFactory = vi.hoisted(() => ({ createGrandBouleNode: vi.fn() }));

vi.mock('../../engine/ToasterNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../engine/ToasterNode')>()),
    createToasterNode: toasterFactory.createToasterNode,
}));

vi.mock('../../engine/GrandBouleNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../engine/GrandBouleNode')>()),
    createGrandBouleNode: grandBouleFactory.createGrandBouleNode,
}));

class FakeWorkletNode {
    port = { postMessage: vi.fn(), close: vi.fn() };
    connect = vi.fn();
    disconnect = vi.fn();
}

/**
 * The engine constructor and `ToasterNodeResult` want real Web Audio nominal
 * types; the fakes match structurally. Each conversion goes through one helper.
 */
function asAudioContext(ctx: MockAudioContext): AudioContext {
    return ctx as unknown as AudioContext;
}

function asWorkletNode(node: FakeWorkletNode): AudioWorkletNode {
    return node as unknown as AudioWorkletNode;
}

function asGainNode(node: FakeWorkletNode): GainNode {
    return node as unknown as GainNode;
}

function makeToasterResult(): ToasterNodeResult {
    return {
        workletNode: asWorkletNode(new FakeWorkletNode()),
        outputNode: asGainNode(new FakeWorkletNode()),
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        scheduleHit: vi.fn(),
        cancelScheduled: vi.fn(),
        allNotesOff: vi.fn(),
        setFillActive: vi.fn(),
        acceptsScheduledParam: vi.fn(),
        scheduleParam: vi.fn(),
        setParam: vi.fn(),
        setPadParam: vi.fn(),
        setPadDryRouted: vi.fn(),
        setBypass: vi.fn(),
        processorLifecycle: vi.fn(() => 'sleep' as const),
        connectPadOutput: vi.fn(),
        disconnectPadOutput: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        destroy: vi.fn(),
        ready: Promise.resolve({}),
    };
}

/** A Toaster whose worklet construction finishes only when the test says so. */
function stubPendingToasterNode(): { result: ToasterNodeResult; finishLoad: () => void } {
    const construction = Promise.withResolvers<ToasterNodeResult>();
    const result = makeToasterResult();
    toasterFactory.createToasterNode.mockReturnValue(construction.promise);
    return { result, finishLoad: () => construction.resolve(result) };
}

function makeGrandBouleResult(): GrandBouleNodeResult {
    return {
        workletNode: asWorkletNode(new FakeWorkletNode()),
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        noteExpression: vi.fn(),
        setParam: vi.fn(),
        setSustain: vi.fn(),
        setUnaCorda: vi.fn(),
        setSostenuto: vi.fn(),
        discardStoredPedals: vi.fn(),
        noteOnMidi2: vi.fn(),
        setTemperament: vi.fn(),
        allNotesOff: vi.fn(),
        setBypass: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        destroy: vi.fn(),
        ready: Promise.resolve({}),
    };
}

function isRuntimeFailureReporter(value: unknown): value is (message: string) => void {
    return typeof value === 'function';
}

/** The runtime failure reporter handed to the newest Toaster construction. */
function newestRuntimeFailureReporter(): (message: string) => void {
    const reportRuntimeFailure: unknown = toasterFactory.createToasterNode.mock.calls.at(-1)?.[2];
    if (!isRuntimeFailureReporter(reportRuntimeFailure)) {
        throw new TypeError('expected ToasterNode to receive a runtime failure reporter');
    }
    return reportRuntimeFailure;
}

type ChainDevice = { id: string; type: string; parameterIds: string[] };

function replaceDeviceChain(
    engine: AudioEngineTopologyTestHarness,
    before: readonly ChainDevice[],
    after: readonly ChainDevice[]
): void {
    const result = engine.applyRuntimeGraphDelta({
        schemaVersion: 1,
        command: 'replace-track-device-chain',
        correlation: { appRevision: engine.getRuntimeGraphRevision(), projectRevision: 'project-revision-1' },
        operation: 'replace-device-chain',
        before: { id: 't1', kind: 'midi', devices: before },
        after: { id: 't1', kind: 'midi', devices: after },
        parameters: [],
    });
    expect(result).toMatchObject({ acceptance: 'accepted', application: 'applied' });
}

const toasterInChain: ChainDevice = { id: 'toast-1', type: 'toaster', parameterIds: [] };
const gainInChain: ChainDevice = { id: 'gain-1', type: 'builtin-gain', parameterIds: [] };

type DeviceLifecyclePayload = { deviceId: string; deviceType: string };

/** Drain the descriptor's promise chain (factory → readiness → publish). */
async function settleDeviceLoad(): Promise<void> {
    await new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

function trackDeviceIds(engine: AudioEngineTopologyTestHarness): string[] {
    return engine.getTrackStrip('t1')?.deviceNodes.map((device) => device.deviceId) ?? [];
}

describe('Toaster removed while its device is still loading', () => {
    let engine: AudioEngineTopologyTestHarness;
    const emitDeviceLoaded = vi.fn();
    const emitDeviceRemoved = vi.fn<(payload: DeviceLifecyclePayload) => void>();

    function toasterRemovals(): DeviceLifecyclePayload[] {
        return emitDeviceRemoved.mock.calls
            .map(([payload]) => payload)
            .filter(({ deviceType }) => deviceType === 'toaster');
    }

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
        setAudioDeviceRuntimeSink({ emitDeviceLoaded, emitDeviceRemoved });
        engine = createAudioEngine(asAudioContext(createMockAudioContext()));
    });

    afterEach(() => {
        setAudioDeviceRuntimeSink({});
        vi.unstubAllGlobals();
    });

    // The Toaster module drops the kit writes and pad selection it queued for a
    // loading device only on `audioDevice.removed`. A removal that skipped the
    // notification left them queued for the next registration of the same id.
    it('notifies the removal exactly once, and a late load neither loads nor removes it again', async () => {
        const toaster = stubPendingToasterNode();
        engine.addDeviceToStrip('t1', 'toast-1', 'toaster');

        engine.removeDeviceFromStrip('t1', 'toast-1');

        expect(emitDeviceRemoved).toHaveBeenCalledOnce();
        expect(emitDeviceRemoved).toHaveBeenCalledWith({ deviceId: 'toast-1', deviceType: 'toaster' });

        toaster.finishLoad();
        await settleDeviceLoad();

        expect(emitDeviceLoaded).not.toHaveBeenCalled();
        expect(emitDeviceRemoved).toHaveBeenCalledOnce();
        expect(toaster.result.destroy).toHaveBeenCalledOnce();
        expect(trackDeviceIds(engine)).toEqual([]);
    });

    it('notifies the removal once when the track holding the loading device is removed', () => {
        stubPendingToasterNode();
        engine.addDeviceToStrip('t1', 'toast-1', 'toaster');

        engine.removeTrackStrip('t1');

        expect(emitDeviceRemoved).toHaveBeenCalledOnce();
        expect(emitDeviceRemoved).toHaveBeenCalledWith({ deviceId: 'toast-1', deviceType: 'toaster' });
    });

    it('notifies a loaded device removal once, not again for its placeholder', async () => {
        const toaster = stubPendingToasterNode();
        engine.addDeviceToStrip('t1', 'toast-1', 'toaster');
        toaster.finishLoad();
        await settleDeviceLoad();
        expect(emitDeviceLoaded).toHaveBeenCalledOnce();

        engine.removeDeviceFromStrip('t1', 'toast-1');

        expect(emitDeviceRemoved).toHaveBeenCalledOnce();
        expect(toaster.result.destroy).toHaveBeenCalledOnce();
    });

    // Recovery discards the failed generation's placeholder and loads the same
    // device again. The device never left the project, so its Toaster record
    // (kit edits, running sequencer) must survive the swap.
    it('does not notify a removal when runtime recovery replaces the failed placeholder', async () => {
        const toaster = stubPendingToasterNode();
        engine.addDeviceToStrip('t1', 'toast-1', 'toaster');
        toaster.finishLoad();
        await settleDeviceLoad();
        const reportRuntimeFailure: unknown = toasterFactory.createToasterNode.mock.calls.at(-1)?.[2];
        if (!isRuntimeFailureReporter(reportRuntimeFailure)) {
            throw new TypeError('expected ToasterNode to receive a runtime failure reporter');
        }
        stubPendingToasterNode();

        reportRuntimeFailure('processor failed');
        await settleDeviceLoad();

        expect(toasterFactory.createToasterNode).toHaveBeenCalledTimes(2);
        expect(trackDeviceIds(engine)).toEqual(['toast-1']);
        expect(emitDeviceRemoved).not.toHaveBeenCalled();
    });

    // Recovery runs once per device, so a second runtime failure leaves the
    // failed stand-in in the chain for good. Removing it is still a removal.
    it('notifies the removal once after a second runtime failure left the device unrecovered', async () => {
        const firstLoad = stubPendingToasterNode();
        engine.addDeviceToStrip('t1', 'toast-1', 'toaster');
        firstLoad.finishLoad();
        await settleDeviceLoad();
        const reportFirstFailure = newestRuntimeFailureReporter();
        const secondLoad = stubPendingToasterNode();
        reportFirstFailure('processor failed');
        await settleDeviceLoad();
        secondLoad.finishLoad();
        await settleDeviceLoad();
        newestRuntimeFailureReporter()('processor failed again');
        await settleDeviceLoad();
        expect(toasterFactory.createToasterNode).toHaveBeenCalledTimes(2);
        expect(trackDeviceIds(engine)).toEqual(['toast-1']);
        expect(emitDeviceRemoved).not.toHaveBeenCalled();

        engine.removeDeviceFromStrip('t1', 'toast-1');

        expect(emitDeviceRemoved).toHaveBeenCalledOnce();
        expect(emitDeviceRemoved).toHaveBeenCalledWith({ deviceId: 'toast-1', deviceType: 'toaster' });
    });

    it('notifies nothing when a chain replacement keeps the loading id, and once when one drops it', () => {
        stubPendingToasterNode();
        engine.addDeviceToStrip('t1', 'toast-1', 'toaster');

        replaceDeviceChain(engine, [toasterInChain], [gainInChain, toasterInChain]);

        expect(trackDeviceIds(engine)).toEqual(['gain-1', 'toast-1']);
        expect(emitDeviceRemoved).not.toHaveBeenCalled();

        replaceDeviceChain(
            engine,
            [gainInChain, toasterInChain],
            [{ id: 'gain-2', type: 'builtin-gain', parameterIds: [] }]
        );

        expect(toasterRemovals()).toEqual([{ deviceId: 'toast-1', deviceType: 'toaster' }]);
    });

    it('notifies nothing when a graph reset tears down a loaded and a loading device', async () => {
        const loaded = stubPendingToasterNode();
        engine.addDeviceToStrip('t1', 'toast-1', 'toaster');
        loaded.finishLoad();
        await settleDeviceLoad();
        stubPendingToasterNode();
        engine.addDeviceToStrip('t1', 'toast-2', 'toaster');

        engine.resetGraph();

        expect(loaded.result.destroy).toHaveBeenCalledOnce();
        expect(emitDeviceRemoved).not.toHaveBeenCalled();

        stubPendingToasterNode();
        engine.addDeviceToStrip('t1', 'toast-2', 'toaster');
        engine.removeTrackStrip('t1');

        expect(emitDeviceRemoved).toHaveBeenCalledOnce();
        expect(emitDeviceRemoved).toHaveBeenCalledWith({ deviceId: 'toast-2', deviceType: 'toaster' });
    });

    // A promotion whose graph rebuild fails puts the placeholder back. The
    // device never left the project, so only its later removal is announced.
    it('notifies nothing when a promotion rolls back, and once on the later removal', async () => {
        const toaster = stubPendingToasterNode();
        vi.spyOn(toaster.result.outputNode, 'connect').mockImplementation(() => {
            throw new Error('graph refused the promoted node');
        });
        engine.addDeviceToStrip('t1', 'toast-1', 'toaster');

        toaster.finishLoad();
        await settleDeviceLoad();

        expect(toaster.result.destroy).toHaveBeenCalledOnce();
        expect(trackDeviceIds(engine)).toEqual(['toast-1']);
        expect(emitDeviceRemoved).not.toHaveBeenCalled();

        engine.removeDeviceFromStrip('t1', 'toast-1');

        expect(emitDeviceRemoved).toHaveBeenCalledOnce();
        expect(emitDeviceRemoved).toHaveBeenCalledWith({ deviceId: 'toast-1', deviceType: 'toaster' });
    });
});

describe('device removal announcements at strip teardown', () => {
    let engine: AudioEngineTopologyTestHarness;
    const emitDeviceLoaded = vi.fn();
    const emitDeviceRemoved = vi.fn<(payload: DeviceLifecyclePayload) => void>();

    function announcedRemovals(): DeviceLifecyclePayload[] {
        return emitDeviceRemoved.mock.calls.map(([payload]) => payload);
    }

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
        setAudioDeviceRuntimeSink({ emitDeviceLoaded, emitDeviceRemoved });
        engine = createAudioEngine(asAudioContext(createMockAudioContext()));
    });

    afterEach(() => {
        setAudioDeviceRuntimeSink({});
        vi.unstubAllGlobals();
    });

    // A failed Grand Boule leaves its stand-in in the chain: the device is still
    // in the project, so only its later removal is announced.
    it('announces no removal when Grand Boule fails at runtime, and once when it is removed', async () => {
        grandBouleFactory.createGrandBouleNode.mockResolvedValue(makeGrandBouleResult());
        engine.addDeviceToStrip('t1', 'gb-1', 'grand-boule');
        await settleDeviceLoad();
        expect(emitDeviceLoaded).toHaveBeenCalledWith({ deviceId: 'gb-1', deviceType: 'grand-boule' });
        const reportRuntimeFailure: unknown = grandBouleFactory.createGrandBouleNode.mock.calls.at(-1)?.[2];
        if (!isRuntimeFailureReporter(reportRuntimeFailure)) {
            throw new TypeError('expected GrandBouleNode to receive a runtime failure reporter');
        }

        reportRuntimeFailure('render failed');
        await settleDeviceLoad();

        expect(trackDeviceIds(engine)).toEqual(['gb-1']);
        expect(announcedRemovals()).toEqual([]);

        engine.removeDeviceFromStrip('t1', 'gb-1');

        expect(announcedRemovals()).toEqual([{ deviceId: 'gb-1', deviceType: 'grand-boule' }]);
    });

    // Removing a folder's last Toaster deactivates its strip, but the folder and
    // the devices it still holds stay in the project.
    it('announces only the removed Toaster when its folder strip is deactivated', () => {
        stubPendingToasterNode();
        engine.addDeviceToStrip('folder-1', 'toast-1', 'toaster');
        engine.addDeviceToStrip('folder-1', 'gain-1', 'builtin-gain');

        engine.removeDeviceFromStrip('folder-1', 'toast-1');
        engine.deactivateTrackStrip('folder-1');

        expect(engine.getTrackStrip('folder-1')).toBeUndefined();
        expect(announcedRemovals()).toEqual([{ deviceId: 'toast-1', deviceType: 'toaster' }]);
    });

    it('announces each device once when the track holding them is removed', async () => {
        const toaster = stubPendingToasterNode();
        engine.addDeviceToStrip('t1', 'toast-1', 'toaster');
        toaster.finishLoad();
        await settleDeviceLoad();
        engine.addDeviceToStrip('t1', 'gain-1', 'builtin-gain');

        engine.removeTrackStrip('t1');

        expect(announcedRemovals()).toEqual([
            { deviceId: 'toast-1', deviceType: 'toaster' },
            { deviceId: 'gain-1', deviceType: 'builtin-gain' },
        ]);
    });

    it('announces each device once when a bus strip is removed', () => {
        engine.ensureBusStrip('bus-1');
        engine.addDeviceToStrip('bus-1', 'gain-b', 'builtin-gain');

        engine.removeBusStrip('bus-1');

        expect(engine.getTrackStrip('bus-1')).toBeUndefined();
        expect(announcedRemovals()).toEqual([{ deviceId: 'gain-b', deviceType: 'builtin-gain' }]);
    });

    it('announces nothing when a graph reset tears down a bus strip and its device', () => {
        engine.ensureBusStrip('bus-1');
        engine.addDeviceToStrip('bus-1', 'gain-b', 'builtin-gain');

        engine.resetGraph();

        expect(engine.getTrackStrip('bus-1')).toBeUndefined();
        expect(announcedRemovals()).toEqual([]);
    });
});
