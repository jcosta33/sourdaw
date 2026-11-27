import {
    GrinderTimedParameterControl,
    getGrinderContinuousParameterOrdinal,
    getGrinderTimedParameterName,
} from '../models/GrinderTimedParameterControl';
import { type RuntimeDeviceControlTarget } from '../models/RuntimeDeviceControl';
import {
    APPLY_GRINDER_PRESET_COMMAND,
    type RuntimeGrinderPreset,
    type RuntimeGrinderPresetInput,
} from '../models/RuntimeGrinderPreset';
import { compileRuntimeGrinderPreset } from '../services/compileRuntimeGrinderPreset';

const MAX_PENDING_PRESETS = 16;
const PRESET_REPLY_TIMEOUT_MS = 5_000;

type PendingPreset = {
    readonly patch: RuntimeGrinderPreset;
    readonly rateNames: readonly string[];
    readonly resolve: () => void;
    readonly reject: (error: Error) => void;
    readonly timeout: ReturnType<typeof setTimeout>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function matchesPresetReply(data: Record<string, unknown>, patch: RuntimeGrinderPreset): boolean {
    const { target, correlation } = data;
    return (
        data.schemaVersion === patch.schemaVersion &&
        isRecord(target) &&
        isRecord(correlation) &&
        target.trackId === patch.target.trackId &&
        target.deviceId === patch.target.deviceId &&
        target.deviceType === patch.target.deviceType &&
        correlation.workletGeneration === patch.correlation.workletGeneration &&
        correlation.controlSequence === patch.correlation.controlSequence
    );
}

type PresetControlInput = {
    node: AudioWorkletNode;
    ctx: BaseAudioContext;
    target: RuntimeGrinderPreset['target'];
    workletGeneration: number;
    controlSequence: { next: number };
    timedParameters: GrinderTimedParameterControl | null;
    getRuntimeError: () => Error | null;
    flushParamPosts: () => void;
    onInstalledLatency: (latency: number) => void;
};

export function createGrinderTimedParameters(
    target: RuntimeDeviceControlTarget | undefined,
    offline: boolean
): GrinderTimedParameterControl | null {
    if (offline || target?.deviceType !== 'grinder' || typeof SharedArrayBuffer === 'undefined') {
        return null;
    }
    return new GrinderTimedParameterControl();
}

export function createGrinderPresetControl({
    target,
    offline,
    ...options
}: Omit<PresetControlInput, 'target'> & { target: RuntimeDeviceControlTarget | undefined; offline: boolean }) {
    if (offline || target?.deviceType !== 'grinder') {
        return null;
    }
    return new GrinderPresetControl({
        ...options,
        target: { trackId: target.trackId, deviceId: target.deviceId, deviceType: 'grinder' },
    });
}

function isLatency(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export class GrinderPresetControl {
    private readonly pendingPresets = new Map<number, PendingPreset>();
    private readonly uncertainPresetRates = new Set<string>();
    private readonly installedPresetRates = new Set<string>();
    private readonly unticketedSchedules = new Map<string, number>();

    readonly stopWatchingContext: () => void;

    constructor(private readonly options: PresetControlInput) {
        this.stopWatchingContext = this.watchContextClosure();
    }

    isInstalledRate(name: string): boolean {
        return this.installedPresetRates.has(name);
    }

    isRequestedPresetRate(name: string): boolean {
        if (this.installedPresetRates.has(name) || this.uncertainPresetRates.has(name)) {
            return true;
        }
        for (const pending of this.pendingPresets.values()) {
            if (pending.rateNames.includes(name)) {
                return true;
            }
        }
        return false;
    }

    private forgetPreset(sequence: number): PendingPreset | undefined {
        const pending = this.pendingPresets.get(sequence);
        if (pending) {
            clearTimeout(pending.timeout);
            this.pendingPresets.delete(sequence);
        }
        return pending;
    }

    rejectPendingPresets(reason: Error): void {
        for (const sequence of this.pendingPresets.keys()) {
            this.forgetPreset(sequence)?.reject(reason);
        }
    }

    receivePresetReply(data: Record<string, unknown>): void {
        const correlation = data.correlation;
        if (!isRecord(correlation) || typeof correlation.controlSequence !== 'number') {
            return;
        }
        const sequence = correlation.controlSequence;
        const pending = this.pendingPresets.get(sequence);
        if (!pending || !matchesPresetReply(data, pending.patch)) {
            return;
        }
        if (data.status === 'refused' && typeof data.reason === 'string') {
            this.forgetPreset(sequence)?.reject(new Error(data.reason));
        } else if (data.status === 'installed' && isLatency(data.latency)) {
            this.forgetPreset(sequence);
            this.install(pending, data.latency);
        }
    }

    private install(pending: PendingPreset, latency: number): void {
        const runtimeError = this.options.getRuntimeError();
        if (runtimeError) {
            pending.reject(runtimeError);
            return;
        }
        for (const name of pending.rateNames) {
            this.installedPresetRates.add(name);
            this.uncertainPresetRates.delete(name);
        }
        pending.resolve();
        this.options.onInstalledLatency(latency);
    }

    private watchContextClosure(): () => void {
        const { ctx } = this.options;
        const onStateChange = () => {
            if (ctx.state === 'closed') {
                this.rejectPendingPresets(
                    new Error('Grinder preset target closed before installation was acknowledged')
                );
            }
        };
        ctx.addEventListener('statechange', onStateChange);
        return () => ctx.removeEventListener('statechange', onStateChange);
    }

    async applyPreset(input: RuntimeGrinderPresetInput): Promise<void> {
        const { ctx, node, target, workletGeneration, controlSequence, getRuntimeError, flushParamPosts } =
            this.options;
        const runtimeError = getRuntimeError();
        if (runtimeError) {
            throw runtimeError;
        }
        if (this.pendingPresets.size >= MAX_PENDING_PRESETS) {
            throw new Error('Grinder preset reply capacity exhausted');
        }
        const result = compileRuntimeGrinderPreset({
            schemaVersion: 1,
            command: APPLY_GRINDER_PRESET_COMMAND,
            target,
            correlation: { workletGeneration, controlSequence: controlSequence.next },
            scheduling: { targetFrame: null, deadlineFrame: null },
            parameters: input.parameters,
            overrides: input.overrides,
            neural: input.neural,
            resetParameterIds: input.resetParameterIds ?? [],
        });
        if (result.status === 'invalid') {
            throw new Error(result.reason);
        }
        const rateNames = result.patch.parameters
            .map(({ parameterId }) => parameterId)
            .filter((name) => getGrinderContinuousParameterOrdinal(name) !== undefined);
        if (rateNames.some((name) => (this.unticketedSchedules.get(name) ?? -Infinity) >= ctx.currentTime)) {
            throw new Error('Grinder preset cannot replace a continuous control with an untracked timed write');
        }

        // Preserve earlier scalar edits even if the preset later fails admission in WASM.
        // The port must see them before the preset, never on a later animation frame.
        flushParamPosts();
        const sequence = controlSequence.next;
        if (!Number.isSafeInteger(sequence)) {
            throw new TypeError('Grinder preset control sequence exhausted');
        }
        const patch = Object.freeze({
            ...result.patch,
            correlation: Object.freeze({ workletGeneration, controlSequence: sequence }),
        });
        const { promise, resolve, reject } = Promise.withResolvers<void>();
        const timeout = setTimeout(() => {
            const pending = this.forgetPreset(sequence);
            if (pending) {
                // An unacknowledged worklet may have installed the patch. Keep routing edits to both carriers.
                for (const name of pending.rateNames) {
                    this.uncertainPresetRates.add(name);
                }
                pending.reject(new Error('Grinder preset installation acknowledgement timed out'));
            }
        }, PRESET_REPLY_TIMEOUT_MS);
        this.pendingPresets.set(sequence, { patch, rateNames, resolve, reject, timeout });
        try {
            node.port.postMessage(patch);
            controlSequence.next++;
        } catch (error) {
            this.forgetPreset(sequence)?.reject(error instanceof Error ? error : new Error(String(error)));
        }
        return promise;
    }

    postContinuousSchedule(name: string, value: number, targetTime: number): void {
        const { ctx, node, timedParameters } = this.options;
        const ordinal = getGrinderContinuousParameterOrdinal(name);
        const parameter = node.parameters.get(getGrinderTimedParameterName(name));
        if (timedParameters && ordinal !== undefined && typeof parameter?.setValueAtTime === 'function') {
            const nextFrame = Math.round(ctx.currentTime * ctx.sampleRate);
            const frame = Math.round(targetTime * ctx.sampleRate);
            parameter.setValueAtTime(timedParameters.reserve(ordinal, value, frame, nextFrame), targetTime);
            return;
        }
        if (this.isRequestedPresetRate(name)) {
            throw new Error('Grinder timed control is unavailable after preset installation');
        }
        this.unticketedSchedules.set(name, Math.max(this.unticketedSchedules.get(name) ?? 0, targetTime));
    }
}
