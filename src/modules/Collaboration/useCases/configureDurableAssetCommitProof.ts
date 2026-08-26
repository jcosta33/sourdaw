import {
    type DurableAssetCommitDisposition,
    type DurableAssetCommitProof,
} from '../repositories/durableAssetRepository';

type DurableAssetCommitProofProvider = {
    getDisposition: (
        proof: DurableAssetCommitProof
    ) => DurableAssetCommitDisposition | Promise<DurableAssetCommitDisposition>;
};

let provider: DurableAssetCommitProofProvider = { getDisposition: () => 'unknown' };

export function configureDurableAssetCommitProof(nextProvider: DurableAssetCommitProofProvider): void {
    provider = nextProvider;
}

export const durableAssetCommitProof = {
    getDisposition(proof: DurableAssetCommitProof): Promise<DurableAssetCommitDisposition> {
        return Promise.resolve(provider.getDisposition(proof));
    },
};
