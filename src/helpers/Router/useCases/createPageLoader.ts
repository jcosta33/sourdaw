/* (c) Copyright Frontify Ltd., all rights reserved. */

import { type LoaderFunctionArgs } from 'react-router';

type CreatePageLoaderParam<TParentLoaderData = never> = (
    args: LoaderFunctionArgs,
    parentLoaderData?: TParentLoaderData
) => boolean | Response | object | null | undefined | Promise<boolean | Response | object | null | undefined>;

export type LoaderData<TLoaderFunction extends CreatePageLoaderParam> = Awaited<ReturnType<TLoaderFunction>>;

export const createPageLoader = <
    TParentLoaderData extends LoaderData<CreatePageLoaderParam>,
    TLoaderFunction extends CreatePageLoaderParam<TParentLoaderData> = CreatePageLoaderParam<TParentLoaderData>,
>(
    loader: TLoaderFunction
): TLoaderFunction => loader;
