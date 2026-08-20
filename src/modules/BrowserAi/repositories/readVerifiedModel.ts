import { inject } from '#/infra/di/inject';

import { deleteModel } from './deleteModel';
import { readModel } from './readModel';
import { sha256ArrayBuffer } from './sha256ArrayBuffer';

type ReadVerifiedModelInput = {
    family: string;
    modelId: string;
    sha256: string;
    sizeBytes: number;
};

export const readVerifiedModel = inject({ deleteModel, readModel, sha256ArrayBuffer })(
    ({ deleteModel, readModel, sha256ArrayBuffer }) =>
        async function readVerifiedModel({
            family,
            modelId,
            sha256,
            sizeBytes,
        }: ReadVerifiedModelInput): Promise<ArrayBuffer | null> {
            const modelData = await readModel({ family, modelId });
            if (!modelData) {
                return null;
            }

            const validSize = modelData.byteLength === sizeBytes;
            const validDigest = validSize && (await sha256ArrayBuffer(modelData)) === sha256;
            if (!validDigest) {
                await deleteModel({ family, modelId });
                return null;
            }

            return modelData;
        }
);
