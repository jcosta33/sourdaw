import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createMockAudioContext, type MockAudioContext } from '#/helpers/__tests__/audioContext.mock';

import { setAudioDeviceRuntimeSink } from '../../engine/audioDeviceRuntimeSink';

import {
    createAudioEngineTopologyTestHarness as createAudioEngine,
    type AudioEngineTopologyTestHarness,
} from './createAudioEngineTopologyTestHarness';

import type { ToasterNodeResult } from '../../engine/ToasterNode';

const toasterFactory = vi.hoisted(() => ({ createToasterNode: vi.fn() }));

vi.mock('../../engine/ToasterNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../engine/ToasterNode')>()),
    createToasterNode: toasterFactory.createToasterNode,
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

function isRuntimeFailureReporter(value: unknown): value is (message: string) => void {
    return typeof value === 'function';
}

/** Drain the descriptor's promise chain (factory → readiness → publish). */
async function settleDeviceLoad(): Promise<void> {
    await new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

function toasterDeviceIds(engine: AudioEngineTopologyTestHarness): string[] {
    return engine.getTrackStrip('t1')?.deviceNodes.map((device) => device.deviceId) ?? [];
}

describe('Toaster removed while its device is still loading', () => {
    let engine: AudioEngineTopologyTestHarness;
    const emitDeviceLoaded = vi.fn();
    const emitDeviceRemoved = vi.fn();

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
        expect(toasterDeviceIds(engine)).toEqual([]);
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
        expect(toasterDeviceIds(engine)).toEqual(['toast-1']);
        expect(emitDeviceRemoved).not.toHaveBeenCalled();
    });
});
