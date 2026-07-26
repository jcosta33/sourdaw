import { logger } from '#/infra/logger/appLogger';

import { getAudioDeviceRuntimeSink } from '../../engine/audioDeviceRuntimeSink';
import { type Device } from '../../models/TrackViewTypes';
import { type OfflineDeviceNode } from '../devices/types';

import {
    type AudioDeviceStrategy,
    type OfflineAutomationBinding,
    type OfflineAutomationSegment,
} from './AudioDeviceStrategy';
import { NATIVE_DSP_DEVICE_FACTORIES, type NativeDspNode } from './nativeDspDeviceFactories';

/** How long one device's offline setup may run before it is abandoned. */
const OFFLINE_INSTRUMENT_SETUP_TIMEOUT_MS = 30_000;

export class NativeDspDeviceStrategy implements AudioDeviceStrategy {
    public readonly node: OfflineDeviceNode;
    public readonly acceptsScheduledParam?: (name: string) => boolean;
    public readonly scheduleParam?: (name: string, segments: readonly OfflineAutomationSegment[]) => void;

    constructor(private readonly dspNode: NativeDspNode) {
        this.node = {
            inputNode: dspNode.workletNode,
            outputNode: dspNode.workletNode,
            nodes: [dspNode.workletNode],
        };
        const scheduleParam = dspNode.scheduleParam;
        const acceptsScheduledParam = dspNode.acceptsScheduledParam;
        if (scheduleParam && acceptsScheduledParam) {
            this.acceptsScheduledParam = (name) => acceptsScheduledParam(name);
            this.scheduleParam = (name, segments) => scheduleParam(name, segments);
        }
    }

    setParam(name: string, value: number): void {
        this.dspNode.setParam?.(name, value);
    }

    resolveOfflineAutomation(parameterId: string): OfflineAutomationBinding | null {
        const schedule = this.scheduleParam;
        if (!schedule || this.acceptsScheduledParam?.(parameterId) !== true) {
            return null;
        }
        return { kind: 'segments', apply: (segments) => schedule(parameterId, segments) };
    }

    setBypass(bypassed: boolean): void {
        this.dspNode.setBypass?.(bypassed);
    }

    noteOn(noteOrPad: number, velocity: number, midiNote?: number, sampleFrame?: number): void {
        this.dspNode.noteOn?.(noteOrPad, velocity, midiNote, sampleFrame);
    }

    noteOff(noteOrPad: number, sampleFrame?: number): void {
        this.dspNode.noteOff?.(noteOrPad, sampleFrame);
    }

    connectPadOutput(pad: number, destination: AudioNode): void {
        this.dspNode.connectPadOutput?.(pad, destination);
    }

    disconnectPadOutput(pad: number, destination: AudioNode): void {
        this.dspNode.disconnectPadOutput?.(pad, destination);
    }

    setPadDryRouted(pad: number, routed: boolean): void {
        this.dspNode.setPadDryRouted?.(pad, routed);
    }

    destroy(): void {
        this.dspNode.destroy?.();
    }
}

export async function createNativeDspStrategy(ctx: BaseAudioContext, device: Device): Promise<NativeDspDeviceStrategy> {
    const factory = NATIVE_DSP_DEVICE_FACTORIES.find((candidate) => candidate.matches(device.type));
    const result = factory ? await factory.create(ctx) : null;

    if (!result) {
        throw new Error(`Failed to create Native DSP device: ${device.type}`);
    }

    await result.ready;

    const strategy = new NativeDspDeviceStrategy(result);
    for (const [key, val] of Object.entries(device.parameterValues)) {
        strategy.setParam(key, val);
    }

    // `parameterValues` is only the numeric half of a device's state. Every
    // instrument whose live descriptor does setup beyond plain params — Levain's
    // sample zones, Toaster's kit — got none of it here, because this path and the
    // live `wasmDeviceRegistry` are two registries, not one builder with a flag.
    // Levain consequently exported silence. Awaiting this is the point: an offline
    // context renders faster than real time, so a load that is merely started never
    // lands.
    await prepareOfflineInstrumentSafely(device, result);

    return strategy;
}

/**
 * Run a device's offline setup under a deadline and the export's cancel flag, and
 * never let its failure remove the device from the chain.
 *
 * Both halves are load-bearing.
 *
 * The deadline exists because nothing below here was cancellable: the sample fetch
 * was a bare `await`, `renderWithTimeout` only guards `startRendering` much later,
 * and `renderOffline` releases the render lock in a `finally`. A response that
 * never settles therefore never released the lock, and every subsequent export —
 * mixdown or stems, both take the same lock — failed with "an export is already in
 * progress" until the app was reloaded. A stalled network now ends the load
 * instead of bricking exporting.
 *
 * The deadline is a backstop, not cancellation. Pressing cancel during a load
 * still does nothing, because this layer may not read the export's cancel flag —
 * that state lives in `useCases`, and repositories may not import it. Making
 * cancel work means threading an `AbortSignal` from `renderOffline` down through
 * `buildDeviceChain` into `createDevice`, which is a separate change.
 *
 * The catch exists because throwing here is worse than failing. An exception
 * propagates to `buildDeviceChain`, which logs and skips the device; the track
 * then reaches `scheduleTrackClips` with no instrument controls and falls through
 * to the default synth params — a sawtooth lead at 0.3 gain, bounced where an
 * orchestral part belongs, while the export reports success. Degrading to an
 * unconfigured-but-present node means the track renders silent, which is a symptom
 * a user reports rather than one they ship. Silence is recoverable; a plausible
 * wrong instrument is not.
 */
async function prepareOfflineInstrumentSafely(device: Device, node: NativeDspNode): Promise<void> {
    const controller = new AbortController();
    const deadline = setTimeout(() => {
        controller.abort();
    }, OFFLINE_INSTRUMENT_SETUP_TIMEOUT_MS);
    try {
        await getAudioDeviceRuntimeSink().prepareOfflineInstrument({
            deviceId: device.id,
            deviceType: device.type,
            port: node.workletNode.port,
            signal: controller.signal,
        });
    } catch (error) {
        // Deliberately swallowed: see why above. The node stays in the chain.
        logger.warn(
            `Offline setup failed for ${device.type} (${device.id}); it will render silent rather than be replaced: ${String(error)}`
        );
    } finally {
        clearTimeout(deadline);
    }
}
