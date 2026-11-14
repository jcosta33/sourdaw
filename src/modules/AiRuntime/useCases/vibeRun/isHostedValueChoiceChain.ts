import { getBackendChain } from '../llmOrchestration/backendResolution/getBackendChain';

/** Value choice runs only where every backend the request could reach is hosted; local and Automatic never do. */
export function isHostedValueChoiceChain(): boolean {
    const chain = getBackendChain();
    return chain.length > 0 && chain.every((backend) => backend === 'cloud');
}
