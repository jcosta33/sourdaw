import { logger } from '#/infra/logger/appLogger';
import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';
import { hasSharedArrayBuffer } from '#/utils/capabilities';

import type { ControlRoomMonitoring } from '../../models/AudioEngineState';

/** Inert stand-in for the master meter on the fallback (no-AudioContext) graph. */
export type NoopMeterNode = {
    connect(): void;
    disconnect(): void;
    port: { postMessage(message: unknown): void };
};

export type MasterMeterNode = AudioWorkletNode | NoopMeterNode;

type MasterNodes = Readonly<{
    gainNode: GainNode;
    analyser: AnalyserNode;
    /**
     * Stereo analysis tap: {@link analyser}'s pass-through output fans out
     * through `stereoSplitter` into one analyser per channel. Kept off
     * `gainNode` deliberately — {@link MasterSection.wireMeter} disconnects
     * `gainNode` wholesale on every (re-)initialize, which would drop a tap
     * rooted there. Rooting on `analyser` instead survives that rewiring
     * untouched.
     */
    stereoSplitter: ChannelSplitterNode;
    analyserLeft: AnalyserNode;
    analyserRight: AnalyserNode;
    /**
     * Silent (gain 0) sink the stereo tap analysers connect through to the
     * destination. Web Audio only pulls nodes with a path to the destination,
     * so a dead-end analyser branch never processes a render quantum — routing
     * it through a zero-gain node keeps it live without adding anything to the
     * audible mix.
     */
    stereoTapSink: GainNode;
    /**
     * The control-room listening insert, sitting strictly downstream of the
     * programme: `analyser` (and through it the fader, the master meter and
     * the stereo analysis tap) carries the mix itself, so a monitoring gesture
     * changes what the musician hears and nothing an export, an offline render
     * or a meter reads. `monitorMonoNode` folds the feed to mono by the Web
     * Audio channel-count idiom — an explicit single-channel count downmixes
     * stereo per the speakers interpretation, (L+R)/2, and the mono result
     * upmixes back onto both output channels; 'max' returns it to pass-through.
     * `monitorDimNode` is the dim attenuation.
     */
    monitorMonoNode: GainNode;
    monitorDimNode: GainNode;
    /**
     * The programme reaches the listening output through this edge, and its
     * connection is the exclusive-preview gate. A gain write made now cannot
     * reach the frame `currentTime` names when its quotient sits above that
     * frame (Chromium clamps it to `currentTime` and applies it a sample late),
     * whereas a disconnect or connect takes effect from the first frame of the
     * next render quantum, suspended or running.
     */
    previewProgrammeGate: GainNode;
}>;

export type MasterSection = MasterNodes & {
    /** The master meter tap: `undefined` until wired and after disposal; the inert stand-in on the fallback graph. */
    meterNode(): MasterMeterNode | undefined;
    wireMeter(): void;
    setGain(value: number): void;
    getGain(): number;
    setControlRoomMonitoring(monitoring: ControlRoomMonitoring): void;
    readPeak(): number | null;
    /** One effect per master resource, in teardown order. */
    disposeEffects(): Array<() => void>;
    postShutdown(message: { type: 'shutdown' }): void;
};

export type MasterSectionPorts = Readonly<{
    context: AudioContext;
    /** `fallback` builds the inert graph on the no-op context: gain 0 and a no-op meter that never reports a peak. */
    mode: 'live' | 'fallback';
}>;

function buildLiveNodes(context: AudioContext): MasterNodes {
    const gainNode = context.createGain();
    gainNode.gain.value = 0.8;

    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    const monitorMonoNode = context.createGain();
    const monitorDimNode = context.createGain();
    const previewProgrammeGate = context.createGain();

    gainNode.connect(analyser);
    // The listening leg runs through the control-room insert; the
    // programme (everything upstream of this edge) stays untouched by it.
    analyser.connect(previewProgrammeGate);
    previewProgrammeGate.connect(monitorMonoNode);
    monitorMonoNode.connect(monitorDimNode);
    monitorDimNode.connect(context.destination);

    // Genuine stereo tap: branch off the analyser's pass-through output
    // (it forwards audio unchanged; only its own analysis reads are
    // down-mixed to mono) into a ChannelSplitterNode(2), then one analyser
    // per channel. Route both through a silent sink to the destination so
    // they are pulled every render quantum without touching the mix.
    const stereoSplitter = context.createChannelSplitter(2);
    const analyserLeft = context.createAnalyser();
    analyserLeft.fftSize = 256;
    const analyserRight = context.createAnalyser();
    analyserRight.fftSize = 256;
    const stereoTapSink = context.createGain();
    stereoTapSink.gain.value = 0;

    analyser.connect(stereoSplitter);
    stereoSplitter.connect(analyserLeft, 0);
    stereoSplitter.connect(analyserRight, 1);
    analyserLeft.connect(stereoTapSink);
    analyserRight.connect(stereoTapSink);
    stereoTapSink.connect(context.destination);

    return {
        gainNode,
        analyser,
        stereoSplitter,
        analyserLeft,
        analyserRight,
        stereoTapSink,
        monitorMonoNode,
        monitorDimNode,
        previewProgrammeGate,
    };
}

function buildFallbackNodes(context: AudioContext): MasterNodes {
    const gainNode = context.createGain();
    gainNode.gain.value = 0;
    const monitorMonoNode = context.createGain();
    const monitorDimNode = context.createGain();
    const previewProgrammeGate = context.createGain();
    return {
        gainNode,
        monitorMonoNode,
        monitorDimNode,
        previewProgrammeGate,
        analyser: context.createAnalyser(),
        stereoSplitter: context.createChannelSplitter(2),
        analyserLeft: context.createAnalyser(),
        analyserRight: context.createAnalyser(),
        stereoTapSink: context.createGain(),
    };
}

function createNoopMeterNode(): NoopMeterNode {
    return {
        connect: () => {},
        disconnect: () => {},
        port: { postMessage: () => {} },
    };
}

function isWorkletMeter(meter: MasterMeterNode | undefined): meter is AudioWorkletNode {
    return typeof AudioWorkletNode !== 'undefined' && meter instanceof AudioWorkletNode;
}

export function createMasterSection({ context, mode }: MasterSectionPorts): MasterSection {
    const nodes = mode === 'live' ? buildLiveNodes(context) : buildFallbackNodes(context);
    const { gainNode, analyser, monitorMonoNode, monitorDimNode } = nodes;
    let meterNode: MasterMeterNode | undefined = mode === 'live' ? undefined : createNoopMeterNode();
    /**
     * View onto the master metering-processor's SAB, or `null` when no meter tap
     * is wired (before initialize(), after a failed initialize(), after dispose(),
     * in fallback mode, or without AudioWorklet/SharedArrayBuffer). `null` is load
     * bearing: {@link readPeak} returns it verbatim so callers can tell
     * "no measurement" apart from "measured silence". It must never be an inert
     * buffer nothing writes — that reads back as a plausible 0.
     */
    let meterBuffer: Float32Array | null = null;

    /**
     * Insert a SAB-backed metering-processor into the master chain so
     * readPeak reflects real output level. Mirrors the per-track meter
     * wiring in TrackNode: a 4-byte SharedArrayBuffer holds one peak the
     * worklet writes (Math.max across the block) and the UI read-and-resets.
     *
     * Chain before: gainNode → analyser → destination.
     * Chain after:  gainNode → meterNode → analyser → destination.
     * The metering-processor passes audio straight through, so the audible signal
     * is unchanged — it only taps the peak. Idempotent: a second initialize()
     * (e.g. after dispose()) replaces the existing meter node rather than
     * stacking a second tap.
     *
     * Fallback mode is deliberately *not* tested here. initialize() returns
     * early on fallback, before loadWorklets() — the sole caller — so the
     * disjunct could only ever evaluate false. Fallback reaches the same
     * verdict by construction instead: the fallback build never assigns the
     * meter buffer, so it stays null and readPeak reports unavailable.
     */
    function wireMeter(): void {
        if (typeof AudioWorkletNode === 'undefined' || !hasSharedArrayBuffer()) {
            // No worklet support or no SAB: there is no tap to read. Clear the
            // buffer so readPeak reports `null` ("unavailable") rather than a
            // fabricated 0 — which the status bar renders as "-∞ dB",
            // indistinguishable from a silent mix while audio is playing
            // (ADR 0012: a downgrade must never be silent).
            meterBuffer = null;
            logger.warn(
                '[audio-engine] master meter not wired ' +
                    `(AudioWorkletNode=${String(typeof AudioWorkletNode !== 'undefined')}, ` +
                    `SharedArrayBuffer=${String(hasSharedArrayBuffer())}) — ` +
                    'the master level readout reports unavailable until it is.'
            );
            return;
        }
        // Tear down a previously-wired meter node so a re-initialize does not
        // leave a stale tap summing into the analyser.
        const previous = meterNode;
        if (isWorkletMeter(previous)) {
            try {
                previous.disconnect();
            } catch {
                // already disconnected
            }
        }

        const meterSab = new SharedArrayBuffer(4);
        const next = new AudioWorkletNode(context, 'metering-processor');
        next.port.postMessage({ type: 'init', sab: meterSab });
        meterNode = next;
        meterBuffer = new Float32Array(meterSab);

        // Re-route the master chain through the meter node.
        gainNode.disconnect();
        gainNode.connect(next);
        next.connect(analyser);
    }

    function setControlRoomMonitoring(monitoring: ControlRoomMonitoring): void {
        if (monitoring.monoActive) {
            // Explicit single-channel count + speakers interpretation is the
            // spec's (L+R)/2 fold; the mono result upmixes onto both outputs.
            monitorMonoNode.channelCount = 1;
            monitorMonoNode.channelCountMode = 'explicit';
            monitorMonoNode.channelInterpretation = 'speakers';
        } else {
            monitorMonoNode.channelCountMode = 'max';
        }
        monitorDimNode.gain.setTargetAtTime(Math.max(0, monitoring.dimGain), context.currentTime, 0.01);
    }

    function readPeak(): number | null {
        if (!meterBuffer) {
            return null;
        }
        // Read-and-reset of a single f32, deliberately without Atomics (audit
        // RT-9) — same scalar-meter exception as TrackNode.getPeakLevel.
        // Rationale in the module header of worklets/meteringProcessor.ts.
        const peak = meterBuffer[0]!;
        meterBuffer[0] = 0;
        return peak;
    }

    function disposeEffects(): Array<() => void> {
        return [
            () => gainNode.disconnect(),
            () => {
                const meter = meterNode;
                meterNode = undefined;
                meterBuffer = null;
                if (isWorkletMeter(meter)) {
                    meter.disconnect();
                }
            },
            () => analyser.disconnect(),
            () => nodes.previewProgrammeGate.disconnect(),
            () => monitorMonoNode.disconnect(),
            () => monitorDimNode.disconnect(),
            () => nodes.stereoSplitter.disconnect(),
            () => nodes.analyserLeft.disconnect(),
            () => nodes.analyserRight.disconnect(),
            () => nodes.stereoTapSink.disconnect(),
        ];
    }

    return {
        ...nodes,
        meterNode: () => meterNode,
        wireMeter,
        setGain: (value) => {
            gainNode.gain.setTargetAtTime(Math.max(0, Math.min(FADER_MAX_GAIN, value)), context.currentTime, 0.01);
        },
        getGain: () => gainNode.gain.value,
        setControlRoomMonitoring,
        readPeak,
        disposeEffects,
        postShutdown: (message) => {
            if (isWorkletMeter(meterNode)) {
                meterNode.port.postMessage(message);
            }
        },
    };
}
