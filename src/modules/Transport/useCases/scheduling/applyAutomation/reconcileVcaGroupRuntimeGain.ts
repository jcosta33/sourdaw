import { reconcileVcaRuntimeGain } from './reconcileVcaRuntimeGain';

export function reconcileVcaGroupRuntimeGain(vcaGroupId: string): void {
    reconcileVcaRuntimeGain({ groupIds: [vcaGroupId], trackIds: [] });
}
