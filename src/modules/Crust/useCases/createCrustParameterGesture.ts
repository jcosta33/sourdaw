import { resolveEligibleDeviceWriteTarget, trackStore } from '#/modules/Arrangement/stores';
import { clampDeviceParameterValue, getPluginById, setDeviceParameter } from '#/modules/Arrangement/useCases';
import { captureDeviceParameterRuntimeWriteAuthority } from '#/modules/AudioEngine/useCases';
import { captureTouchAutomationRecordingAuthority } from '#/modules/Automation/useCases';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { captureProjectRootIdentity } from '#/modules/CrdtDocument/useCases';
import { captureProjectTransitionAuthority } from '#/modules/Project/useCases';
import { createDeviceAutomationTargetId } from '#/utils/automationDeviceTarget';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type CrustPatch, DEFAULT_CRUST_PATCH } from '../models/CrustPatch';
import { setCrustParam } from '../stores/crustStore';

import { paramBatcher } from './crustParamBridge/helpers';
import { hydrateCrustPatchFromProject } from './crustParamBridge/hydrateCrustPatchFromProject';

type Key = keyof CrustPatch;
type Gesture = {
    token: number;
    deviceId: string;
    trackId: string;
    key: Key;
    deviceIds: string[];
    frozen: boolean | undefined;
    present: boolean;
    value: number | undefined;
    defaultValue: number;
    recordingEligible: boolean;
    root: string;
    project: ReturnType<typeof captureProjectTransitionAuthority>;
    runtime: ReturnType<typeof captureDeviceParameterRuntimeWriteAuthority>;
    recording: ReturnType<typeof captureTouchAutomationRecordingAuthority>;
    preview?: number;
    cancelled: boolean;
    reacquirable?: boolean;
    committed: boolean;
    pending?: Promise<void>;
};
type Scope = { deviceId: string; sequence: number; disposed: boolean; gestures: Map<Key, Gesture> };

function readTarget(gesture: Gesture, baseline = true) {
    if (!gesture.project.isCurrent() || captureProjectRootIdentity() !== gesture.root) {
        return undefined;
    }
    const target = resolveEligibleDeviceWriteTarget(gesture.deviceId);
    const owner = trackStore.value?.tracks.find((track) => track.id === gesture.trackId);
    const device = owner?.devices.find((candidate) => candidate.id === gesture.deviceId);
    if (
        target.status !== 'eligible' ||
        target.trackId !== gesture.trackId ||
        !owner ||
        device?.type !== 'crust' ||
        owner.devices.length !== gesture.deviceIds.length ||
        owner.devices.some((candidate, index) => candidate.id !== gesture.deviceIds[index])
    ) {
        return undefined;
    }
    if (
        baseline &&
        (owner.frozen !== gesture.frozen ||
            Object.hasOwn(device.parameterValues, gesture.key) !== gesture.present ||
            (gesture.present && device.parameterValues[gesture.key] !== gesture.value))
    ) {
        return undefined;
    }
    return device;
}

function hydrate(scope: Scope): void {
    const previews = new Map<Key, number>();
    for (const gesture of scope.gestures.values()) {
        if (current(scope, gesture) && gesture.runtime.canCommit() && gesture.preview !== undefined) {
            previews.set(gesture.key, gesture.preview);
        }
    }
    if (previews.size === 0) {
        hydrateCrustPatchFromProject(scope.deviceId);
    } else {
        hydrateCrustPatchFromProject(scope.deviceId, previews);
    }
}

function restorePreview(scope: Scope, gesture: Gesture): void {
    const device = readTarget(gesture, false);
    if (!device) {
        return;
    }
    const value = device.parameterValues[gesture.key] ?? gesture.defaultValue;
    if (
        gesture.preview !== undefined &&
        gesture.preview !== value &&
        gesture.runtime.isCurrent() &&
        gesture.runtime.canCommit()
    ) {
        setDeviceParameter(gesture.deviceId, gesture.key, value, {
            transient: true,
            automationRecordingPolicy: 'suppressed',
        });
    }
    hydrate(scope);
}

function retire(scope: Scope, gesture: Gesture, restore: boolean): void {
    if (restore) {
        gesture.cancelled = true;
    }
    gesture.recording.release();
    try {
        if (restore) {
            restorePreview(scope, gesture);
        }
    } finally {
        gesture.runtime.release();
    }
}

function cancel(scope: Scope, gesture: Gesture, reacquirable = false): void {
    gesture.cancelled = true;
    gesture.reacquirable = reacquirable;
    try {
        retire(scope, gesture, !gesture.committed);
    } catch (error) {
        notifyUser(error instanceof Error ? error.message : 'Crust preview restoration failed', 'error');
    }
}

function isOutputBitDepth(value: number): value is CrustPatch['outputBitDepth'] {
    return value === 16 || value === 24 || value === 32;
}

function readParameterAdmission(key: Key) {
    const descriptor = getPluginById('crust');
    const parameter = descriptor?.parameters.find((parameter) => parameter.id === key);
    const undeclaredDefaults = descriptor?.undeclaredParameterDefaults;
    let defaultValue: number | undefined;
    if (parameter) {
        defaultValue = parameter.defaultValue;
    } else if (undeclaredDefaults && Object.hasOwn(undeclaredDefaults, key)) {
        defaultValue = undeclaredDefaults[key];
    }
    if (
        typeof defaultValue !== 'number' ||
        !Number.isFinite(defaultValue) ||
        (key === 'outputBitDepth' && !isOutputBitDepth(defaultValue))
    ) {
        return null;
    }
    return { defaultValue, recordingEligible: parameter?.automatable === true };
}

function start(scope: Scope, key: Key): number {
    if (scope.disposed || typeof DEFAULT_CRUST_PATCH[key] !== 'number') {
        return -1;
    }
    const previous = scope.gestures.get(key);
    if (previous?.pending) {
        notifyUser('Previous Crust parameter edit is still applying', 'warning');
        return -1;
    }
    if (previous) {
        cancel(scope, previous);
    }
    const target = resolveEligibleDeviceWriteTarget(scope.deviceId);
    if (target.status !== 'eligible') {
        return -1;
    }
    const owner = trackStore.value?.tracks.find((track) => track.id === target.trackId);
    const device = owner?.devices.find((candidate) => candidate.id === scope.deviceId);
    const admission = readParameterAdmission(key);
    if (!owner || device?.type !== 'crust' || !admission) {
        return -1;
    }
    paramBatcher.cancel(`${scope.deviceId}:${key}`);
    const gesture: Gesture = {
        token: ++scope.sequence,
        deviceId: scope.deviceId,
        trackId: owner.id,
        key,
        deviceIds: owner.devices.map((device) => device.id),
        frozen: owner.frozen,
        present: Object.hasOwn(device.parameterValues, key),
        value: device.parameterValues[key],
        defaultValue: admission.defaultValue,
        recordingEligible: admission.recordingEligible,
        root: captureProjectRootIdentity(),
        project: captureProjectTransitionAuthority(),
        runtime: captureDeviceParameterRuntimeWriteAuthority(owner.id, device.id, key),
        recording: captureTouchAutomationRecordingAuthority(owner.id, createDeviceAutomationTargetId(device.id, key)),
        cancelled: false,
        committed: false,
    };
    scope.gestures.set(key, gesture);
    return gesture.token;
}

function current(scope: Scope, gesture: Gesture): boolean {
    return (
        !scope.disposed && !gesture.cancelled && scope.gestures.get(gesture.key) === gesture && !!readTarget(gesture)
    );
}

async function commit(scope: Scope, gesture: Gesture): Promise<void> {
    gesture.recording.release();
    const value = gesture.preview;
    if (value === undefined || value === (gesture.value ?? gesture.defaultValue)) {
        retire(scope, gesture, true);
        scope.gestures.delete(gesture.key);
        return;
    }
    try {
        await executeUserAppAction(
            {
                type: 'setDeviceParameter',
                payload: {
                    deviceId: gesture.deviceId,
                    paramId: gesture.key,
                    value,
                    expectedTrackId: gesture.trackId,
                    expectedDeviceType: 'crust',
                    expectedDeviceIds: gesture.deviceIds,
                    expectedTrackFrozen: gesture.frozen,
                    expectedValuePresent: gesture.present,
                    expectedValue: gesture.value,
                    automationRecordingPolicy: 'suppressed',
                },
            },
            {
                shouldExecute: () => current(scope, gesture),
                deviceParameterRuntimeAuthority: {
                    trackId: gesture.trackId,
                    deviceId: gesture.deviceId,
                    paramId: gesture.key,
                    owner: gesture.runtime.owner,
                    isCurrent: gesture.runtime.canCommit,
                },
                onCommitted: () => {
                    gesture.committed = true;
                },
            }
        );
    } catch (error) {
        notifyUser(error instanceof Error ? error.message : 'Crust parameter change failed', 'error');
    } finally {
        retire(scope, gesture, !gesture.committed);
        if (scope.gestures.get(gesture.key) === gesture) {
            scope.gestures.delete(gesture.key);
        }
    }
}

function change(scope: Scope, key: Key, value: number, transient = false, recordingSample = true): Promise<void> {
    if (!Number.isFinite(value) || scope.disposed || (key === 'outputBitDepth' && !isOutputBitDepth(value))) {
        return Promise.resolve();
    }
    const previous = scope.gestures.get(key);
    if (!previous || (previous.cancelled && previous.reacquirable && !previous.pending)) {
        start(scope, key);
    }
    const gesture = scope.gestures.get(key);
    if (!gesture) {
        return Promise.resolve();
    }
    if (gesture.pending) {
        return gesture.pending;
    }
    if (gesture.cancelled) {
        return Promise.resolve();
    }
    if (!current(scope, gesture) || (!recordingSample && !gesture.runtime.canCommit())) {
        cancel(scope, gesture);
        return Promise.resolve();
    }
    try {
        const bounded = clampDeviceParameterValue({ deviceType: 'crust', paramId: key, value });
        const accepted = setDeviceParameter(scope.deviceId, key, bounded, {
            transient: true,
            runtimeOwner: gesture.runtime.owner,
            automationRecordingOwner: gesture.recording.owner,
            automationRecordingPolicy: recordingSample && gesture.recordingEligible ? undefined : 'suppressed',
        });
        if (!accepted) {
            cancel(scope, gesture, true);
            return Promise.resolve();
        }
        gesture.preview = bounded;
        setCrustParam(scope.deviceId, key, bounded);
        if (transient) {
            return Promise.resolve();
        }
        gesture.pending = commit(scope, gesture);
        return gesture.pending;
    } catch (error) {
        cancel(scope, gesture, true);
        notifyUser(error instanceof Error ? error.message : 'Crust parameter preview failed', 'error');
        return Promise.resolve();
    }
}

/** One mounted panel owns numeric previews; project truth changes only at a physical terminal. */
export function createCrustParameterGesture(deviceId: string) {
    const scope: Scope = { deviceId, sequence: 0, disposed: false, gestures: new Map() };
    const unsubscribe = trackStore.subscribe(() => {
        for (const gesture of scope.gestures.values()) {
            if (!gesture.pending && !readTarget(gesture)) {
                cancel(scope, gesture);
            }
        }
        hydrate(scope);
    });
    hydrate(scope);
    return {
        start: (key: Key) => start(scope, key),
        isCurrent: (key: Key, token: string | number) => {
            const gesture = scope.gestures.get(key);
            return gesture?.token === token && current(scope, gesture) && !gesture.pending;
        },
        change: (key: Key, value: number, transient = false, recordingSample = true) =>
            change(scope, key, value, transient, recordingSample),
        settle: (key: Key) => {
            const gesture = scope.gestures.get(key);
            if (!gesture || !current(scope, gesture) || !gesture.runtime.canCommit()) {
                if (gesture) {
                    cancel(scope, gesture);
                }
                return Promise.resolve();
            }
            gesture.pending ??= commit(scope, gesture);
            return gesture.pending;
        },
        cancel: (key: Key) => {
            const gesture = scope.gestures.get(key);
            if (gesture) {
                cancel(scope, gesture, true);
            }
        },
        dispose: () => {
            scope.disposed = true;
            unsubscribe();
            for (const gesture of scope.gestures.values()) {
                cancel(scope, gesture);
            }
        },
    };
}
