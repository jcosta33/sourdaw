import { getTrackStrip, initializeTrackStripFromSnapshot, updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { createHandler } from '#/utils/createHandler';
import {
    type AppAction,
    type DeviceChainTopologySnapshot,
    type DeviceSnapshot,
    type HandlerValidationContext,
} from '#/utils/handlerContract';

import { getTrackEligibility, shouldCreateLiveTrackStrip } from '../../stores/trackEligibility';
import { type Device, type Track } from '../../stores/trackStore';
import { compileTrackStripInitializationSnapshot } from '../../useCases/compileTrackStripInitializationSnapshot';
import { applyDeviceChainRuntimeDelta } from '../../useCases/device/applyDeviceChainRuntimeDelta';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { findPresetById } from '../../useCases/preset/findPresetById';
import { matchesMaterializedPresetDevices } from '../../useCases/preset/matchesMaterializedPresetDevices';
import { runtimeGraphTopology } from '../../useCases/runtimeGraphTopology';
import { updateTrack } from '../../useCases/updateTrack';
import { getPlannedTrackState } from '../getPlannedTrackState';

type LoadPresetAction = Extract<AppAction, { type: 'loadPreset' }>;
type RuntimeDeviceDeltaResult = ReturnType<typeof applyDeviceChainRuntimeDelta>;
type RuntimeDeviceDeltaFailure = Exclude<
    RuntimeDeviceDeltaResult,
    Readonly<{ acceptance: 'accepted'; application: 'applied' }>
>;

class RuntimePresetDeltaPostCommitError extends Error {
    public readonly outcome: RuntimeDeviceDeltaFailure;
    public readonly remediation: 'retry' | 'repair';

    constructor(outcome: RuntimeDeviceDeltaFailure) {
        const remediation = outcome.acceptance === 'rejected' ? 'retry' : 'repair';
        super(
            outcome.acceptance === 'rejected'
                ? `Preset runtime delta was rejected after project commit and requires ${remediation}: ${outcome.reason}`
                : `Preset runtime delta requires ${remediation} after project commit: ${outcome.reason}`
        );
        this.name = 'RuntimePresetDeltaPostCommitError';
        this.outcome = outcome;
        this.remediation = remediation;
    }
}

function findUniqueTrack(trackId: string): Track | null {
    const matches = (getTrackStoreState()?.tracks ?? []).filter((track) => track.id === trackId);
    return matches.length === 1 ? (matches[0] ?? null) : null;
}

function hasUniqueDeviceIds(devices: readonly { id: string }[]): boolean {
    return new Set(devices.map((device) => device.id)).size === devices.length;
}

function isValidReplacementDevice(device: DeviceSnapshot): boolean {
    return (
        device.id.length > 0 &&
        device.id.length <= 128 &&
        device.type.length > 0 &&
        device.type.length <= 128 &&
        device.name.trim().length > 0 &&
        device.name.length <= 256 &&
        Object.entries(device.parameterValues).every(
            ([parameterId, value]) => parameterId.length > 0 && parameterId.length <= 128 && Number.isFinite(value)
        )
    );
}

function toProjectDevices(devices: readonly DeviceSnapshot[]): Device[] {
    return devices.map((device) => ({
        id: device.id,
        name: device.name,
        type: device.type,
        bypassed: device.bypassed,
        parameterValues: { ...device.parameterValues },
        ...(device.externalPluginId ? { externalPluginId: device.externalPluginId } : {}),
        ...(device.externalInstanceId ? { externalInstanceId: device.externalInstanceId } : {}),
        ...(device.externalStateChunk ? { externalStateChunk: device.externalStateChunk } : {}),
        ...(device.deviceState ? { deviceState: structuredClone(device.deviceState) } : {}),
    }));
}

function resolveReplacement(
    input: {
        trackId: string;
        expectedBefore: DeviceChainTopologySnapshot;
        expectedFrozen: boolean;
        devices: readonly DeviceSnapshot[];
        expectedProjectRevision?: string;
    },
    context?: HandlerValidationContext
): Track | null {
    if (input.expectedProjectRevision !== undefined && input.expectedProjectRevision !== captureProjectRevision()) {
        return null;
    }
    const current = findUniqueTrack(input.trackId);
    const planned = context ? getPlannedTrackState(context, input.trackId) : current;
    if (
        !planned ||
        (!current && !context) ||
        !getTrackEligibility(planned.kind).acceptsDeviceUpdate ||
        planned.frozen !== input.expectedFrozen ||
        (current !== null && !hasUniqueDeviceIds(current.devices)) ||
        !hasUniqueDeviceIds(planned.devices) ||
        !hasUniqueDeviceIds(input.devices) ||
        input.devices.length === 0 ||
        input.devices.length > 64 ||
        input.devices.some((device) => !isValidReplacementDevice(device)) ||
        !runtimeGraphTopology.matchesNode(planned, input.expectedBefore)
    ) {
        return null;
    }
    return current ?? planned;
}

function createReplacementTopology(before: Track, replacementDevices: readonly DeviceSnapshot[]): Track {
    return { ...before, devices: toProjectDevices(replacementDevices) };
}

function initializeMissingLiveStrip(after: Track): RuntimeDeviceDeltaResult {
    const tracks = getTrackStoreState()?.tracks ?? [];
    const projectTracks = tracks.some((track) => track.id === after.id)
        ? tracks.map((track) => (track.id === after.id ? after : track))
        : [...tracks, after];
    const snapshot = compileTrackStripInitializationSnapshot(after, projectTracks);
    if (!snapshot) {
        return {
            acceptance: 'rejected',
            application: 'not-applied',
            reason: `Cannot initialize preset runtime strip for track ${after.id}`,
        };
    }
    return initializeTrackStripFromSnapshot(snapshot);
}

function createPostCommitRuntimeEffect(before: Track, after: Track): () => void {
    let failure: RuntimePresetDeltaPostCommitError | undefined;
    return () => {
        if (failure) {
            throw failure;
        }
        if (!shouldCreateLiveTrackStrip(before)) {
            return;
        }
        const result = getTrackStrip(after.id)
            ? applyDeviceChainRuntimeDelta({
                  before,
                  after,
                  operation: 'replace-device-chain',
              })
            : initializeMissingLiveStrip(after);
        if (result.acceptance !== 'accepted' || result.application !== 'applied') {
            failure = new RuntimePresetDeltaPostCommitError(result);
            throw failure;
        }
        // Parameter controls are intentionally separate from the topology
        // delta. They run only after the exact live chain was accepted.
        for (const device of after.devices) {
            for (const [parameterId, value] of Object.entries(device.parameterValues)) {
                updateDeviceParam(after.id, device.id, parameterId, value);
            }
        }
    };
}

function executeReplacement(input: {
    trackId: string;
    expectedBefore: DeviceChainTopologySnapshot;
    expectedFrozen: boolean;
    replacementDevices: readonly DeviceSnapshot[];
    expectedProjectRevision?: string;
}) {
    const current = resolveReplacement(
        {
            trackId: input.trackId,
            expectedBefore: input.expectedBefore,
            expectedFrozen: input.expectedFrozen,
            devices: input.replacementDevices,
            expectedProjectRevision: input.expectedProjectRevision,
        },
        undefined
    );
    if (!current) {
        return { status: 'conflict' as const };
    }
    const before = structuredClone(current);
    const after = createReplacementTopology(before, input.replacementDevices);
    updateTrack(before.id, () => after);
    const applyRuntimeEffect = createPostCommitRuntimeEffect(before, after);
    return {
        status: 'written' as const,
        afterCommit: applyRuntimeEffect,
        afterAmbiguousCommit: applyRuntimeEffect,
    };
}

function expectedAfterTopology(action: LoadPresetAction): DeviceChainTopologySnapshot {
    return {
        id: action.payload.trackId,
        kind: action.payload.expectedBefore.kind,
        devices: action.payload.devices.map((device) => ({
            id: device.id,
            type: device.type,
            ...(device.externalInstanceId ? { externalInstanceId: device.externalInstanceId } : {}),
            parameterIds: Object.keys(device.parameterValues).sort((left, right) => left.localeCompare(right)),
        })),
    };
}

function describeLoadPreset(action: LoadPresetAction) {
    const current = findUniqueTrack(action.payload.trackId);
    const inverseAction =
        current && runtimeGraphTopology.matchesNode(current, action.payload.expectedBefore)
            ? {
                  type: 'restorePresetDeviceChain' as const,
                  payload: {
                      trackId: action.payload.trackId,
                      expectedBefore: expectedAfterTopology(action),
                      expectedFrozen: action.payload.expectedFrozen,
                      replacementDevices: structuredClone(current.devices),
                  },
              }
            : null;
    const preset = findPresetById(action.payload.presetId);
    return {
        label: preset ? `Load preset "${preset.name}"` : `Load preset ${action.payload.presetId}`,
        inverseAction,
    };
}

export const handleLoadPreset = createHandler<'loadPreset'>({
    validate: (action, context) => {
        const preset = findPresetById(action.payload.presetId);
        return (
            preset !== null &&
            matchesMaterializedPresetDevices(preset, action.payload.devices) &&
            resolveReplacement(
                {
                    trackId: action.payload.trackId,
                    expectedBefore: action.payload.expectedBefore,
                    expectedFrozen: action.payload.expectedFrozen,
                    devices: action.payload.devices,
                    expectedProjectRevision: action.payload.expectedProjectRevision,
                },
                context
            ) !== null
        );
    },
    execute: (action) => {
        if (
            resolveReplacement(
                {
                    trackId: action.payload.trackId,
                    expectedBefore: action.payload.expectedBefore,
                    expectedFrozen: action.payload.expectedFrozen,
                    devices: action.payload.devices,
                    expectedProjectRevision: action.payload.expectedProjectRevision,
                },
                undefined
            ) === null
        ) {
            return { status: 'conflict' };
        }
        // The first application consumes the collaboration revision proof. The
        // guarded inverse and redo retain their exact topology fingerprints.
        delete action.payload.expectedProjectRevision;
        return executeReplacement({
            trackId: action.payload.trackId,
            expectedBefore: action.payload.expectedBefore,
            expectedFrozen: action.payload.expectedFrozen,
            replacementDevices: action.payload.devices,
        });
    },
    describe: describeLoadPreset,
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});

export const handleRestorePresetDeviceChain = createHandler<'restorePresetDeviceChain'>({
    validate: (action, context) =>
        resolveReplacement(
            {
                trackId: action.payload.trackId,
                expectedBefore: action.payload.expectedBefore,
                expectedFrozen: action.payload.expectedFrozen,
                devices: action.payload.replacementDevices,
            },
            context
        ) !== null,
    execute: (action) =>
        executeReplacement({
            trackId: action.payload.trackId,
            expectedBefore: action.payload.expectedBefore,
            expectedFrozen: action.payload.expectedFrozen,
            replacementDevices: action.payload.replacementDevices,
        }),
    describe: () => ({ label: 'Restore preset device chain' }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
