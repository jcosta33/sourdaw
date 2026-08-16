import { logger } from '#/infra/logger/appLogger';

import { type DeviceRuntimeOfflineFacts } from '../../models/BuiltinDeviceRuntime';
import { type Device } from '../../models/TrackViewTypes';
import { type OfflineDeviceNode } from '../devices/types';

import {
    type AudioDeviceStrategy,
    type DeviceNoteOffRequest,
    type DeviceNoteOnRequest,
    type OfflineAutomationBinding,
} from './AudioDeviceStrategy';

type FaustNodeLike = AudioNode & {
    setParamValue(name: string, value: number): void;
    // A Faust AudioWorkletNode exposes each DSP parameter as a real AudioParam,
    // keyed by its full Faust address (e.g. `/dsp/cutoff`).
    parameters?: ReadonlyMap<string, AudioParam>;
};

/**
 * Map each parameter's bare name (the automation lane's parameterId) to its
 * full Faust address, so `resolveOfflineAutomation` can reach the AudioParam
 * that `node.parameters` keys by address. Mirrors the live factory's cache.
 */
function buildFaustParamAddressCache(parameters: ReadonlyMap<string, AudioParam> | undefined): Map<string, string> {
    const cache = new Map<string, string>();
    if (!parameters) {
        return cache;
    }
    for (const [key] of parameters) {
        const bareName = key.split('/').pop();
        if (!bareName) {
            continue;
        }
        const existing = cache.get(bareName);
        if (existing !== undefined) {
            // Parity with the live factory cache: keep the first address for an
            // ambiguous bare name and warn rather than silently shadowing it.
            logger.warn(`[Faust] Duplicate bare param "${bareName}" — keeping "${existing}", ignoring "${key}"`);
            continue;
        }
        cache.set(bareName, key);
    }
    return cache;
}

type FaustDeviceCreator = (input: {
    ctx: BaseAudioContext;
    faustModuleId: string;
}) => Promise<OfflineDeviceNode | null>;

export const FAUST_OFFLINE_RUNTIME: DeviceRuntimeOfflineFacts = {
    source: 'AudioEngine.faustDeviceStrategy',
    availability: 'conditional',
    condition: 'Requires the exact registered Faust module and an offline compiler factory that resolves it.',
};

/** Where a note goes when the request names no MPE member channel. */
const FAUST_BASE_CHANNEL = 0;

export class FaustDeviceStrategy implements AudioDeviceStrategy {
    private readonly paramAddressCache: Map<string, string>;

    constructor(
        public readonly node: OfflineDeviceNode,
        private readonly faustNode: FaustNodeLike,
        /**
         * Whether this module is a Faust *instrument*, as recorded by
         * `registerFaustDSP`. Not derived from the `faust-` id prefix (every
         * Faust module carries it) and not from the presence of
         * `wamControls.keyOn` (the factory always defines that wrapper, which
         * then checks the node inside). The flag is the only honest signal.
         */
        public readonly acceptsNotes: boolean,
        /** Needed to turn the scheduler's sample frame into the seconds Faust wants. */
        private readonly sampleRate: number
    ) {
        this.paramAddressCache = buildFaustParamAddressCache(faustNode.parameters);
    }

    /**
     * Voice a note offline through the same control surface the live descriptor
     * wires (`wamControls.keyOn`), which `createFaustDevice` already backs with
     * an `OfflineAudioContext`-aware scheduler that batches each sample frame
     * behind one `ctx.suspend`. Until this existed, a Faust instrument's chain
     * entry carried no note surface, `scheduleTrackClips` read the track as
     * having no instrument, and the part bounced as the builtin fallback synth
     * — a sawtooth at 0.3 gain — while playing correctly in the session.
     */
    noteOn({ noteOrPad, velocity, sampleFrame, channel }: DeviceNoteOnRequest): void {
        this.node.wamControls?.keyOn?.(channel ?? FAUST_BASE_CHANNEL, noteOrPad, velocity, this.toSeconds(sampleFrame));
    }

    noteOff({ noteOrPad, sampleFrame }: DeviceNoteOffRequest): void {
        // Faust's `keyOff` takes a release velocity in slot 3. Offline note-offs
        // carry none, and the poly voice allocator only needs the note released,
        // so it goes out at zero.
        this.node.wamControls?.keyOff?.(FAUST_BASE_CHANNEL, noteOrPad, 0, this.toSeconds(sampleFrame));
    }

    /** `undefined` means "as soon as possible", which the Faust scheduler honours. */
    private toSeconds(sampleFrame: number | undefined): number | undefined {
        if (sampleFrame === undefined) {
            return undefined;
        }
        return sampleFrame / this.sampleRate;
    }

    setParam(name: string, value: number): void {
        try {
            this.faustNode.setParamValue(name, value);
        } catch (error) {
            logger.warn(`[Faust] Failed to set param ${name} to ${value}:`, error);
        }
    }

    resolveOfflineAutomation(parameterId: string): OfflineAutomationBinding | null {
        const parameters = this.faustNode.parameters;
        if (!parameters) {
            return null;
        }
        const address = parameters.has(parameterId) ? parameterId : this.paramAddressCache.get(parameterId);
        const audioParam = address === undefined ? undefined : parameters.get(address);
        if (!audioParam) {
            return null;
        }
        return { kind: 'audioParam', targets: [{ audioParam, scale: 1, offset: 0 }] };
    }
}

type CreateFaustStrategyInput = {
    ctx: BaseAudioContext;
    device: Device;
    createFaustDevice: FaustDeviceCreator;
    /** `isFaustInstrumentModule`, injected so this repository stays off the PluginHost barrel. */
    isFaustInstrument: (moduleId: string) => boolean;
};

export async function createFaustStrategy({
    ctx,
    device,
    createFaustDevice,
    isFaustInstrument,
}: CreateFaustStrategyInput): Promise<FaustDeviceStrategy> {
    const node = await createFaustDevice({ ctx, faustModuleId: device.type });
    if (!node) {
        throw new Error(`Failed to create Faust device: ${device.type}`);
    }

    const faustNode = node.nodes[0] as FaustNodeLike;
    const strategy = new FaustDeviceStrategy(node, faustNode, isFaustInstrument(device.type), ctx.sampleRate);

    // Apply initial params
    for (const [key, val] of Object.entries(device.parameterValues)) {
        strategy.setParam(key, val);
    }

    return strategy;
}
