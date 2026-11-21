import { applyParams } from '../applyParams';
import { createOfflineDeviceNode } from '../deviceNodeFactory';

import type { EngineDeviceCollaborators, EngineUseCaseCollaborators } from '../../models/EngineDeviceCollaborators';

function refuseUnwiredDeviceCollaborator(name: string): Error {
    return new Error(
        `AudioEngine ${name} is not wired: the composition root installs it through initEngineDeviceCollaborators`
    );
}

/**
 * Parameter-write ownership, reported latency and Faust builds are AudioEngine
 * use-case state the live graph cannot import (`engine-no-own-application-layers`).
 * Bootstrap installs them before any project loads, so reaching one unwired is a
 * wiring defect, and it refuses rather than silently dropping the write.
 */
const UNWIRED_USE_CASE_DEVICE_COLLABORATORS: EngineUseCaseCollaborators = {
    captureParameterWriteReceipt: () => {
        throw refuseUnwiredDeviceCollaborator('captureParameterWriteReceipt');
    },
    createFaustDeviceNode: () => Promise.reject(refuseUnwiredDeviceCollaborator('createFaustDeviceNode')),
    reportLatency: () => {
        throw refuseUnwiredDeviceCollaborator('reportLatency');
    },
    clearReportedLatency: () => {
        throw refuseUnwiredDeviceCollaborator('clearReportedLatency');
    },
};

export type EngineDeviceCollaboratorSlot = {
    /** Stable for the engine's life: every strip holds it and resolves the use cases through it per call. */
    readonly collaborators: EngineDeviceCollaborators;
    /** null unwires the collaborators: every later use refuses instead of writing nothing. */
    setUseCaseCollaborators(collaborators: EngineUseCaseCollaborators | null): void;
};

/** Built-ins come straight from this repository; the rest resolve through the installed use cases per call. */
export function createEngineDeviceCollaborators(): EngineDeviceCollaboratorSlot {
    let useCases = UNWIRED_USE_CASE_DEVICE_COLLABORATORS;
    return {
        collaborators: {
            createBuiltinDeviceNode: createOfflineDeviceNode,
            applyParams,
            captureParameterWriteReceipt: (trackId, deviceId, paramId) =>
                useCases.captureParameterWriteReceipt(trackId, deviceId, paramId),
            createFaustDeviceNode: (context, pluginId) => useCases.createFaustDeviceNode(context, pluginId),
            reportLatency: (deviceId, latencyMs) => useCases.reportLatency(deviceId, latencyMs),
            clearReportedLatency: (deviceId) => useCases.clearReportedLatency(deviceId),
        },
        setUseCaseCollaborators: (collaborators) => {
            useCases = collaborators ?? UNWIRED_USE_CASE_DEVICE_COLLABORATORS;
        },
    };
}
