/* (c) Copyright Frontify Ltd., all rights reserved. */

import { type useTranslation } from 'react-i18next';

export type MetadataLoaderArgs = ReturnType<typeof useTranslation>['t'];

export type MetadataType = {
    title?: string;
    description?: string;
    canonical?: string;
    keywords?: string;
};
