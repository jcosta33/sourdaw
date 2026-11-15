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
    /** Identity changes when the host's parameters are re-read; it ends the hold on the last followed value. */
    settledParameters: readonly unknown[] | undefined;
};

type FollowedValue = {
    value: number;
    settledAtRead: readonly unknown[] | undefined;
};

type FollowedAutomationValue = {
    value: number | null;
    following: boolean;
};

/**
 * The value a running automation lane is delivering to a device parameter, for display only.
 *
 * Follows only while the parameter is automated, the transport plays and `element` is on screen. After
 * the transport stops it keeps the last followed value until `settledParameters` changes identity, so the
 * row never falls back to a stale store value before the host's real value has been read.
 */
export const useFollowedAutomationValue = ({
    deviceId,
    parameterId,
    automated,
    element,
    settledParameters,
}: UseFollowedAutomationValueInput): FollowedAutomationValue => {
    const isPlaying = useStoreSelector(transportStore, (state) => state?.isPlaying ?? false);
    const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
    const [followed, setFollowed] = useState<FollowedValue | null>(null);

    useEffect(() => {
        const target = element.current;
        if (!target || typeof IntersectionObserver === 'undefined') {
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
    }, [element]);

    const active = automated && isPlaying && visible;

    useEffect(() => {
        if (!active) {
            return undefined;
        }
        const parameterKey = String(parameterId);
        const read = (): void => {
            const value = readAppliedAutomationValue(deviceId, parameterKey);
            if (value === undefined) {
                return;
            }
            setFollowed((previous) =>
                previous?.value === value && previous.settledAtRead === settledParameters
                    ? previous
                    : { value, settledAtRead: settledParameters }
            );
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
    }, [active, deviceId, parameterId, settledParameters]);

    if (!automated || followed === null) {
        return { value: null, following: false };
    }
    if (active) {
        return { value: followed.value, following: true };
    }
    if (followed.settledAtRead === settledParameters) {
        return { value: followed.value, following: false };
    }
    return { value: null, following: false };
};
