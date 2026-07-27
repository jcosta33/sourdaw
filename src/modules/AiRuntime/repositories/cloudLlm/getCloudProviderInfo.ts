import { type HostedLlmProviderInfo } from '../../models/HostedLlmProvider';
import { hostedLlmProviderStatusStore } from '../../stores/hostedLlmProviderStatusStore';

export function getCloudProviderInfo(): HostedLlmProviderInfo | null {
    return hostedLlmProviderStatusStore.value;
}
