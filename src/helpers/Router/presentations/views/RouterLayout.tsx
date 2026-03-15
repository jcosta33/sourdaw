/* (c) Copyright Frontify Ltd., all rights reserved. */

import { type ReactElement, type ReactNode, useLayoutEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouteLoaderData, useMatches } from 'react-router';

import { NavigationLayout } from '#/modules/Navigation/presentations/views/NavigationLayout';

import { setMetadata } from '../../useCases/setMetaTags';
import { getFirstMatchOfHandler } from '../helpers/getFirstMatchOfHandler';

export const RouterLayout = ({ children }: { children: ReactNode }): ReactElement | null => {
    const { t } = useTranslation();
    const matches = useMatches();
    const loaderData = useRouteLoaderData(matches[matches.length - 1].id);

    const matchesWithHandlers = useMemo(
        () => getFirstMatchOfHandler(matches, ['navigationLoader', 'metadataLoader']),
        [matches]
    );

    useLayoutEffect(() => {
        const [navigationMatch, metadataMatch] = matchesWithHandlers;

        if (navigationMatch?.handle.navigationLoader) {
            navigationMatch.handle
                .navigationLoader(
                    {
                        params: navigationMatch.params,
                        pathname: navigationMatch.pathname,
                    },
                    loaderData
                )
                .catch((error) => {
                    console.error('Error loading navigation', error);
                });
        }

        let restoreMeta: Nullable<() => void> = null;

        if (metadataMatch?.handle.metadataLoader) {
            restoreMeta = setMetadata(metadataMatch.handle.metadataLoader(t, loaderData));
        }

        return () => {
            restoreMeta?.();
        };
    }, [loaderData, matchesWithHandlers, t]);

    const [navigationMatch] = matchesWithHandlers;

    if (!navigationMatch?.handle.navigationLoader) {
        return <>{children}</>;
    }

    return <NavigationLayout>{children}</NavigationLayout>;
};
