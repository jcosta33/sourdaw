import {
    type DurableAssetCommitDisposition,
    type DurableAssetCommitProof,
} from '../repositories/durableAssetRepository';

type DurableAssetCommitProofProvider = {
    getDisposition: (
        proof: DurableAssetCommitProof
    ) => DurableAssetCommitDisposition | Promise<DurableAssetCommitDisposition>;
};

let registeredProvider: DurableAssetCommitProofProvider | null = null;

export function configureDurableAssetCommitProof(nextProvider: DurableAssetCommitProofProvider): void {
    registeredProvider = nextProvider;
}

export const durableAssetCommitProof = {
    /**
     * Reading before registration throws rather than answering `unknown`: an
     * unknown disposition makes the caller treat a committed asset as possibly
     * not committed.
     */
    getDisposition(proof: DurableAssetCommitProof): Promise<DurableAssetCommitDisposition> {
        if (registeredProvider === null) {
            throw new Error(
                'durableAssetCommitProof.getDisposition: the durable asset commit proof is not registered; call configureDurableAssetCommitProof() from #/app/bootstrap (bootstrap does this)'
            );
        }
        return Promise.resolve(registeredProvider.getDisposition(proof));
    },
};
