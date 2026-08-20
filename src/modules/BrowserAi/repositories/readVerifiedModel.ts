import { inject } from '#/infra/di/inject';

import { readModel } from './readModel';

type ReadVerifiedModelInput = {
    family: string;
    modelId: string;
    sha256: string;
    sizeBytes: number;
};

export const readVerifiedModel = inject({ readModel })(
    ({ readModel }) =>
        async function readVerifiedModel({
            family,
            modelId,
            sha256,
            sizeBytes,
        }: ReadVerifiedModelInput): Promise<MessagePort | null> {
            return readModel({
                family,
                modelId,
                expectedSha256: sha256,
                expectedSizeBytes: sizeBytes,
            });
        }
);
