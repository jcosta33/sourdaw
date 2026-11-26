import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { captureNativeBuiltinParameterWriter, getTrackStrip } from '#/modules/AudioEngine/useCases';
import { captureProjectIdentity } from '#/modules/CrdtDocument/stores';
import { getSettledProjectIdentity } from '#/modules/Project/stores';

import { captureToasterDeviceLifetime } from '../stores/toasterStore';

import { findToasterNodeOnStrip } from './toasterParamBridge/findToasterNodeOnStrip';

/** Capture the runtime a Master gesture started on; never retarget its samples. */
export function captureToasterMasterRuntime(deviceId: string): {
    isCurrent: () => boolean;
    setGain: (value: number) => void;
} | null {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') return null;
    const projectId = getSettledProjectIdentity()?.projectId;
    const projectIdentity = captureProjectIdentity();
    const lifetime = captureToasterDeviceLifetime(deviceId);
    const strip = getTrackStrip(target.trackId);
    const node = strip && findToasterNodeOnStrip({ strip, deviceId });
    const controls = node?.toasterControls;
    if (!projectId || !lifetime || !strip || !node || !controls?.ready) return null;
    const writeNative = captureNativeBuiltinParameterWriter(target.trackId, deviceId);
    const isCurrent = (): boolean => {
        const currentTarget = resolveEligibleDeviceWriteTarget(deviceId);
        return (
            currentTarget.status === 'eligible' &&
            currentTarget.trackId === target.trackId &&
            getSettledProjectIdentity()?.projectId === projectId &&
            captureProjectIdentity() === projectIdentity &&
            captureToasterDeviceLifetime(deviceId) === lifetime &&
            getTrackStrip(target.trackId) === strip &&
            findToasterNodeOnStrip({ strip, deviceId }) === node &&
            node.toasterControls === controls &&
            controls.ready
        );
    };
    return {
        isCurrent,
        setGain: (value) => {
            if (!isCurrent()) return;
            controls.setParam('master_gain', value);
            writeNative?.({ master_gain: value });
        },
    };
}
