/* (c) Copyright Frontify Ltd., all rights reserved. */

import { Configuration } from './Configuration';

export const createConfiguration = () => {
    const windowConfig: Partial<{ -readonly [Key in keyof Configuration]: Configuration[Key] }> = {
        locales: window.APPLICATION_CONFIG.locales,
    };

    if (window.APPLICATION_CONFIG.thirdParty) {
        windowConfig.amplitudeApiKey = window.APPLICATION_CONFIG.thirdParty.amplitude.amplitudeId ?? null;
        windowConfig.amplitudeEnabled = window.APPLICATION_CONFIG.thirdParty.amplitude.enabled ?? false;
        windowConfig.intercomEnabled = window.APPLICATION_CONFIG.thirdParty.intercom.enabled ?? false;
        windowConfig.intercomSettings = window.APPLICATION_CONFIG.thirdParty.intercom.settings ?? {};
        windowConfig.pusherCluster = window.APPLICATION_CONFIG.thirdParty.pusher.cluster ?? null;
        windowConfig.pusherEnabled = window.APPLICATION_CONFIG.thirdParty.pusher.enabled ?? false;
        windowConfig.pusherKey = window.APPLICATION_CONFIG.thirdParty.pusher.key ?? null;
        windowConfig.segmentEnabled = window.APPLICATION_CONFIG.thirdParty.segment.enabled ?? false;
        windowConfig.segmentKey = window.APPLICATION_CONFIG.thirdParty.segment.key ?? null;
        windowConfig.sentryDsn = window.APPLICATION_CONFIG.thirdParty.sentry.dsn ?? null;
        windowConfig.sentryEnabled = window.APPLICATION_CONFIG.thirdParty.sentry.enabled ?? false;
    }

    const envConfig = {
        environment: process.env.NODE_ENV,
    };

    return new Configuration(windowConfig, envConfig);
};
