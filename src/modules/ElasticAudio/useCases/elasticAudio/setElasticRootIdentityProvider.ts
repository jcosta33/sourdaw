import { elasticRootIdentityProviderState } from './elasticRootIdentityProviderState';

/** The composition root supplies the live root epoch reader without importing its domain here. */
export function setElasticRootIdentityProvider(provider: (() => string) | null): void {
    elasticRootIdentityProviderState.captureRootIdentity = provider;
}
