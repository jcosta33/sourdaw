import { useLayoutEffect, useRef, useState } from 'react';

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

export function useDeviceParameterGesture({ param, device, trackId }: DeviceParameterGestureProps) {
    const trackState = useStore(trackStore, { tracks: [], selectedTrackId: null });
    const owner = trackState.tracks.find((track) => track.id === trackId);
    const gestureRef = useRef<ParameterGesture | null>(null);
    const gestureSequence = useRef(0);
    const [gestureOwner, setGestureOwner] = useState<number | undefined>(undefined);
    const mounted = useRef(true);
    const cancelOnUnmount = useRef<() => void>(() => undefined);
    const [draft, setDraft] = useState<{
        trackId: string;
        deviceId: string;
        paramId: string;
        value: number;
        valuePresent: boolean;
        startingValue: number | undefined;
        authority: ParameterGesture['authority'];
    } | null>(null);
    const storedValue = param ? (device.parameterValues[param.id] ?? param.value) : undefined;
    const draftCurrent =
        draft &&
        draft.trackId === trackId &&
        draft.deviceId === device.id &&
        draft.paramId === param?.id &&
        draft.authority.isCurrent() &&
        Object.hasOwn(device.parameterValues, draft.paramId) === draft.valuePresent &&
        device.parameterValues[draft.paramId] === draft.startingValue;

    const cancelGesture = (gesture: ParameterGesture): void => {
        if (gesture.invalidated || gesture.settling) {
            return;
        }
        gesture.invalidated = true;
        try {
            restoreGesturePreview(gesture);
        } catch (error) {
            notifyUser(error instanceof Error ? error.message : 'Device parameter preview restoration failed', 'error');
        }
        if (mounted.current) {
            if (gestureRef.current === gesture) {
                setGestureOwner(undefined);
            }
            setDraft(null);
        }
    };

    useLayoutEffect(() => {
        const gesture = gestureRef.current;
        if (
            gesture &&
            !gesture.invalidated &&
            !gesture.settling &&
            (gesture.trackId !== trackId ||
                gesture.deviceId !== device.id ||
                gesture.paramId !== param?.id ||
                !readGestureDevice(gesture, true))
        ) {
            cancelGesture(gesture);
            if (gesture.previewValue !== undefined) {
                notifyUser('Device parameter target changed; edit was not applied', 'warning');
            }
        }
        cancelOnUnmount.current = () => {
            const current = gestureRef.current;
            if (current) {
                cancelGesture(current);
            }
        };
    });
    useLayoutEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            cancelOnUnmount.current();
        };
    }, []);

    const startGesture = (): number => {
        if (!param) {
            return -1;
        }
        const previous = gestureRef.current;
        if (previous?.settling) {
            notifyUser('Previous device parameter edit is still applying', 'warning');
            return -1;
        }
        if (previous) {
            cancelGesture(previous);
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
        setGestureOwner(gesture.id);
        if (!readGestureDevice(gesture, true)) {
            gesture.invalidated = true;
            notifyUser('Device parameter target changed; edit was not applied', 'warning');
        }
        return gesture.id;
    };

    const finishGesture = (gesture: ParameterGesture): void => {
        if (!gesture.committed) {
            try {
                restoreGesturePreview(gesture);
            } catch (error) {
                notifyUser(
                    error instanceof Error ? error.message : 'Device parameter preview restoration failed',
                    'error'
                );
            }
        }
        if (gestureRef.current === gesture) {
            gestureRef.current = null;
            if (mounted.current) {
                setGestureOwner(undefined);
                setDraft(null);
            }
        }
    };

    const commitGesture = (gesture: ParameterGesture, nextValue: number): void => {
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
            () => finishGesture(gesture),
            (error: unknown) => {
                finishGesture(gesture);
                notifyUser(error instanceof Error ? error.message : 'Device parameter change failed', 'error');
            }
        );
    };

    const change = (nextValue: number, isTransient = false, recordingSample = true): void => {
        if (!mounted.current) {
            return;
        }
        if (!gestureRef.current) {
            startGesture();
        }
        const gesture = gestureRef.current;
        if (!gesture || gesture.settling) {
            return;
        }
        if (gesture.invalidated || !readGestureDevice(gesture, true)) {
            cancelGesture(gesture);
            if (!isTransient) {
                gestureRef.current = null;
            }
            notifyUser('Device parameter target changed; edit was not applied', 'warning');
            return;
        }
        if (!Number.isFinite(nextValue)) {
            cancelGesture(gesture);
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
                cancelGesture(gesture);
                return;
            }
            setDraft({
                trackId: gesture.trackId,
                deviceId: gesture.deviceId,
                paramId: gesture.paramId,
                value: nextValue,
                valuePresent: gesture.valuePresent,
                startingValue: gesture.value,
                authority: gesture.authority,
            });
        } catch (error) {
            cancelGesture(gesture);
            notifyUser(error instanceof Error ? error.message : 'Device parameter preview failed', 'error');
            return;
        }
        if (!isTransient) {
            commitGesture(gesture, nextValue);
        }
    };

    const settleGesture = (): void => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.settling || gesture.invalidated) {
            return;
        }
        if (!readGestureDevice(gesture, true)) {
            cancelGesture(gesture);
            return;
        }
        const nextValue = gesture.previewValue;
        if (nextValue === undefined || nextValue === (gesture.value ?? gesture.defaultValue)) {
            finishGesture(gesture);
            return;
        }
        commitGesture(gesture, nextValue);
    };

    return {
        owner,
        value: draftCurrent ? draft.value : storedValue,
        previewValue: draftCurrent ? draft.value : undefined,
        gestureOwner,
        startGesture,
        isGestureCurrent: (token: number): boolean => {
            const gesture = gestureRef.current;
            return gesture?.id === token && !gesture.invalidated && !!readGestureDevice(gesture, true);
        },
        change,
        settleGesture,
        cancel: (): void => {
            const gesture = gestureRef.current;
            if (gesture) {
                cancelGesture(gesture);
            }
        },
    };
}
