import { describe, expect, it, vi } from 'vitest';

import { createSidechainRouting, type SidechainRoutingPorts } from '../createSidechainRouting';

import type { TrackChannelStrip } from '../../../models/AudioEngineState';

type FakeNode = { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };

type FakeDelay = FakeNode & {
    maxDelay: number;
    delayTime: {
        value: number;
        cancelScheduledValues: ReturnType<typeof vi.fn>;
        setValueAtTime: ReturnType<typeof vi.fn>;
        linearRampToValueAtTime: ReturnType<typeof vi.fn>;
    };
};

function createFakeNode(): FakeNode {
    return { connect: vi.fn(), disconnect: vi.fn() };
}

function createStrip(deviceNodes: unknown[] = []) {
    const analyserNode = createFakeNode();
    return { analyserNode, strip: { analyserNode, deviceNodes } as unknown as TrackChannelStrip };
}

function createFixture() {
    const gains: Array<FakeNode & { gain: { value: number } }> = [];
    const delays: FakeDelay[] = [];
    const context = {
        currentTime: 2,
        createGain: vi.fn(() => {
            const gain = { ...createFakeNode(), gain: { value: 0 } };
            gains.push(gain);
            return gain;
        }),
        createDelay: vi.fn((maxDelay: number) => {
            const delay: FakeDelay = {
                ...createFakeNode(),
                maxDelay,
                delayTime: {
                    value: 0.5,
                    cancelScheduledValues: vi.fn(),
                    setValueAtTime: vi.fn(),
                    linearRampToValueAtTime: vi.fn(),
                },
            };
            delays.push(delay);
            return delay;
        }),
    };
    const detectorInput = createFakeNode();
    const source = createStrip();
    const target = createStrip([
        { deviceId: 'eq', type: 'builtin-eq', inputNode: createFakeNode() },
        { deviceId: 'sc', type: 'builtin-sidechain-compressor', inputNode: detectorInput },
    ]);
    const strips = new Map<string, TrackChannelStrip>([
        ['src', source.strip],
        ['dst', target.strip],
    ]);
    let fallback = false;
    const published: boolean[] = [];
    const ports: SidechainRoutingPorts = {
        readContext: () => context as unknown as AudioContext,
        isFallback: () => fallback,
        readTrackStrip: (trackId) => strips.get(trackId),
        mutateRuntimeGraph: (mutation) => {
            published.push(mutation());
        },
    };
    return {
        routing: createSidechainRouting(ports),
        context,
        gains,
        delays,
        detectorInput,
        sourceTap: source.analyserNode,
        strips,
        published,
        setFallback: (value: boolean) => {
            fallback = value;
        },
    };
}

describe('createSidechainRouting', () => {
    it('wires the post-fader tap through a zeroed key alignment line into the detector input', () => {
        const { routing, gains, delays, detectorInput, sourceTap, published } = createFixture();

        routing.wireRoute('src', 'dst', 'sc');

        const [delay] = delays;
        const [gain] = gains;
        expect(delay?.maxDelay).toBe(1);
        expect(delay?.delayTime.value).toBe(0);
        expect(gain?.gain.value).toBe(1);
        expect(sourceTap.connect).toHaveBeenCalledExactlyOnceWith(delay);
        expect(delay?.connect).toHaveBeenCalledExactlyOnceWith(gain);
        expect(gain?.connect).toHaveBeenCalledExactlyOnceWith(detectorInput, 0, 1);
        expect(routing.connectionCount()).toBe(1);
        expect(published).toEqual([true]);
    });

    it('publishes no change for a route already wired or a target that is not a sidechain compressor', () => {
        const { routing, gains, published } = createFixture();
        routing.wireRoute('src', 'dst', 'sc');

        routing.wireRoute('src', 'dst', 'sc');
        routing.wireRoute('src', 'dst', 'eq');
        routing.wireRoute('src', 'missing', 'sc');

        expect(gains).toHaveLength(1);
        expect(published).toEqual([true, false, false, false]);
    });

    it('holds a route requested on the fallback graph and replays it on the next wire', () => {
        const { routing, gains, strips, published, setFallback } = createFixture();
        const later = createStrip([
            { deviceId: 'sc2', type: 'builtin-sidechain-compressor', inputNode: createFakeNode() },
        ]);
        setFallback(true);

        routing.wireRoute('src', 'later', 'sc2');

        expect(gains).toHaveLength(0);
        expect(published).toEqual([]);
        expect(routing.pendingRoutes.get('src→sc2')).toEqual({
            sourceTrackId: 'src',
            targetTrackId: 'later',
            targetDeviceId: 'sc2',
        });

        setFallback(false);
        strips.set('later', later.strip);
        routing.wireRoute('src', 'dst', 'sc');

        expect(routing.pendingRoutes.size).toBe(0);
        expect(routing.connectionCount()).toBe(2);
        expect(published).toEqual([true]);
    });

    it('unwiring disconnects every edge of the live route and cancels a queued one', () => {
        const { routing, gains, delays, sourceTap, published, setFallback } = createFixture();
        routing.wireRoute('src', 'dst', 'sc');
        setFallback(true);
        routing.wireRoute('src', 'other', 'sc');
        setFallback(false);

        routing.unwireRoute('src', 'sc');
        routing.unwireRoute('src', 'sc');

        expect(sourceTap.disconnect).toHaveBeenCalledExactlyOnceWith(delays[0]);
        expect(delays[0]?.disconnect).toHaveBeenCalledTimes(1);
        expect(gains[0]?.disconnect).toHaveBeenCalledTimes(1);
        expect(routing.connectionCount()).toBe(0);
        expect(routing.pendingRoutes.size).toBe(0);
        expect(published).toEqual([true, true, false]);
    });

    it('glides a changed key alignment once, clamped to the line ceiling', () => {
        const { routing, delays } = createFixture();
        routing.wireRoute('src', 'dst', 'sc');
        const resolver = vi.fn(() => 3);

        routing.refreshAlignment(resolver);
        routing.refreshAlignment(resolver);

        const param = delays[0]?.delayTime;
        expect(resolver).toHaveBeenCalledWith({ sourceTrackId: 'src', targetTrackId: 'dst', targetDeviceId: 'sc' });
        expect(param?.cancelScheduledValues).toHaveBeenCalledExactlyOnceWith(2);
        expect(param?.setValueAtTime).toHaveBeenCalledExactlyOnceWith(0, 2);
        expect(param?.linearRampToValueAtTime).toHaveBeenCalledExactlyOnceWith(1, 2.01);
    });

    it('resolves no alignment on the fallback graph', () => {
        const { routing, setFallback } = createFixture();
        routing.wireRoute('src', 'dst', 'sc');
        setFallback(true);
        const resolver = vi.fn(() => 0.1);

        routing.refreshAlignment(resolver);

        expect(resolver).not.toHaveBeenCalled();
    });

    it('re-attaches the key of a rebuilt source strip to its alignment line', () => {
        const { routing, delays, sourceTap } = createFixture();
        routing.wireRoute('src', 'dst', 'sc');
        const rebuilt = createStrip();

        routing.reconnectTrack('src', rebuilt.strip);

        expect(sourceTap.disconnect).toHaveBeenCalledExactlyOnceWith(delays[0]);
        expect(rebuilt.analyserNode.connect).toHaveBeenCalledExactlyOnceWith(delays[0]);
    });

    it('sweeps live and queued routes of a removed strip', () => {
        const { routing, setFallback } = createFixture();
        routing.wireRoute('src', 'dst', 'sc');
        setFallback(true);
        routing.wireRoute('a', 'b', 'removed-device');
        routing.wireRoute('a', 'b', 'kept');
        setFallback(false);

        routing.forgetPendingRoutesOf('elsewhere', new Set(['removed-device']));
        routing.removeConnectionsOf('elsewhere', new Set(['sc']));

        expect(Array.from(routing.pendingRoutes.keys())).toEqual(['a→kept']);
        expect(routing.connectionCount()).toBe(0);
    });

    it('forgets queued routes sourced from or targeting the removed track and keeps an unrelated one', () => {
        const { routing, setFallback } = createFixture();
        setFallback(true);
        routing.wireRoute('gone', 'b', 'd1');
        routing.wireRoute('a', 'gone', 'd2');
        routing.wireRoute('a', 'b', 'd3');

        routing.forgetPendingRoutesOf('gone', new Set());

        expect(Array.from(routing.pendingRoutes.keys())).toEqual(['a→d3']);
    });

    it('removes a live route sourced from the removed track', () => {
        const { routing, gains, delays, sourceTap } = createFixture();
        routing.wireRoute('src', 'dst', 'sc');

        routing.removeConnectionsOf('src', new Set());

        expect(routing.connectionCount()).toBe(0);
        expect(sourceTap.disconnect).toHaveBeenCalledExactlyOnceWith(delays[0]);
        expect(gains[0]?.disconnect).toHaveBeenCalledTimes(1);
    });

    it('re-attaches only the keys the rebuilt track feeds', () => {
        const { routing, delays, sourceTap, strips } = createFixture();
        const other = createStrip();
        strips.set('src2', other.strip);
        routing.wireRoute('src', 'dst', 'sc');
        routing.wireRoute('src2', 'dst', 'sc');
        const rebuilt = createStrip();

        routing.reconnectTrack('src', rebuilt.strip);

        expect(sourceTap.disconnect).toHaveBeenCalledExactlyOnceWith(delays[0]);
        expect(rebuilt.analyserNode.connect).toHaveBeenCalledExactlyOnceWith(delays[0]);
        expect(other.analyserNode.disconnect).not.toHaveBeenCalled();
    });

    it('returns three disconnect effects per live route and clears both maps', () => {
        const { routing, gains, delays, setFallback } = createFixture();
        routing.wireRoute('src', 'dst', 'sc');
        setFallback(true);
        routing.wireRoute('a', 'b', 'c');

        const effects = routing.resetEffects();
        for (const effect of effects) {
            effect();
        }
        routing.clear();

        expect(effects).toHaveLength(3);
        expect(delays[0]?.disconnect).toHaveBeenCalledTimes(1);
        expect(gains[0]?.disconnect).toHaveBeenCalledTimes(1);
        expect(routing.connectionCount()).toBe(0);
        expect(routing.pendingRoutes.size).toBe(0);
    });
});
