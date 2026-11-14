import { compileRuntimeGraphDelta } from '../../services/compileRuntimeGraphDelta';

import {
    createRuntimeDeviceChainDeltaApplication,
    type RuntimeDeviceChainDeltaPorts,
} from './createRuntimeDeviceChainDeltaApplication';
import {
    createRuntimeOutputDeltaApplication,
    type RuntimeOutputDeltaPorts,
} from './createRuntimeOutputDeltaApplication';
import {
    createRuntimeTrackStripInitialization,
    type RuntimeTrackStripInitializationPorts,
} from './createRuntimeTrackStripInitialization';
import { rejectRuntimeGraphDelta } from './rejectRuntimeGraphDelta';

import type { RuntimeGraphDeltaResult } from '../../models/RuntimeGraphDelta';

export type RuntimeGraphDeltaApplicationPorts = RuntimeDeviceChainDeltaPorts &
    RuntimeOutputDeltaPorts &
    RuntimeTrackStripInitializationPorts;

export type RuntimeGraphDeltaApplication = {
    /**
     * The sole consumer for compiled output-topology deltas. It runs only on the
     * main/control thread, after the compiler has bounded and frozen its input;
     * no worklet callback receives, parses, or allocates for this command.
     */
    apply(input: unknown): RuntimeGraphDeltaResult;
    /**
     * Rehydration-only entrypoint. It accepts only an immutable initialization
     * snapshot, preventing bootstrap callers from reaching device graph writes.
     */
    initializeTrackStripFromSnapshot(input: unknown): RuntimeGraphDeltaResult;
    /** Lets a withheld device type warn again, once, in the next project. */
    forgetWithheldDeviceNotices(): void;
};

export function createRuntimeGraphDeltaApplication(
    ports: RuntimeGraphDeltaApplicationPorts
): RuntimeGraphDeltaApplication {
    const applyDeviceChain = createRuntimeDeviceChainDeltaApplication(ports);
    const applyOutput = createRuntimeOutputDeltaApplication(ports);
    const stripInitialization = createRuntimeTrackStripInitialization(ports);

    function apply(input: unknown): RuntimeGraphDeltaResult {
        const compilation = compileRuntimeGraphDelta(input);
        if (compilation.status === 'invalid') {
            return rejectRuntimeGraphDelta(compilation.reason);
        }
        const { delta } = compilation;
        if (delta.command === 'replace-track-device-chain') {
            return applyDeviceChain(delta);
        }
        if (delta.command === 'initialize-track-strip') {
            return stripInitialization.apply(delta);
        }
        return applyOutput(delta);
    }

    function initializeTrackStripFromSnapshot(input: unknown): RuntimeGraphDeltaResult {
        const compilation = compileRuntimeGraphDelta(input);
        if (compilation.status === 'invalid') {
            return rejectRuntimeGraphDelta(compilation.reason);
        }
        if (compilation.delta.command !== 'initialize-track-strip') {
            return rejectRuntimeGraphDelta('Runtime strip initialization requires an initialization snapshot');
        }
        return stripInitialization.apply(compilation.delta);
    }

    return {
        apply,
        initializeTrackStripFromSnapshot,
        forgetWithheldDeviceNotices: stripInitialization.forgetWithheldDeviceNotices,
    };
}
