import { type AutomergeStoragePreparationOptions } from '#/infra/store/storage/createAutomergeStorage';

import { type ProspectiveMutationWorkerRequest } from '../models/ProspectiveMutationWorkerProtocol';

export type NativePreparationSettings = {
    preparationPolicy?: ProspectiveMutationWorkerRequest['preparationPolicy'];
    ownedPath?: AutomergeStoragePreparationOptions['ownedPath'];
};

export function resolveNativePreparationSettings(
    settings: NativePreparationSettings | NativePreparationSettings['preparationPolicy']
): NativePreparationSettings {
    if (typeof settings === 'string') {
        return { preparationPolicy: settings };
    }
    return settings ?? {};
}
