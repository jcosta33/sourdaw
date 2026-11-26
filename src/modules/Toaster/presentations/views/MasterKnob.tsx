import { type ReactElement, useRef, useState } from 'react';

import { RotaryKnob, type GestureAuthority } from '#/components/daw/RotaryKnob';
import { Stack } from '#/components/layout';
import { executeAppActionBatch } from '#/modules/Command/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { captureToasterMasterGainEdit } from '../../useCases/captureToasterMasterGainEdit';
import { captureToasterMasterRuntime } from '../../useCases/captureToasterMasterRuntime';

export const MasterKnob = ({ deviceId, value }: { deviceId: string; value: number }): ReactElement => {
    const [preview, setPreview] = useState<number | null>(null);
    const token = useRef(0);
    const active = useRef<{
        edit: NonNullable<ReturnType<typeof captureToasterMasterGainEdit>>;
        runtime: ReturnType<typeof captureToasterMasterRuntime>;
        preview: number | null;
        frame: number | null;
        applied: number | null;
    } | null>(null);
    const acquire = (): number => {
        const edit = captureToasterMasterGainEdit(deviceId);
        const runtime = captureToasterMasterRuntime(deviceId);
        active.current = edit ? { edit, runtime, preview: null, frame: null, applied: null } : null;
        if (!edit) notifyUser('Could not set Toaster Master gain while the project is changing.', 'warning');
        return ++token.current;
    };
    const authority: GestureAuthority = {
        acquire,
        isCurrent: (candidate) =>
            candidate === token.current && !!active.current && (active.current.runtime?.isCurrent() ?? true),
    };
    const cancel = (): void => {
        const gesture = active.current;
        active.current = null;
        token.current++;
        if (gesture?.frame !== null && gesture?.frame !== undefined) cancelAnimationFrame(gesture.frame);
        if (gesture?.applied !== null && gesture?.applied !== undefined) {
            const settled = captureToasterMasterGainEdit(deviceId);
            if (settled) gesture.runtime?.setGain(settled.value);
        }
        setPreview(null);
    };
    const change = (next: number, transient?: boolean): void => {
        if (!active.current) acquire();
        const gesture = active.current;
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
            if (gesture.frame === null) {
                gesture.frame = requestAnimationFrame(() => {
                    gesture.frame = null;
                    if (active.current !== gesture) return;
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
            return;
        }
        if (gesture.frame !== null) cancelAnimationFrame(gesture.frame);
        if (gesture.applied !== next) gesture.runtime?.setGain(next);
        active.current = null;
        const completionToken = token.current;
        const action = gesture.edit.createAction(next);
        if (!action) {
            setPreview(null);
            return;
        }
        const restore = (): void => {
            if (token.current !== completionToken) return;
            const settled = captureToasterMasterGainEdit(deviceId);
            if (settled) gesture.runtime?.setGain(settled.value);
            setPreview(null);
        };
        void executeAppActionBatch([action], {
            source: 'manual',
            skipMacroRecording: true,
            shouldExecute: () => gesture.edit.isCurrent() && (gesture.runtime?.isCurrent() ?? true),
        })
            .then((result) => {
                if ('reason' in result) {
                    restore();
                    notifyUser(`Could not set Toaster Master gain. ${result.reason}`, 'warning');
                }
                if (token.current === completionToken) setPreview(null);
            })
            .catch(() => {
                restore();
                notifyUser('Could not set Toaster Master gain.', 'error');
            });
    };
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
