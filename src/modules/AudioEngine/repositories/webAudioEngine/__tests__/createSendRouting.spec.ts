import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSendRouting, type SendRoutingPorts } from '../createSendRouting';

import type { BusStrip, SendNode, TrackChannelStrip } from '../../../models/AudioEngineState';

type FakeGain = {
    gain: {
        value: number;
        setTargetAtTime: ReturnType<typeof vi.fn>;
        setValueAtTime: ReturnType<typeof vi.fn>;
        linearRampToValueAtTime: ReturnType<typeof vi.fn>;
        cancelScheduledValues: ReturnType<typeof vi.fn>;
    };
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
};

function createFakeGain(): FakeGain {
    return {
        gain: {
            value: 1,
            setTargetAtTime: vi.fn(),
            setValueAtTime: vi.fn(),
            linearRampToValueAtTime: vi.fn(),
            cancelScheduledValues: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
    };
}

function createFixture(overrides: Partial<SendRoutingPorts> = {}) {
    const created: FakeGain[] = [];
    const context = {
        currentTime: 4,
        createGain: vi.fn(() => {
            const gain = createFakeGain();
            created.push(gain);
            return gain;
        }),
    };
    const preFaderSendGate = createFakeGain();
    const carrierGate = createFakeGain();
    const strip = { preFaderSendGate, carrierGate } as unknown as TrackChannelStrip;
    const busInput = createFakeGain();
    const bus = { gainNode: busInput } as unknown as BusStrip;
    const published: boolean[] = [];
    const ports: SendRoutingPorts = {
        readContext: () => context as unknown as AudioContext,
        isFallback: () => false,
        readTrackStrip: (trackId) => (trackId === 't1' ? strip : undefined),
        ensureBusStrip: () => ({ value: bus, changed: false }),
        scheduleTrackSendAutomation: vi.fn(),
        mutateRuntimeGraph: (mutation) => {
            published.push(mutation());
        },
        ...overrides,
    };
    return {
        routing: createSendRouting(ports),
        ports,
        context,
        created,
        preFaderSendGate,
        carrierGate,
        busInput,
        published,
    };
}

afterEach(() => {
    vi.useRealTimers();
});

describe('createSendRouting', () => {
    it('wires a post-fader send from the carrier tap into the bus input at the clamped level', () => {
        const { routing, created, carrierGate, preFaderSendGate, busInput, published } = createFixture();

        routing.setSend('t1', 'b1', 1.7, false);

        const [sendGain] = created;
        expect(sendGain?.gain.value).toBe(1);
        expect(carrierGate.connect).toHaveBeenCalledExactlyOnceWith(sendGain);
        expect(preFaderSendGate.connect).not.toHaveBeenCalled();
        expect(sendGain?.connect).toHaveBeenCalledExactlyOnceWith(busInput);
        expect(routing.sendNodes.get('t1→b1')).toMatchObject({ sourceNode: carrierGate, preFader: false });
        expect(published).toEqual([true]);
    });

    it('wires a pre-fader send from the pre-fader tap', () => {
        const { routing, created, preFaderSendGate } = createFixture();

        routing.setSend('t1', 'b1', 0.5, true);

        expect(preFaderSendGate.connect).toHaveBeenCalledExactlyOnceWith(created[0]);
        expect(created[0]?.gain.value).toBe(0.5);
    });

    it('glides an existing send to its new level and publishes only the bus change', () => {
        const { routing, created, published } = createFixture();
        routing.setSend('t1', 'b1', 0.5, false);

        routing.setSend('t1', 'b1', 0.25, false);

        expect(created).toHaveLength(1);
        expect(created[0]?.gain.setTargetAtTime).toHaveBeenCalledExactlyOnceWith(0.25, 4, 0.01);
        expect(published).toEqual([true, false]);
    });

    it('publishes nothing changed for a send whose source strip is absent', () => {
        const { routing, created, published } = createFixture();

        routing.setSend('missing', 'b1', 0.5, false);

        expect(created).toHaveLength(0);
        expect(routing.sendNodes.size).toBe(0);
        expect(published).toEqual([false]);
    });

    it('does nothing on the fallback graph', () => {
        const ensureBusStrip = vi.fn();
        const scheduleTrackSendAutomation = vi.fn();
        const { routing, published } = createFixture({
            isFallback: () => true,
            ensureBusStrip,
            scheduleTrackSendAutomation,
        });

        routing.setSend('t1', 'b1', 0.5, false);
        routing.scheduleSendAutomation('t1', 'b1', 0.5, 9);

        expect(published).toEqual([]);
        expect(ensureBusStrip).not.toHaveBeenCalled();
        expect(scheduleTrackSendAutomation).not.toHaveBeenCalled();
    });

    it('forwards send automation to the source track', () => {
        const { routing, ports } = createFixture();

        routing.scheduleSendAutomation('t1', 'b1', 0.5, 9);

        expect(ports.scheduleTrackSendAutomation).toHaveBeenCalledExactlyOnceWith('t1', 'b1', 0.5, 9);
    });

    it('crossfades a tap change over one window and tears the old gain down afterwards', () => {
        vi.useFakeTimers();
        const { routing, created, carrierGate, preFaderSendGate, busInput, published } = createFixture();
        routing.setSend('t1', 'b1', 0.5, false);
        const [oldGain] = created;

        routing.setSend('t1', 'b1', 0.8, true);

        const newGain = created[1];
        expect(newGain?.gain.setValueAtTime).toHaveBeenCalledExactlyOnceWith(0, 4);
        expect(newGain?.gain.linearRampToValueAtTime).toHaveBeenCalledExactlyOnceWith(0.8, 4.01);
        expect(preFaderSendGate.connect).toHaveBeenCalledExactlyOnceWith(newGain);
        expect(newGain?.connect).toHaveBeenCalledExactlyOnceWith(busInput);
        expect(oldGain?.gain.cancelScheduledValues).toHaveBeenCalledExactlyOnceWith(4);
        expect(oldGain?.gain.linearRampToValueAtTime).toHaveBeenCalledExactlyOnceWith(0, 4.01);
        expect(routing.sendNodes.get('t1→b1')).toMatchObject({ gainNode: newGain, preFader: true });
        expect(published).toEqual([true, true]);

        vi.advanceTimersByTime(29);
        expect(oldGain?.disconnect).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(carrierGate.disconnect).toHaveBeenCalledExactlyOnceWith(oldGain);
        expect(oldGain?.disconnect).toHaveBeenCalledTimes(1);
    });

    it('removes a send by disconnecting both of its edges', () => {
        const { routing, created, carrierGate, published } = createFixture();
        routing.setSend('t1', 'b1', 0.5, false);

        routing.removeSend('t1', 'b1');
        routing.removeSend('t1', 'b1');

        expect(carrierGate.disconnect).toHaveBeenCalledExactlyOnceWith(created[0]);
        expect(created[0]?.disconnect).toHaveBeenCalledTimes(1);
        expect(routing.sendNodes.size).toBe(0);
        expect(published).toEqual([true, true, false]);
    });

    it('re-attaches a send to the matching tap of a rebuilt strip', () => {
        const { routing, created, carrierGate } = createFixture();
        routing.setSend('t1', 'b1', 0.5, false);
        const rebuiltCarrier = createFakeGain();
        const rebuilt = {
            preFaderSendGate: createFakeGain(),
            carrierGate: rebuiltCarrier,
        } as unknown as TrackChannelStrip;

        routing.reconnectTrack('t1', rebuilt);

        expect(carrierGate.disconnect).toHaveBeenCalledExactlyOnceWith(created[0]);
        expect(rebuiltCarrier.connect).toHaveBeenCalledExactlyOnceWith(created[0]);
        expect(routing.sendNodes.get('t1→b1')?.sourceNode).toBe(rebuiltCarrier);
    });

    it('re-attaches a pre-fader send to the pre-fader tap of a rebuilt strip, not the carrier', () => {
        const { routing, created, preFaderSendGate } = createFixture();
        routing.setSend('t1', 'b1', 0.5, true);
        const rebuiltPreFader = createFakeGain();
        const rebuiltCarrier = createFakeGain();
        const rebuilt = {
            preFaderSendGate: rebuiltPreFader,
            carrierGate: rebuiltCarrier,
        } as unknown as TrackChannelStrip;

        routing.reconnectTrack('t1', rebuilt);

        expect(preFaderSendGate.disconnect).toHaveBeenCalledExactlyOnceWith(created[0]);
        expect(rebuiltPreFader.connect).toHaveBeenCalledExactlyOnceWith(created[0]);
        expect(rebuiltCarrier.connect).not.toHaveBeenCalled();
        expect(routing.sendNodes.get('t1→b1')?.sourceNode).toBe(rebuiltPreFader);
    });

    it('removes only the sends of the named source track', () => {
        const strip = {
            preFaderSendGate: createFakeGain(),
            carrierGate: createFakeGain(),
        } as unknown as TrackChannelStrip;
        const { routing } = createFixture({ readTrackStrip: () => strip });
        routing.setSend('t1', 'b1', 0.5, false);
        routing.setSend('t2', 'b1', 0.5, false);

        routing.removeSendsFromTrack('t1');

        expect(Array.from(routing.sendNodes.keys())).toEqual(['t2→b1']);
    });

    it('pins the outgoing gain at its live value before ramping it to silence', () => {
        const { routing, created } = createFixture();
        routing.setSend('t1', 'b1', 0.5, false);
        const [oldGain] = created;
        if (oldGain) {
            oldGain.gain.value = 0.3;
        }

        routing.setSend('t1', 'b1', 0.5, true);

        expect(oldGain?.gain.setValueAtTime).toHaveBeenCalledExactlyOnceWith(0.3, 4);
    });

    it('clamps a negative send level to silence', () => {
        const { routing, created } = createFixture();

        routing.setSend('t1', 'b1', -0.4, false);

        expect(created[0]?.gain.value).toBe(0);
    });

    it('changes nothing when a tap crossfade has no source strip', () => {
        vi.useFakeTimers();
        const { routing, created, busInput, context } = createFixture();
        const oldGain = createFakeGain();
        const oldSource = createFakeGain();
        const orphan = {
            sourceTrackId: 'missing',
            busId: 'b1',
            gainNode: oldGain,
            sourceNode: oldSource,
            preFader: false,
        } as unknown as SendNode;

        routing.crossfadeSendTap(orphan, { gainNode: busInput } as unknown as BusStrip, true, 0.5);
        vi.advanceTimersByTime(1000);

        expect(context.createGain).not.toHaveBeenCalled();
        expect(created).toHaveLength(0);
        expect(oldGain.gain.cancelScheduledValues).not.toHaveBeenCalled();
        expect(oldGain.disconnect).not.toHaveBeenCalled();
        expect(oldSource.disconnect).not.toHaveBeenCalled();
        expect(orphan).toMatchObject({ gainNode: oldGain, sourceNode: oldSource, preFader: false });
    });

    it('sweeps sends by source track and by bus', () => {
        const { routing } = createFixture();
        routing.setSend('t1', 'b1', 0.5, false);
        routing.setSend('t1', 'b2', 0.5, false);

        routing.removeSendsToBus('b2');
        expect(Array.from(routing.sendNodes.keys())).toEqual(['t1→b1']);

        routing.removeSendsFromTrack('t1');
        expect(routing.sendNodes.size).toBe(0);
    });

    it('returns one teardown effect per live send', () => {
        const { routing, created } = createFixture();
        routing.setSend('t1', 'b1', 0.5, false);
        routing.setSend('t1', 'b2', 0.5, false);

        const effects = routing.resetEffects();
        for (const effect of effects) {
            effect();
        }

        expect(effects).toHaveLength(2);
        expect(created.map((gain) => gain.disconnect.mock.calls.length)).toEqual([1, 1]);
        expect(routing.sendNodes.size).toBe(0);
    });
});
