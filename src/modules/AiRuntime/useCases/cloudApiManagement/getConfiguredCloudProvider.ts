import { getCloudProviderInfo } from '../../repositories/cloudLlm/getCloudProviderInfo';

export function getConfiguredCloudProvider(): ReturnType<typeof getCloudProviderInfo> {
    return getCloudProviderInfo();
}
