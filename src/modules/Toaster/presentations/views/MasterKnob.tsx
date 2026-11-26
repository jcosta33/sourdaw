import { type ReactElement, useRef, useState } from 'react';

import { RotaryKnob, type GestureAuthority } from '#/components/daw/RotaryKnob';
import { Stack } from '#/components/layout';
import { executeAppActionBatch } from '#/modules/Command/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { captureToasterMasterGainEdit } from '../../useCases/captureToasterMasterGainEdit';
import { captureToasterMasterRuntime } from '../../useCases/captureToasterMasterRuntime';

type MasterGesture = {
    edit: NonNullable<ReturnType<typeof captureToasterMasterGainEdit>>;
    runtime: ReturnType<typeof captureToasterMasterRuntime>;
    preview: number | null;
    frame: number | null;
    applied: number | null;
};

type MasterAction = NonNullable<ReturnType<MasterGesture['edit']['createAction']>>;

async function settleMasterEdit({
    deviceId,
    gesture,
    action,
    isCurrent,
    setPreview,
}: {
    deviceId: string;
    gesture: MasterGesture;
    action: MasterAction;
    isCurrent: () => boolean;
    setPreview: (value: number | null) => void;
}): Promise<void> {
    function restore(): void {
        if (!isCurrent()) {
            return;
        }
        const settled = captureToasterMasterGainEdit(deviceId);
        if (settled) {
            gesture.runtime?.setGain(settled.value);
        }
        setPreview(null);
    }
    try {
        const result = await executeAppActionBatch([action], {
            source: 'manual',
            skipMacroRecording: true,
            shouldExecute: () => gesture.edit.isCurrent() && (gesture.runtime?.isCurrent() ?? true),
        });
        if ('reason' in result) {
            restore();
            notifyUser(`Could not set Toaster Master gain. ${result.reason}`, 'warning');
        }
        if (isCurrent()) {
            setPreview(null);
        }
    } catch {
        restore();
        notifyUser('Could not set Toaster Master gain.', 'error');
    }
}

function scheduleMasterPreview(gesture: MasterGesture, isActive: () => boolean, cancel: () => void): void {
    if (gesture.frame !== null) {
        return;
    }
    gesture.frame = requestAnimationFrame(() => {
        gesture.frame = null;
        if (!isActive()) {
            return;
        }
        if (!gesture.edit.isCurrent()) {
            cancel();
            return;
        }
        if (gesture.preview !== null) {
            gesture.runtime?.setGain(gesture.preview);
            gesture.applied = gesture.preview;
        }
    });
}

function useMasterGesture(deviceId: string) {
    const [preview, setPreview] = useState<number | null>(null);
    const tokenRef = useRef(0);
    const activeRef = useRef<MasterGesture | null>(null);
    const acquire = (): number => {
        const edit = captureToasterMasterGainEdit(deviceId);
        const runtime = captureToasterMasterRuntime(deviceId);
        activeRef.current = edit ? { edit, runtime, preview: null, frame: null, applied: null } : null;
        if (!edit) {
            notifyUser('Could not set Toaster Master gain while the project is changing.', 'warning');
        }
        return ++tokenRef.current;
    };
    const authority: GestureAuthority = {
        acquire,
        isCurrent: (candidate) =>
            candidate === tokenRef.current && !!activeRef.current && (activeRef.current.runtime?.isCurrent() ?? true),
    };
    const cancel = (): void => {
        const gesture = activeRef.current;
        activeRef.current = null;
        tokenRef.current++;
        if (gesture?.frame !== null && gesture?.frame !== undefined) {
            cancelAnimationFrame(gesture.frame);
        }
        if (gesture?.applied !== null && gesture?.applied !== undefined) {
            const settled = captureToasterMasterGainEdit(deviceId);
            if (settled) {
                gesture.runtime?.setGain(settled.value);
            }
        }
        setPreview(null);
    };
    const change = (next: number, transient?: boolean): void => {
        if (!activeRef.current) {
            acquire();
        }
        const gesture = activeRef.current;
        if (
            !gesture ||
            (gesture.runtime && !gesture.runtime.isCurrent()) ||
            (!transient && !gesture.edit.isCurrent())
        ) {
            notifyUser('Could not set Toaster Master gain while the project is changing.', 'warning');
            cancel();
            return;
        }
        gesture.preview = next;
        setPreview(next);
        if (transient) {
            scheduleMasterPreview(gesture, () => activeRef.current === gesture, cancel);
            return;
        }
        if (gesture.frame !== null) {
            cancelAnimationFrame(gesture.frame);
        }
        if (gesture.applied !== next) {
            gesture.runtime?.setGain(next);
        }
        activeRef.current = null;
        const completionToken = tokenRef.current;
        const action = gesture.edit.createAction(next);
        if (!action) {
            setPreview(null);
            return;
        }
        void settleMasterEdit({
            deviceId,
            gesture,
            action,
            isCurrent: () => tokenRef.current === completionToken,
            setPreview,
        });
    };
    return { preview, authority, cancel, change };
}

export const MasterKnob = ({ deviceId, value }: { deviceId: string; value: number }): ReactElement => {
    const { preview, authority, cancel, change } = useMasterGesture(deviceId);
    const displayed = preview ?? value;
    return (
        <Stack align="center" gap={1}>
            <RotaryKnob
                value={displayed}
                onChange={change}
                min={0}
                max={2}
                step={0.01}
                defaultValue={1}
                size="sm"
                paramId="masterGain"
                aria-label="Master"
                gestureAuthority={authority}
                onGestureCancel={cancel}
            />
            <div className="text-center">
                <div className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground/60">Master</div>
                <div className="font-mono text-[9px] text-foreground/85">{Math.round(displayed * 100)}%</div>
            </div>
        </Stack>
    );
};
