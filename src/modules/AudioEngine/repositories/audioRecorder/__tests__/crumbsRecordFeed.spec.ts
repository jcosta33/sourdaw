/**
 * Crumbs record feed session.
 *
 * The tap this session owns is the record feed's producer (#2231): without it
 * the native crumbs bridges are armed and silent. These tests drive the real
 * session against a fake worklet node and the real desktop-bridge mock, so
 * what is pinned is the producer's contract: the tap arms only on request,
 * carries monitored blocks to `feed_crumbs_record_input` only while armed,
 * attaches to the monitored input bus whenever that bus exists, and tears
 * down clean on stop. Outside the desktop app none of it runs.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

import { inputMonitoringSession } from '../inputMonitoringSession';
import {
    attachCrumbsRecordFeedToMonitorSource,
    startCrumbsRecordFeed,
    stopCrumbsRecordFeed,
} from '../crumbsRecordFeed';
import { feedCrumbsRecordInput } from '../feedCrumbsRecordInput';

const mocks = vi.hoisted(() => ({
    fakeContext: {
        createGain: vi.fn(() => ({
            gain: { value: 1 },
            connect: vi.fn(),
            disconnect: vi.fn(),
        })),
        destination: {},
    },
}));

vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: vi.fn(),
    desktopInvoke: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('#/infra/audioWorklet/workletInitShared', () => ({
    ensureWorkletRegistered: vi.fn(async (): Promise<void> => {}),
}));

vi.mock('../../createWebAudioEngine', () => ({
    audioEngine: { context: mocks.fakeContext },
}));

type FeedMessage = { type: 'feed'; audio: ArrayBuffer; dropped: number };

class FakePort {
    public onmessage: ((event: MessageEvent<FeedMessage>) => Promise<void> | void) | null = null;
    public readonly close = vi.fn();
    public readonly postMessage = vi.fn();
}

class FakeWorkletNode {
    public static instances: FakeWorkletNode[] = [];
    public readonly connect = vi.fn();
    public readonly disconnect = vi.fn();
    public readonly port = new FakePort();

    public constructor() {
        FakeWorkletNode.instances.push(this);
    }
}

function currentTap(): FakeWorkletNode {
    const node = FakeWorkletNode.instances.at(-1);
    if (!node) {
        throw new Error('expected the record feed tap to be created');
    }
    return node;
}

function monitoredBlock(): ArrayBuffer {
    return new Float32Array([0.5, 0.25, 0.5, 0.25]).buffer;
}

async function settle(): Promise<void> {
    for (let hop = 0; hop < 8; hop += 1) {
        await Promise.resolve();
    }
}

describe('crumbs record feed session', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        FakeWorkletNode.instances = [];
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
        inputMonitoringSession.monitorSource = null;
        inputMonitoringSession.monitorStream = null;
        stopCrumbsRecordFeed();
    });

    it('stays off the wire in the browser, where there is no native feed', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);
        startCrumbsRecordFeed();
        await settle();
        expect(FakeWorkletNode.instances).toEqual([]);
        expect(desktopInvoke).not.toHaveBeenCalled();
    });

    it('arms the tap on start and carries monitored blocks to the record feed command', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopInvoke).mockResolvedValue(undefined);
        inputMonitoringSession.monitorSource = { connect: vi.fn() } as unknown as MediaStreamAudioSourceNode;

        startCrumbsRecordFeed();
        await settle();

        const tap = currentTap();
        expect(tap.port.postMessage).toHaveBeenCalledWith({ type: 'arm' });
        // The tap hangs off the monitored input bus and a silent sink.
        expect(inputMonitoringSession.monitorSource.connect).toHaveBeenCalledWith(tap);

        await tap.port.onmessage?.(
            new MessageEvent<FeedMessage>('message', { data: { type: 'feed', audio: monitoredBlock(), dropped: 0 } })
        );
        await settle();

        expect(desktopInvoke).toHaveBeenCalledWith('feed_crumbs_record_input', {
            audioBytes: new Uint8Array(monitoredBlock()),
        });
    });

    it('attaches the armed tap once the monitored input bus exists', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        startCrumbsRecordFeed();
        await settle();
        // Armed before monitoring: no source yet, nothing attached.
        expect(FakeWorkletNode.instances).toHaveLength(1);

        const monitorSource = { connect: vi.fn() } as unknown as MediaStreamAudioSourceNode;
        inputMonitoringSession.monitorSource = monitorSource;
        attachCrumbsRecordFeedToMonitorSource();

        expect(monitorSource.connect).toHaveBeenCalledWith(currentTap());
    });

    it('stops feeding the moment the recording is disarmed', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopInvoke).mockResolvedValue(undefined);
        startCrumbsRecordFeed();
        await settle();

        const tap = currentTap();
        const relay = tap.port.onmessage;
        expect(relay).toBeTypeOf('function');

        stopCrumbsRecordFeed();
        expect(tap.port.postMessage).toHaveBeenCalledWith({ type: 'disarm' });
        expect(tap.disconnect).toHaveBeenCalled();

        // A late block from the worklet must not reach the native feed.
        await relay?.(
            new MessageEvent<FeedMessage>('message', { data: { type: 'feed', audio: monitoredBlock(), dropped: 0 } })
        );
        await settle();
        expect(desktopInvoke).not.toHaveBeenCalled();

        // Re-arming builds a fresh tap: start is idempotent while armed, and
        // stop-then-start produces exactly one live node.
        startCrumbsRecordFeed();
        await settle();
        expect(FakeWorkletNode.instances).toHaveLength(2);
    });

    it('feedCrumbsRecordInput sends the bytes to the registered command only on desktop', async () => {
        const audioBytes = new Uint8Array([1, 2, 3]);
        vi.mocked(isDesktopRuntime).mockReturnValue(false);
        await feedCrumbsRecordInput(audioBytes);
        expect(desktopInvoke).not.toHaveBeenCalled();

        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopInvoke).mockResolvedValue(undefined);
        await feedCrumbsRecordInput(audioBytes);
        expect(desktopInvoke).toHaveBeenCalledWith('feed_crumbs_record_input', { audioBytes });
    });
});
