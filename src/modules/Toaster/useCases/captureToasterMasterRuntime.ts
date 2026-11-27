import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { captureNativeBuiltinParameterWriter, getTrackStrip } from '#/modules/AudioEngine/useCases';
import { captureProjectIdentity } from '#/modules/CrdtDocument/stores';
import { getSettledProjectIdentity } from '#/modules/Project/stores';

import { captureToasterDeviceLifetime } from '../stores/toasterStore';

import { findToasterNodeOnStrip } from './toasterParamBridge/findToasterNodeOnStrip';
import { writeToasterKitScalar } from './toasterParamBridge/writeToasterKitScalar';

/** Capture the runtime a Master gesture started on; never retarget its samples. */
export function captureToasterMasterRuntime(deviceId: string): {
    isCurrent: () => boolean;
    setGain: (value: number) => void;
} | null {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return null;
    }
    const { trackId } = target;
    const projectId = getSettledProjectIdentity()?.projectId;
    const projectIdentity = captureProjectIdentity();
    const lifetime = captureToasterDeviceLifetime(deviceId);
    const strip = getTrackStrip(trackId);
    const node = strip && findToasterNodeOnStrip({ strip, deviceId });
    const controls = node?.toasterControls;
    if (!projectId || !lifetime || !strip || !node || !controls?.ready) {
        return null;
    }
    const runtime = { strip, node, controls };
    const writeNative = captureNativeBuiltinParameterWriter(trackId, deviceId);
    function isCurrent(): boolean {
        const currentTarget = resolveEligibleDeviceWriteTarget(deviceId);
        return (
            currentTarget.status === 'eligible' &&
            currentTarget.trackId === trackId &&
            getSettledProjectIdentity()?.projectId === projectId &&
            captureProjectIdentity() === projectIdentity &&
            captureToasterDeviceLifetime(deviceId) === lifetime &&
            getTrackStrip(trackId) === runtime.strip &&
            findToasterNodeOnStrip({ strip: runtime.strip, deviceId }) === runtime.node &&
            runtime.node.toasterControls === runtime.controls &&
            runtime.controls.ready
        );
    }
    return {
        isCurrent,
        setGain: (value) => {
            if (!isCurrent()) {
                return;
            }
            writeToasterKitScalar({
                trackId,
                deviceId,
                controls: runtime.controls,
                name: 'master_gain',
                value,
                native: { kind: 'captured', write: writeNative },
            });
        },
    };
}
