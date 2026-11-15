import { type RefObject, useEffect, useState } from 'react';

import { useStoreSelector } from '#/infra/store/useStoreSelector';
import { transportStore } from '#/modules/Transport/stores';
import { readAppliedAutomationValue } from '#/modules/Transport/useCases';

const FOLLOW_INTERVAL_MS = 1000 / 30;

type UseFollowedAutomationValueInput = {
    deviceId: string;
    parameterId: number;
    automated: boolean;
    element: RefObject<HTMLElement | null>;
    /**
     * The parameter's own store object. Its identity changes when an edit or a re-read of the host
     * patches this parameter, which ends the hold on the last followed value.
     */
    settledToken: unknown;
};

type FollowedValue = {
    value: number;
    /** The scheduler's write sequence the value was adopted under. */
    writeSequence: number;
    settledAtRead: unknown;
    /** Whether the latest read delivered a value; false once the lane stops driving the parameter. */
    delivering: boolean;
};

type FollowedAutomationValue = {
    value: number | null;
    following: boolean;
};

/**
 * The value a running automation lane is delivering to a device parameter, for display only.
 *
 * Follows only while the parameter is automated, the transport plays and `element` is on screen. After
 * the transport stops it keeps the last followed value until `settledToken` changes identity, so the
 * row never falls back to a stale store value before the host's real value has been read. A delivered
 * value is adopted whenever the scheduler wrote the parameter since the last adoption (a new write
 * sequence), even if the number is unchanged, because the plugin then holds that value whatever the
 * store says (Play start, seek, loop wrap). With no new write, any newer fact about the parameter (its
 * `settledToken` changing) wins over the held value, so a flat lane segment cannot overwrite a user edit.
 */
export const useFollowedAutomationValue = ({
    deviceId,
    parameterId,
    automated,
    element,
    settledToken,
}: UseFollowedAutomationValueInput): FollowedAutomationValue => {
    const isPlaying = useStoreSelector(transportStore, (state) => state?.isPlaying ?? false);
    const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
    const [followed, setFollowed] = useState<FollowedValue | null>(null);

    useEffect(() => {
        const target = element.current;
        if (!automated || !target || typeof IntersectionObserver === 'undefined') {
            return undefined;
        }
        const observer = new IntersectionObserver((entries) => {
            const latest = entries.at(-1);
            if (latest) {
                setVisible(latest.isIntersecting);
            }
        });
        observer.observe(target);
        return () => observer.disconnect();
    }, [automated, element]);

    const active = automated && isPlaying && visible;

    useEffect(() => {
        if (!active) {
            return undefined;
        }
        const parameterKey = String(parameterId);
        const read = (): void => {
            const applied = readAppliedAutomationValue(deviceId, parameterKey);
            setFollowed((previous) => {
                if (applied === undefined) {
                    return previous === null || !previous.delivering ? previous : { ...previous, delivering: false };
                }
                const { value, writeSequence } = applied;
                if (previous !== null && previous.writeSequence === writeSequence) {
                    // No new scheduler write since the last adoption: a newer store object is a fact the
                    // lane has not contradicted, so it keeps winning over the held value.
                    if (previous.settledAtRead !== settledToken) {
                        return previous;
                    }
                    if (previous.value === value) {
                        return previous.delivering ? previous : { ...previous, delivering: true };
                    }
                }
                return { value, writeSequence, settledAtRead: settledToken, delivering: true };
            });
        };

        let rafId = 0;
        let lastReadAt: number | null = null;
        const loop = (frameTimestamp: number): void => {
            if (lastReadAt === null) {
                read();
                lastReadAt = frameTimestamp;
            } else {
                const elapsed = frameTimestamp - lastReadAt;
                if (elapsed >= FOLLOW_INTERVAL_MS) {
                    read();
                    lastReadAt = frameTimestamp - (elapsed % FOLLOW_INTERVAL_MS);
                }
            }
            rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(rafId);
    }, [active, deviceId, parameterId, settledToken]);

    if (followed === null || followed.settledAtRead !== settledToken) {
        return { value: null, following: false };
    }
    return { value: followed.value, following: active && followed.delivering };
};
