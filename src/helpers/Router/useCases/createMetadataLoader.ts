/* (c) Copyright Frontify Ltd., all rights reserved. */

import { type useTranslation } from 'react-i18next';

import { type MetadataType } from '../models/MetadataType';

import { setMetadata } from './setMetaTags';

type CreateMetadatasLoaderParam<TLoaderData = unknown> =
    | MetadataType
    | ((t: ReturnType<typeof useTranslation>['t'], data: TLoaderData) => MetadataType)
    | ((t: ReturnType<typeof useTranslation>['t'], data: TLoaderData) => Promise<MetadataType>);

export const createMetadataLoader = <TLoaderData = unknown>(metadatas: CreateMetadatasLoaderParam<TLoaderData>) => {
    return async (t: ReturnType<typeof useTranslation>['t'], loaderData: TLoaderData) => {
        let metadataConfig: MetadataType;

        if (typeof metadatas === 'function') {
            metadataConfig = await Promise.resolve(metadatas(t, loaderData));
        } else {
            metadataConfig = metadatas;
        }

        setMetadata(metadataConfig);
    };
};
