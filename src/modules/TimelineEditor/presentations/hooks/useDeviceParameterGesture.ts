import {
    type Dispatch,
    type RefObject,
    type SetStateAction,
    useLayoutEffect,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react';

import { useStore } from '#/infra/store/useStore';
import { trackStore } from '#/modules/Arrangement/stores';
import { setDeviceParameter } from '#/modules/Arrangement/useCases';
import { captureDeviceParameterRuntimeWriteAuthority } from '#/modules/AudioEngine/useCases';
import { captureTouchAutomationRecordingAuthority } from '#/modules/Automation/useCases';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { captureProjectRootIdentity } from '#/modules/CrdtDocument/useCases';
import { captureProjectTransitionAuthority } from '#/modules/Project/useCases';
import { createDeviceAutomationTargetId } from '#/utils/automationDeviceTarget';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type DeviceParameterView as DeviceParameter } from '../../models/PluginDescriptorViewTypes';
import { type Device } from '../../models/TrackViewTypes';

import {
    acquireDeviceParameterPreview,
    ownsDeviceParameterPreview,
    readDeviceParameterPreview,
    releaseDeviceParameterPreview,
    subscribeDeviceParameterPreview,
    updateDeviceParameterPreview,
} from './deviceParameterGesturePreview';

type ParameterGesture = {
    id: number;
    previewKey: string;
    rootIdentity: string;
    trackId: string;
    deviceId: string;
    deviceType: string;
    deviceIds: string[];
    paramId: string;
    frozen: boolean | undefined;
    valuePresent: boolean;
    value: number | undefined;
    defaultValue: number;
    authority: ReturnType<typeof captureProjectTransitionAuthority>;
    runtimeAuthority: ReturnType<typeof captureDeviceParameterRuntimeWriteAuthority>;
    recordingAuthority: ReturnType<typeof captureTouchAutomationRecordingAuthority>;
    previewValue?: number;
    invalidated: boolean;
    settling: boolean;
    committed: boolean;
};

function readGestureDevice(gesture: ParameterGesture, requireStartingValue: boolean) {
    if (!gesture.authority.isCurrent() || captureProjectRootIdentity() !== gesture.rootIdentity) {
        return undefined;
    }
    const tracks = trackStore.value?.tracks ?? [];
    const owners = tracks.filter((track) => track.devices.some((candidate) => candidate.id === gesture.deviceId));
    const owner = owners.length === 1 ? owners[0] : undefined;
    if (
        !owner ||
        owner.id !== gesture.trackId ||
        tracks.filter((track) => track.id === owner.id).length !== 1 ||
        owner.devices.length !== gesture.deviceIds.length ||
        owner.devices.some((candidate, index) => candidate.id !== gesture.deviceIds[index])
    ) {
        return undefined;
    }
    const matches = owner.devices.filter((candidate) => candidate.id === gesture.deviceId);
    const device = matches.length === 1 ? matches[0] : undefined;
    if (!device || device.type !== gesture.deviceType) {
        return undefined;
    }
    if (
        requireStartingValue &&
        (owner.frozen !== gesture.frozen ||
            Object.hasOwn(device.parameterValues, gesture.paramId) !== gesture.valuePresent ||
            (gesture.valuePresent && device.parameterValues[gesture.paramId] !== gesture.value))
    ) {
        return undefined;
    }
    return device;
}

function restoreGesturePreview(gesture: ParameterGesture): void {
    if (!gesture.runtimeAuthority.isCurrent() || !gesture.runtimeAuthority.canCommit()) {
        return;
    }
    const device = readGestureDevice(gesture, false);
    const value = device?.parameterValues[gesture.paramId] ?? gesture.defaultValue;
    if (device && gesture.previewValue !== undefined && gesture.previewValue !== value) {
        setDeviceParameter(gesture.deviceId, gesture.paramId, value, {
            transient: true,
            automationRecordingPolicy: 'suppressed',
        });
    }
}

function releaseGestureTouchAutomation(gesture: ParameterGesture): void {
    gesture.recordingAuthority.release();
}

type GestureProps = {
    param: DeviceParameter;
    device: Device;
    trackId: string;
};

type GestureContext = GestureProps & {
    gestureRef: RefObject<ParameterGesture | null>;
    gestureSequence: RefObject<number>;
    mounted: RefObject<boolean>;
    cancelOnUnmount: RefObject<() => void>;
    setGestureOwner: Dispatch<SetStateAction<number | undefined>>;
    previewKey: string;
};

function cancelGesture(context: GestureContext, gesture: ParameterGesture): void {
    if (gesture.invalidated || gesture.settling) {
        return;
    }
    gesture.invalidated = true;
    releaseGestureTouchAutomation(gesture);
    try {
        restoreGesturePreview(gesture);
    } catch (error) {
        notifyUser(error instanceof Error ? error.message : 'Device parameter preview restoration failed', 'error');
    }
    releaseDeviceParameterPreview(gesture.previewKey, gesture.runtimeAuthority.owner);
    gesture.runtimeAuthority.release();
    if (context.mounted.current) {
        if (context.gestureRef.current === gesture) {
            context.setGestureOwner(undefined);
        }
    }
}

function startGesture(context: GestureContext): number {
    const { param, device, trackId, previewKey } = context;
    const previous = context.gestureRef.current;
    if (previous?.settling) {
        notifyUser('Previous device parameter edit is still applying', 'warning');
        return -1;
    }
    if (previous) {
        cancelGesture(context, previous);
    }
    const liveOwner = trackStore.value?.tracks.find((track) => track.id === trackId);
    const gesture: ParameterGesture = {
        id: ++context.gestureSequence.current,
        previewKey,
        rootIdentity: captureProjectRootIdentity(),
        trackId,
        deviceId: device.id,
        deviceType: device.type,
        deviceIds: liveOwner?.devices.map((candidate) => candidate.id) ?? [],
        paramId: param.id,
        frozen: liveOwner?.frozen,
        valuePresent: Object.hasOwn(device.parameterValues, param.id),
        value: device.parameterValues[param.id],
        defaultValue: param.defaultValue ?? param.value,
        authority: captureProjectTransitionAuthority(),
        runtimeAuthority: captureDeviceParameterRuntimeWriteAuthority(trackId, device.id, param.id),
        recordingAuthority: captureTouchAutomationRecordingAuthority(
            trackId,
            createDeviceAutomationTargetId(device.id, param.id)
        ),
        invalidated: false,
        settling: false,
        committed: false,
    };
    context.gestureRef.current = gesture;
    context.setGestureOwner(gesture.id);
    if (!readGestureDevice(gesture, true)) {
        gesture.invalidated = true;
        notifyUser('Device parameter target changed; edit was not applied', 'warning');
    }
    return gesture.id;
}

function finishGesture(context: GestureContext, gesture: ParameterGesture): void {
    if (!gesture.committed) {
        try {
            restoreGesturePreview(gesture);
        } catch (error) {
            notifyUser(error instanceof Error ? error.message : 'Device parameter preview restoration failed', 'error');
        }
    }
    releaseDeviceParameterPreview(gesture.previewKey, gesture.runtimeAuthority.owner);
    gesture.runtimeAuthority.release();
    if (context.gestureRef.current === gesture) {
        context.gestureRef.current = null;
        if (context.mounted.current) {
            context.setGestureOwner(undefined);
        }
    }
}

function handleKnobChange(
    context: GestureContext,
    nextValue: number,
    isTransient = false,
    recordingSample = true
): void {
    if (!context.mounted.current) {
        return;
    }
    if (!context.gestureRef.current) {
        startGesture(context);
    }
    const gesture = context.gestureRef.current;
    if (!gesture || gesture.settling) {
        return;
    }
    if (
        gesture.invalidated ||
        (gesture.previewValue !== undefined && !gesture.runtimeAuthority.canCommit()) ||
        !readGestureDevice(gesture, true)
    ) {
        cancelGesture(context, gesture);
        if (!isTransient) {
            context.gestureRef.current = null;
        }
        notifyUser('Device parameter target changed; edit was not applied', 'warning');
        return;
    }
    if (!Number.isFinite(nextValue)) {
        cancelGesture(context, gesture);
        return;
    }
    // Knob release is a physical recording sample; slider settlement is not.
    // Capture event time before the canonical action can wait on a snapshot.
    const previewOptions: NonNullable<Parameters<typeof setDeviceParameter>[3]> = {
        transient: true,
        runtimeOwner: gesture.runtimeAuthority.owner,
        automationRecordingOwner: gesture.recordingAuthority.owner,
    };
    if (!recordingSample) {
        previewOptions.automationRecordingPolicy = 'suppressed';
    }
    gesture.previewValue = nextValue;
    try {
        if (!setDeviceParameter(gesture.deviceId, gesture.paramId, nextValue, previewOptions)) {
            cancelGesture(context, gesture);
            return;
        }
        if (readDeviceParameterPreview(gesture.previewKey)?.owner !== gesture.runtimeAuthority.owner) {
            acquireDeviceParameterPreview(
                gesture.previewKey,
                gesture.runtimeAuthority.owner,
                () => !gesture.invalidated && gesture.runtimeAuthority.canCommit() && !!readGestureDevice(gesture, true)
            );
        }
        updateDeviceParameterPreview(gesture.previewKey, gesture.runtimeAuthority.owner, nextValue);
    } catch (error) {
        cancelGesture(context, gesture);
        notifyUser(error instanceof Error ? error.message : 'Device parameter preview failed', 'error');
        return;
    }
    if (isTransient) {
        return;
    }
    commitGesture(context, gesture, nextValue);
}

function commitGesture(context: GestureContext, gesture: ParameterGesture, nextValue: number): void {
    releaseGestureTouchAutomation(gesture);
    gesture.settling = true;
    void executeUserAppAction(
        {
            type: 'setDeviceParameter',
            payload: {
                deviceId: gesture.deviceId,
                paramId: gesture.paramId,
                value: nextValue,
                // The event already reached the recording owner above.
                // Commit and replay must not record a delayed duplicate.
                automationRecordingPolicy: 'suppressed',
                expectedTrackId: gesture.trackId,
                expectedDeviceType: gesture.deviceType,
                expectedDeviceIds: gesture.deviceIds,
                expectedValuePresent: gesture.valuePresent,
                expectedValue: gesture.value,
                expectedTrackFrozen: gesture.frozen,
            },
        },
        {
            shouldExecute: () =>
                gesture.authority.isCurrent() &&
                captureProjectRootIdentity() === gesture.rootIdentity &&
                ownsDeviceParameterPreview(gesture.previewKey, gesture.runtimeAuthority.owner),
            deviceParameterRuntimeAuthority: {
                trackId: gesture.trackId,
                deviceId: gesture.deviceId,
                paramId: gesture.paramId,
                owner: gesture.runtimeAuthority.owner,
                isCurrent: gesture.runtimeAuthority.canCommit,
            },
            onCommitted: () => {
                gesture.committed = true;
            },
        }
    ).then(
        () => finishGesture(context, gesture),
        (error: unknown) => {
            finishGesture(context, gesture);
            notifyUser(error instanceof Error ? error.message : 'Device parameter change failed', 'error');
        }
    );
}

function isGestureCurrent(context: GestureContext, token: string | number): boolean {
    const gesture = context.gestureRef.current;
    return (
        gesture?.id === token &&
        !gesture.invalidated &&
        gesture.runtimeAuthority.canCommit() &&
        !!readGestureDevice(gesture, true)
    );
}

function cancel(context: GestureContext): void {
    const gesture = context.gestureRef.current;
    if (gesture) {
        cancelGesture(context, gesture);
    }
}

function settleGesture(context: GestureContext): void {
    const gesture = context.gestureRef.current;
    if (!gesture || gesture.invalidated || gesture.settling) {
        return;
    }
    if (!gesture.runtimeAuthority.canCommit() || !readGestureDevice(gesture, true)) {
        cancelGesture(context, gesture);
        return;
    }
    const nextValue = gesture.previewValue;
    if (nextValue === undefined || nextValue === (gesture.value ?? gesture.defaultValue)) {
        releaseGestureTouchAutomation(gesture);
        finishGesture(context, gesture);
        return;
    }
    commitGesture(context, gesture, nextValue);
}
function syncGestureTarget(context: GestureContext): void {
    const { trackId, device, param } = context;
    const gesture = context.gestureRef.current;
    if (
        gesture &&
        !gesture.invalidated &&
        !gesture.settling &&
        (gesture.trackId !== trackId ||
            gesture.deviceId !== device.id ||
            gesture.paramId !== param.id ||
            !readGestureDevice(gesture, true))
    ) {
        cancelGesture(context, gesture);
        if (gesture.previewValue !== undefined) {
            notifyUser('Device parameter target changed; edit was not applied', 'warning');
        }
    }
    context.cancelOnUnmount.current = () => {
        const current = context.gestureRef.current;
        if (current) {
            cancelGesture(context, current);
        }
    };
}

export function useDeviceParameterGesture({ param, device, trackId }: GestureProps) {
    useStore(trackStore, { tracks: [], selectedTrackId: null });
    const gestureRef = useRef<ParameterGesture | null>(null);
    const gestureSequence = useRef(0);
    const [gestureOwner, setGestureOwner] = useState<number | undefined>(undefined);
    const mounted = useRef(true);
    const cancelOnUnmount = useRef<() => void>(() => undefined);
    const previewKey = JSON.stringify([captureProjectRootIdentity(), trackId, device.id, param.id]);
    const preview = useSyncExternalStore(
        (listener) => subscribeDeviceParameterPreview(previewKey, listener),
        () => readDeviceParameterPreview(previewKey)
    );
    const previewValue = preview?.isCurrent() ? preview.value : undefined;
    const value = previewValue ?? device.parameterValues[param.id] ?? param.value;
    const context: GestureContext = {
        param,
        device,
        trackId,
        gestureRef,
        gestureSequence,
        mounted,
        cancelOnUnmount,
        setGestureOwner,
        previewKey,
    };
    useLayoutEffect(() => syncGestureTarget(context));
    useLayoutEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            cancelOnUnmount.current();
        };
    }, []);
    return {
        value,
        previewValue,
        gestureOwner,
        startGesture: () => startGesture(context),
        isGestureCurrent: (token: string | number) => isGestureCurrent(context, token),
        change: (nextValue: number, isTransient = false, recordingSample = true) =>
            handleKnobChange(context, nextValue, isTransient, recordingSample),
        settleGesture: () => settleGesture(context),
        cancel: () => cancel(context),
    };
}
