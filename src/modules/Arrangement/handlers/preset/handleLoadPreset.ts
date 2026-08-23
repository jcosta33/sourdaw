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
import { hasLiveProjectHostTrack } from '../../useCases/device/hasLiveProjectHostTrack';
import {
    getRuntimeDeviceDeltaPostCommitFailure,
    type RuntimeDeviceDeltaPostCommitError,
} from '../../useCases/device/runtimeDeviceDeltaPostCommit';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { findPresetById } from '../../useCases/preset/findPresetById';
import { matchesMaterializedPresetDevices } from '../../useCases/preset/matchesMaterializedPresetDevices';
import { runtimeGraphTopology } from '../../useCases/runtimeGraphTopology';
import { updateTrack } from '../../useCases/updateTrack';
import { getPlannedTrackState } from '../getPlannedTrackState';

type LoadPresetAction = Extract<AppAction, { type: 'loadPreset' }>;
type RuntimeDeviceDeltaResult = Exclude<
    ReturnType<typeof applyDeviceChainRuntimeDelta>,
    Readonly<{ acceptance: 'superseded' }>
>;

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

function isReplacementStillAuthoritative(after: Track): boolean {
    const current = findUniqueTrack(after.id);
    return current !== null && runtimeGraphTopology.matchesNode(current, runtimeGraphTopology.createNode(after));
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

function createPostCommitRuntimeEffect(
    before: Track,
    after: Track,
    batchContext?: Pick<HandlerValidationContext, 'actions' | 'actionIndex'>
): () => void {
    let failure: RuntimeDeviceDeltaPostCommitError | undefined;
    return () => {
        if (failure) {
            throw failure;
        }
        if (!shouldCreateLiveTrackStrip(after)) {
            return;
        }
        // This effect runs after the whole batch commits, so a later action in
        // the same commit may have removed the host track. Both branches below
        // are unsound once it is gone, and each is guarded on its own terms:
        // the delta reports itself `superseded`, while strip initialization
        // never consults project truth at all and would build a strip nothing
        // owns for a track that no longer exists.
        const liveStrip = getTrackStrip(after.id);
        if (!liveStrip && !hasLiveProjectHostTrack(after.id)) {
            return;
        }
        const result = liveStrip
            ? applyDeviceChainRuntimeDelta({
                  before,
                  after,
                  operation: 'replace-device-chain',
                  batchContext,
              })
            : initializeMissingLiveStrip(after);
        if (result.acceptance === 'superseded' && result.application === 'not-applied') {
            return;
        }
        if (result.acceptance !== 'superseded') {
            const presetFailure = getRuntimeDeviceDeltaPostCommitFailure(result, 'Preset');
            if (presetFailure) {
                failure = presetFailure;
                throw failure;
            }
        }
        if (result.application === 'discharged' && !isReplacementStillAuthoritative(after)) {
            return;
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

function executeReplacement(
    input: {
        trackId: string;
        expectedBefore: DeviceChainTopologySnapshot;
        expectedFrozen: boolean;
        replacementDevices: readonly DeviceSnapshot[];
        expectedProjectRevision?: string;
    },
    batchContext?: Pick<HandlerValidationContext, 'actions' | 'actionIndex'>
) {
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
    const applyRuntimeEffect = createPostCommitRuntimeEffect(before, after, batchContext);
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
    execute: (action, context) => {
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
        return executeReplacement(
            {
                trackId: action.payload.trackId,
                expectedBefore: action.payload.expectedBefore,
                expectedFrozen: action.payload.expectedFrozen,
                replacementDevices: action.payload.devices,
            },
            context
        );
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
    execute: (action, context) =>
        executeReplacement(
            {
                trackId: action.payload.trackId,
                expectedBefore: action.payload.expectedBefore,
                expectedFrozen: action.payload.expectedFrozen,
                replacementDevices: action.payload.replacementDevices,
            },
            context
        ),
    describe: () => ({ label: 'Restore preset device chain' }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
