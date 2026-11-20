import type { BusStrip, SendNode, TrackChannelStrip } from '../../models/AudioEngineState';

/**
 * Equal-time crossfade duration (seconds) for a live pre/post-fader send-tap
 * handoff. The old tap's send gain ramps to 0 while a freshly-built gain on the
 * new tap ramps up over the same window, so the bus never sees the block of
 * silence a hard disconnect/reconnect produced. ~10ms is short enough to feel
 * instant yet long enough to span a render quantum at any sample rate.
 */
const SEND_TAP_CROSSFADE_SECONDS = 0.01;

/** Extra margin (seconds) before the faded-out old send node is disconnected. */
const SEND_TAP_CROSSFADE_TEARDOWN_MARGIN_SECONDS = 0.02;

export type SendRouting = {
    /** The live send map, keyed `${sourceTrackId}→${busId}`. */
    readonly sendNodes: Map<string, SendNode>;
    setSend(sourceTrackId: string, busId: string, level: number, preFader: boolean): void;
    scheduleSendAutomation(sourceTrackId: string, busId: string, level: number, time: number): void;
    crossfadeSendTap(existing: SendNode, busStrip: BusStrip, preFader: boolean, clampedLevel: number): void;
    removeSend(sourceTrackId: string, busId: string): void;
    sendsForTrack(sourceTrackId: string): SendNode[];
    /** Re-attaches every send of the track to the matching tap of its rebuilt strip. */
    reconnectTrack(trackId: string, strip: TrackChannelStrip): void;
    /** Removes every send fed by the track, inside an enclosing graph mutation. */
    removeSendsFromTrack(sourceTrackId: string): void;
    /** Removes every send feeding the bus, inside an enclosing graph mutation. */
    removeSendsToBus(busId: string): void;
    /** One teardown effect per send live when called, for the graph reset's effect list. */
    resetEffects(): Array<() => void>;
    clear(): void;
};

export type SendRoutingPorts = Readonly<{
    readContext: () => AudioContext;
    isFallback: () => boolean;
    /** The live strip of a track, read per call. */
    readTrackStrip: (trackId: string) => TrackChannelStrip | undefined;
    /** Ensures the destination bus strip and reports whether that changed the live graph. */
    ensureBusStrip: (busId: string) => Readonly<{ value: BusStrip; changed: boolean }>;
    scheduleTrackSendAutomation: (sourceTrackId: string, busId: string, level: number, time: number) => void;
    /** Publishes one runtime-graph generation when the mutation reports a material change. */
    mutateRuntimeGraph: (mutation: () => boolean) => void;
}>;

function sendTap(strip: TrackChannelStrip, preFader: boolean): GainNode {
    if (preFader) {
        return strip.preFaderSendGate;
    }
    return strip.carrierGate;
}

type SendGraphPorts = Pick<SendRoutingPorts, 'readContext' | 'readTrackStrip'>;

type SendApplyState = SendGraphPorts &
    Pick<SendRoutingPorts, 'ensureBusStrip'> & { readonly sendNodes: Map<string, SendNode> };

/**
 * Switch a live send between the pre- and post-fader tap without a gap of
 * silence on the bus. A hard `disconnect()` then `connect()` left the bus with
 * no input for one render quantum (~2.7ms at 48k) — audible on a pumping bus.
 * Instead we build a fresh gain on the new tap and equal-time-crossfade: the
 * new gain ramps 0→level while the old gain ramps level→0 over the same
 * window, so the bus is continuously fed. After the ramp the old node is torn
 * down. The teardown is deferred on the control thread (`setTimeout`), never
 * on the audio thread, so the RT graph is untouched by the cleanup.
 */
function crossfadeSendTap(
    { readContext, readTrackStrip }: SendGraphPorts,
    existing: SendNode,
    busStrip: BusStrip,
    preFader: boolean,
    clampedLevel: number
): void {
    const now = readContext().currentTime;
    const end = now + SEND_TAP_CROSSFADE_SECONDS;

    const sourceStrip = readTrackStrip(existing.sourceTrackId);
    if (!sourceStrip) {
        return;
    }
    const newTap = sendTap(sourceStrip, preFader);
    const newGain = readContext().createGain();
    newGain.gain.setValueAtTime(0, now);
    newGain.gain.linearRampToValueAtTime(clampedLevel, end);
    newTap.connect(newGain);
    newGain.connect(busStrip.gainNode);

    // Ramp the outgoing gain to silence over the same window. Pin its current
    // value first so the ramp starts from where it is, not from a stale
    // scheduled value.
    const oldGain = existing.gainNode;
    const oldSource = existing.sourceNode;
    oldGain.gain.cancelScheduledValues(now);
    oldGain.gain.setValueAtTime(oldGain.gain.value, now);
    oldGain.gain.linearRampToValueAtTime(0, end);

    // Promote the new node to the live send and tear the old one down after
    // the crossfade completes (plus a small margin) on the control thread.
    existing.gainNode = newGain;
    existing.sourceNode = newTap;
    existing.preFader = preFader;
    const teardownMs = (SEND_TAP_CROSSFADE_SECONDS + SEND_TAP_CROSSFADE_TEARDOWN_MARGIN_SECONDS) * 1000;
    setTimeout(() => {
        try {
            oldSource.disconnect(oldGain);
        } catch {
            // The old source edge may already be gone after wider teardown.
        }
        try {
            oldGain.disconnect();
        } catch {
            // removeSend or resetGraph may already have torn down the gain.
        }
    }, teardownMs);
}

function applySend(
    state: SendApplyState,
    sourceTrackId: string,
    busId: string,
    level: number,
    preFader: boolean
): boolean {
    const { readContext, readTrackStrip, ensureBusStrip, sendNodes } = state;
    const strip = readTrackStrip(sourceTrackId);
    if (!strip) {
        return false;
    }
    const busMutation = ensureBusStrip(busId);
    const key = `${sourceTrackId}→${busId}`;
    const clampedLevel = Math.max(0, Math.min(1, level));
    const existing = sendNodes.get(key);
    if (existing) {
        if (existing.preFader !== preFader) {
            crossfadeSendTap(state, existing, busMutation.value, preFader, clampedLevel);
            return true;
        }
        existing.gainNode.gain.setTargetAtTime(clampedLevel, readContext().currentTime, 0.01);
        return busMutation.changed;
    }

    const sendGain = readContext().createGain();
    sendGain.gain.value = clampedLevel;
    const tap = sendTap(strip, preFader);
    tap.connect(sendGain);
    sendGain.connect(busMutation.value.gainNode);
    sendNodes.set(key, { sourceTrackId, busId, gainNode: sendGain, sourceNode: tap, preFader });
    return true;
}

function removeSendFromGraph(sendNodes: Map<string, SendNode>, sourceTrackId: string, busId: string): boolean {
    const key = `${sourceTrackId}→${busId}`;
    const send = sendNodes.get(key);
    if (!send) {
        return false;
    }
    try {
        send.sourceNode.disconnect(send.gainNode);
    } catch {
        // The source edge may already be gone after a graph rebuild.
    }
    send.gainNode.disconnect();
    sendNodes.delete(key);
    return true;
}

function reconnectSendsOfTrack(sendNodes: Map<string, SendNode>, trackId: string, strip: TrackChannelStrip): void {
    for (const send of sendNodes.values()) {
        if (send.sourceTrackId !== trackId) {
            continue;
        }
        const sourceNode = sendTap(strip, send.preFader);
        try {
            send.sourceNode.disconnect(send.gainNode);
        } catch {
            // A wider rebuild may already have removed the prior source edge.
        }
        sourceNode.connect(send.gainNode);
        send.sourceNode = sourceNode;
    }
}

export function createSendRouting(ports: SendRoutingPorts): SendRouting {
    const { isFallback, scheduleTrackSendAutomation, mutateRuntimeGraph } = ports;
    const sendNodes = new Map<string, SendNode>();
    const state: SendApplyState = {
        readContext: ports.readContext,
        readTrackStrip: ports.readTrackStrip,
        ensureBusStrip: ports.ensureBusStrip,
        sendNodes,
    };

    function setSend(sourceTrackId: string, busId: string, level: number, preFader: boolean): void {
        if (isFallback()) {
            return;
        }
        mutateRuntimeGraph(() => applySend(state, sourceTrackId, busId, level, preFader));
    }

    function scheduleSendAutomation(sourceTrackId: string, busId: string, level: number, time: number): void {
        if (isFallback()) {
            return;
        }
        scheduleTrackSendAutomation(sourceTrackId, busId, level, time);
    }

    function removeSendsWhere(matches: (send: SendNode) => boolean): void {
        for (const send of Array.from(sendNodes.values())) {
            if (matches(send)) {
                removeSendFromGraph(sendNodes, send.sourceTrackId, send.busId);
            }
        }
    }

    return {
        sendNodes,
        setSend,
        scheduleSendAutomation,
        crossfadeSendTap: (existing, busStrip, preFader, clampedLevel) => {
            crossfadeSendTap(state, existing, busStrip, preFader, clampedLevel);
        },
        removeSend: (sourceTrackId, busId) =>
            mutateRuntimeGraph(() => removeSendFromGraph(sendNodes, sourceTrackId, busId)),
        sendsForTrack: (sourceTrackId) =>
            Array.from(sendNodes.values()).filter((send) => send.sourceTrackId === sourceTrackId),
        reconnectTrack: (trackId, strip) => {
            reconnectSendsOfTrack(sendNodes, trackId, strip);
        },
        removeSendsFromTrack: (sourceTrackId) => {
            removeSendsWhere((send) => send.sourceTrackId === sourceTrackId);
        },
        removeSendsToBus: (busId) => {
            removeSendsWhere((send) => send.busId === busId);
        },
        resetEffects: () =>
            Array.from(sendNodes.values(), (send) => () => {
                removeSendFromGraph(sendNodes, send.sourceTrackId, send.busId);
            }),
        clear: () => sendNodes.clear(),
    };
}
