import { type Dispatch, type RefObject, type SetStateAction, useLayoutEffect, useRef, useState } from 'react';

import { useStore } from '#/infra/store/useStore';
import { trackStore } from '#/modules/Arrangement/stores';
import { setDeviceParameter } from '#/modules/Arrangement/useCases';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { captureProjectTransitionAuthority } from '#/modules/Project/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type DeviceParameterView } from '../../models/PluginDescriptorViewTypes';
import { type Device } from '../../models/TrackViewTypes';

type ParameterGesture = {
    id: number;
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
    previewValue?: number;
    invalidated: boolean;
    settling: boolean;
    committed: boolean;
};

type GestureDraft = {
    trackId: string;
    deviceId: string;
    paramId: string;
    value: number;
    valuePresent: boolean;
    startingValue: number | undefined;
    authority: ParameterGesture['authority'];
};

type DeviceParameterGestureContext = {
    param: DeviceParameterView | undefined;
    device: Device;
    trackId: string;
    gestureRef: RefObject<ParameterGesture | null>;
    gestureSequence: RefObject<number>;
    mounted: RefObject<boolean>;
    cancelOnUnmount: RefObject<() => void>;
    setGestureOwner: Dispatch<SetStateAction<number | undefined>>;
    setDraft: Dispatch<SetStateAction<GestureDraft | null>>;
};

function readGestureDevice(gesture: ParameterGesture, requireStartingValue: boolean) {
    if (!gesture.authority.isCurrent()) {
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
    const device = readGestureDevice(gesture, false);
    const value = device?.parameterValues[gesture.paramId] ?? gesture.defaultValue;
    if (device && gesture.previewValue !== undefined && gesture.previewValue !== value) {
        setDeviceParameter(gesture.deviceId, gesture.paramId, value, {
            transient: true,
            automationRecordingPolicy: 'suppressed',
        });
    }
}

type DeviceParameterGestureProps = {
    param: DeviceParameterView | undefined;
    device: Device;
    trackId: string;
};

function cancelDeviceParameterGesture(context: DeviceParameterGestureContext, gesture: ParameterGesture): void {
    if (gesture.invalidated || gesture.settling) {
        return;
    }
    gesture.invalidated = true;
    try {
        restoreGesturePreview(gesture);
    } catch (error) {
        notifyUser(error instanceof Error ? error.message : 'Device parameter preview restoration failed', 'error');
    }
    if (context.mounted.current) {
        if (context.gestureRef.current === gesture) {
            context.setGestureOwner(undefined);
        }
        context.setDraft(null);
    }
}

function syncGestureTarget(context: DeviceParameterGestureContext): void {
    const gesture = context.gestureRef.current;
    if (
        gesture &&
        !gesture.invalidated &&
        !gesture.settling &&
        (gesture.trackId !== context.trackId ||
            gesture.deviceId !== context.device.id ||
            gesture.paramId !== context.param?.id ||
            !readGestureDevice(gesture, true))
    ) {
        cancelDeviceParameterGesture(context, gesture);
        if (gesture.previewValue !== undefined) {
            notifyUser('Device parameter target changed; edit was not applied', 'warning');
        }
    }
    context.cancelOnUnmount.current = () => {
        const current = context.gestureRef.current;
        if (current) {
            cancelDeviceParameterGesture(context, current);
        }
    };
}

function startDeviceParameterGesture(context: DeviceParameterGestureContext): number {
    const { param, device, trackId, gestureRef, gestureSequence } = context;
    if (!param) {
        return -1;
    }
    const previous = gestureRef.current;
    if (previous?.settling) {
        notifyUser('Previous device parameter edit is still applying', 'warning');
        return -1;
    }
    if (previous) {
        cancelDeviceParameterGesture(context, previous);
    }
    const liveOwner = trackStore.value?.tracks.find((track) => track.id === trackId);
    const gesture: ParameterGesture = {
        id: ++gestureSequence.current,
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
        invalidated: false,
        settling: false,
        committed: false,
    };
    gestureRef.current = gesture;
    context.setGestureOwner(gesture.id);
    if (!readGestureDevice(gesture, true)) {
        gesture.invalidated = true;
        notifyUser('Device parameter target changed; edit was not applied', 'warning');
    }
    return gesture.id;
}

function finishDeviceParameterGesture(context: DeviceParameterGestureContext, gesture: ParameterGesture): void {
    if (!gesture.committed) {
        try {
            restoreGesturePreview(gesture);
        } catch (error) {
            notifyUser(error instanceof Error ? error.message : 'Device parameter preview restoration failed', 'error');
        }
    }
    if (context.gestureRef.current === gesture) {
        context.gestureRef.current = null;
        if (context.mounted.current) {
            context.setGestureOwner(undefined);
            context.setDraft(null);
        }
    }
}

function commitDeviceParameterGesture(
    context: DeviceParameterGestureContext,
    gesture: ParameterGesture,
    nextValue: number
): void {
    gesture.settling = true;
    void executeUserAppAction(
        {
            type: 'setDeviceParameter',
            payload: {
                deviceId: gesture.deviceId,
                paramId: gesture.paramId,
                value: nextValue,
                // Physical samples have already reached the recording owner.
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
            shouldExecute: gesture.authority.isCurrent,
            onCommitted: () => {
                gesture.committed = true;
            },
        }
    ).then(
        () => finishDeviceParameterGesture(context, gesture),
        (error: unknown) => {
            finishDeviceParameterGesture(context, gesture);
            notifyUser(error instanceof Error ? error.message : 'Device parameter change failed', 'error');
        }
    );
}

function changeDeviceParameterGesture(
    context: DeviceParameterGestureContext,
    nextValue: number,
    isTransient: boolean,
    recordingSample: boolean
): void {
    if (!context.mounted.current) {
        return;
    }
    if (!context.gestureRef.current) {
        startDeviceParameterGesture(context);
    }
    const gesture = context.gestureRef.current;
    if (!gesture || gesture.settling) {
        return;
    }
    if (gesture.invalidated || !readGestureDevice(gesture, true)) {
        cancelDeviceParameterGesture(context, gesture);
        if (!isTransient) {
            context.gestureRef.current = null;
        }
        notifyUser('Device parameter target changed; edit was not applied', 'warning');
        return;
    }
    if (!Number.isFinite(nextValue)) {
        cancelDeviceParameterGesture(context, gesture);
        return;
    }
    // Knob release is a physical recording sample; slider settlement is not.
    const previewOptions: NonNullable<Parameters<typeof setDeviceParameter>[3]> = { transient: true };
    if (!recordingSample) {
        previewOptions.automationRecordingPolicy = 'suppressed';
    }
    gesture.previewValue = nextValue;
    try {
        if (!setDeviceParameter(gesture.deviceId, gesture.paramId, nextValue, previewOptions)) {
            cancelDeviceParameterGesture(context, gesture);
            return;
        }
        context.setDraft({
            trackId: gesture.trackId,
            deviceId: gesture.deviceId,
            paramId: gesture.paramId,
            value: nextValue,
            valuePresent: gesture.valuePresent,
            startingValue: gesture.value,
            authority: gesture.authority,
        });
    } catch (error) {
        cancelDeviceParameterGesture(context, gesture);
        notifyUser(error instanceof Error ? error.message : 'Device parameter preview failed', 'error');
        return;
    }
    if (!isTransient) {
        commitDeviceParameterGesture(context, gesture, nextValue);
    }
}

function settleDeviceParameterGesture(context: DeviceParameterGestureContext): void {
    const gesture = context.gestureRef.current;
    if (!gesture || gesture.settling || gesture.invalidated) {
        return;
    }
    if (!readGestureDevice(gesture, true)) {
        cancelDeviceParameterGesture(context, gesture);
        return;
    }
    const nextValue = gesture.previewValue;
    if (nextValue === undefined || nextValue === (gesture.value ?? gesture.defaultValue)) {
        finishDeviceParameterGesture(context, gesture);
        return;
    }
    commitDeviceParameterGesture(context, gesture, nextValue);
}

export function useDeviceParameterGesture({ param, device, trackId }: DeviceParameterGestureProps) {
    const trackState = useStore(trackStore, { tracks: [], selectedTrackId: null });
    const owner = trackState.tracks.find((track) => track.id === trackId);
    const gestureRef = useRef<ParameterGesture | null>(null);
    const gestureSequence = useRef(0);
    const [gestureOwner, setGestureOwner] = useState<number | undefined>(undefined);
    const mounted = useRef(true);
    const cancelOnUnmount = useRef<() => void>(() => undefined);
    const [draft, setDraft] = useState<GestureDraft | null>(null);
    const storedValue = param ? (device.parameterValues[param.id] ?? param.value) : undefined;
    const draftCurrent =
        draft &&
        draft.trackId === trackId &&
        draft.deviceId === device.id &&
        draft.paramId === param?.id &&
        draft.authority.isCurrent() &&
        Object.hasOwn(device.parameterValues, draft.paramId) === draft.valuePresent &&
        device.parameterValues[draft.paramId] === draft.startingValue;
    const context: DeviceParameterGestureContext = {
        param,
        device,
        trackId,
        gestureRef,
        gestureSequence,
        mounted,
        cancelOnUnmount,
        setGestureOwner,
        setDraft,
    };

    useLayoutEffect(() => {
        syncGestureTarget(context);
    });
    useLayoutEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            cancelOnUnmount.current();
        };
    }, []);

    const startGesture = (): number => startDeviceParameterGesture(context);
    const change = (nextValue: number, isTransient = false, recordingSample = true): void => {
        changeDeviceParameterGesture(context, nextValue, isTransient, recordingSample);
    };
    const settleGesture = (): void => settleDeviceParameterGesture(context);

    return {
        owner,
        value: draftCurrent ? draft.value : storedValue,
        previewValue: draftCurrent ? draft.value : undefined,
        gestureOwner,
        startGesture,
        isGestureCurrent: (token: string | number): boolean => {
            const gesture = gestureRef.current;
            return gesture?.id === token && !gesture.invalidated && !!readGestureDevice(gesture, true);
        },
        change,
        settleGesture,
        cancel: (): void => {
            const gesture = gestureRef.current;
            if (gesture) {
                cancelDeviceParameterGesture(context, gesture);
            }
        },
    };
}
