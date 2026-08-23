import { type DurableAssetCommitProof } from '../repositories/durableAssetRepository';

type DurableAssetCommitProofProvider = {
    isProven: (proof: DurableAssetCommitProof) => boolean;
};

let provider: DurableAssetCommitProofProvider = { isProven: () => false };

export function configureDurableAssetCommitProof(nextProvider: DurableAssetCommitProofProvider): void {
    provider = nextProvider;
}

export const durableAssetCommitProof = {
    isProven(proof: DurableAssetCommitProof): boolean {
        return provider.isProven(proof);
    },
};
