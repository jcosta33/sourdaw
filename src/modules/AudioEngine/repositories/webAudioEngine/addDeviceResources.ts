import type { DeviceRuntimeResources } from './countDeviceRuntimeResources';

export function addDeviceResources(target: DeviceRuntimeResources, resources: DeviceRuntimeResources): void {
    target.audioNodes += resources.audioNodes;
    target.audioWorkletProcessors += resources.audioWorkletProcessors;
    target.workers += resources.workers;
}
