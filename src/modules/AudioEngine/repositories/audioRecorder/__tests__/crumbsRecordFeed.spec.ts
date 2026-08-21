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
 *
 * The lifecycle tests pin the three ways a shared tap can go wrong: a
 * stop/re-arm cycle racing node creation must leave exactly one live tap
 * (the stale one destroyed, not leaked feeding every quantum); stopping one
 * armed instance must not starve another's take; and the last stop tears the
 * tap down so no IPC survives it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

import { attachCrumbsRecordFeedToMonitorSource } from '../attachCrumbsRecordFeedToMonitorSource';
import { feedCrumbsRecordInput } from '../feedCrumbsRecordInput';
import { inputMonitoringSession } from '../inputMonitoringSession';
import { startCrumbsRecordFeed } from '../startCrumbsRecordFeed';
import { stopCrumbsRecordFeed } from '../stopCrumbsRecordFeed';

vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: vi.fn(),
    desktopInvoke: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// The registration gate is settable per test: holding it open is what opens
// the create window the race test needs.
const workletGate = vi.hoisted(() => ({ registration: Promise.resolve() }));

vi.mock('#/infra/audioWorklet/workletInitShared', () => ({
    ensureWorkletRegistered: vi.fn(() => workletGate.registration),
}));

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

function disarmed(node: FakeWorkletNode): boolean {
    return node.port.postMessage.mock.calls.some(([message]) => message?.type === 'disarm');
}

function liveTaps(): FakeWorkletNode[] {
    return FakeWorkletNode.instances.filter((node) => !disarmed(node));
}

function monitoredBlock(): ArrayBuffer {
    return new Float32Array([0.5, 0.25, 0.5, 0.25]).buffer;
}

async function relayBlock(node: FakeWorkletNode): Promise<void> {
    await node.port.onmessage?.(
        new MessageEvent<FeedMessage>('message', { data: { type: 'feed', audio: monitoredBlock(), dropped: 0 } })
    );
}

async function settle(): Promise<void> {
    for (let hop = 0; hop < 10; hop += 1) {
        await Promise.resolve();
    }
}

describe('crumbs record feed session', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        workletGate.registration = Promise.resolve();
        FakeWorkletNode.instances = [];
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
        inputMonitoringSession.monitorSource = null;
        inputMonitoringSession.monitorStream = null;
        // Disarm every id this spec can leave armed, so each test starts
        // from an empty session regardless of what ran before it.
        for (const instanceId of ['inst-A', 'inst-B']) {
            stopCrumbsRecordFeed(instanceId);
        }
    });

    it('stays off the wire in the browser, where there is no native feed', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);
        startCrumbsRecordFeed('inst-A');
        await settle();
        expect(FakeWorkletNode.instances).toEqual([]);
        expect(desktopInvoke).not.toHaveBeenCalled();
    });

    it('arms the tap on start and carries monitored blocks to the record feed command', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopInvoke).mockResolvedValue(undefined);
        inputMonitoringSession.monitorSource = { connect: vi.fn() } as unknown as MediaStreamAudioSourceNode;

        startCrumbsRecordFeed('inst-A');
        await settle();

        const tap = liveTaps()[0];
        if (!tap) {
            throw new Error('expected a live tap');
        }
        expect(tap.port.postMessage).toHaveBeenCalledWith({ type: 'arm' });
        // The tap hangs off the monitored input bus and a silent sink.
        expect(inputMonitoringSession.monitorSource.connect).toHaveBeenCalledWith(tap);

        await relayBlock(tap);
        await settle();

        expect(desktopInvoke).toHaveBeenCalledWith('feed_crumbs_record_input', {
            audioBytes: new Uint8Array(monitoredBlock()),
        });
    });

    it('attaches the armed tap once the monitored input bus exists', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        startCrumbsRecordFeed('inst-A');
        await settle();
        // Armed before monitoring: no source yet, nothing attached.
        expect(FakeWorkletNode.instances).toHaveLength(1);

        const monitorSource = { connect: vi.fn() } as unknown as MediaStreamAudioSourceNode;
        inputMonitoringSession.monitorSource = monitorSource;
        attachCrumbsRecordFeedToMonitorSource();

        expect(monitorSource.connect).toHaveBeenCalledWith(liveTaps()[0]);
    });

    it('stops feeding the moment the last armed instance disarms', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopInvoke).mockResolvedValue(undefined);
        startCrumbsRecordFeed('inst-A');
        await settle();

        const tap = liveTaps()[0];
        if (!tap) {
            throw new Error('expected a live tap');
        }
        const relay = tap.port.onmessage;
        expect(relay).toBeTypeOf('function');

        stopCrumbsRecordFeed('inst-A');
        expect(tap.port.postMessage).toHaveBeenCalledWith({ type: 'disarm' });
        expect(tap.disconnect).toHaveBeenCalled();

        // A late block from the worklet must not reach the native feed.
        await relay?.(
            new MessageEvent<FeedMessage>('message', { data: { type: 'feed', audio: monitoredBlock(), dropped: 0 } })
        );
        await settle();
        expect(desktopInvoke).not.toHaveBeenCalled();

        // Re-arming builds a fresh tap.
        startCrumbsRecordFeed('inst-A');
        await settle();
        expect(FakeWorkletNode.instances).toHaveLength(2);
    });

    it('settles a stop/re-arm race inside the create window to exactly one live tap', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        inputMonitoringSession.monitorSource = { connect: vi.fn() } as unknown as MediaStreamAudioSourceNode;

        let releaseRegistration: () => void = () => {};
        workletGate.registration = new Promise<void>((resolve) => {
            releaseRegistration = resolve;
        });

        startCrumbsRecordFeed('inst-A');
        stopCrumbsRecordFeed('inst-A');
        startCrumbsRecordFeed('inst-A');

        releaseRegistration();
        await settle();

        // Both starts created a node, the stale one destroyed itself, and
        // exactly one tap is live — the leaked-tap and no-tap failures this
        // test exists to catch both fail here.
        expect(FakeWorkletNode.instances).toHaveLength(2);
        expect(liveTaps()).toHaveLength(1);
        const [live] = liveTaps();
        if (!live) {
            throw new Error('expected exactly one live tap');
        }
        expect(live.port.postMessage).toHaveBeenCalledWith({ type: 'arm' });
        expect(inputMonitoringSession.monitorSource.connect).toHaveBeenCalledWith(live);
        expect(inputMonitoringSession.monitorSource.connect).toHaveBeenCalledTimes(1);
    });

    it('keeps feeding a still-armed take when another instance stops', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopInvoke).mockResolvedValue(undefined);

        startCrumbsRecordFeed('inst-A');
        await settle();
        startCrumbsRecordFeed('inst-B');
        await settle();
        expect(FakeWorkletNode.instances).toHaveLength(1);
        const tap = liveTaps()[0];
        if (!tap) {
            throw new Error('expected a live tap');
        }

        // B stops its take: A's armed recorder must keep hearing blocks.
        stopCrumbsRecordFeed('inst-B');
        expect(FakeWorkletNode.instances).toHaveLength(1);
        expect(disarmed(tap)).toBe(false);

        await relayBlock(tap);
        await settle();
        expect(desktopInvoke).toHaveBeenCalledWith('feed_crumbs_record_input', {
            audioBytes: new Uint8Array(monitoredBlock()),
        });

        // The last stop tears the shared tap down.
        stopCrumbsRecordFeed('inst-A');
        expect(disarmed(tap)).toBe(true);
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
