/* (c) Copyright Frontify Ltd., all rights reserved. */

import { ErrorConsoleWriter } from '#/helpers/Logger/Writer/ErrorConsoleWriter';

import { type Configuration } from '../Configuration/Configuration';

import { Logger } from './Logger';
import { ConsoleWriter } from './Writer/ConsoleWriter';
import { DatadogWriter } from './Writer/DatadogWriter';
import { SentryWriter } from './Writer/SentryWriter';

export const createLogger = (configuration: Configuration) => {
    if (configuration.environment === 'production') {
        return new Logger([new DatadogWriter(), new SentryWriter(), new ErrorConsoleWriter()]);
    }

    return new Logger([new ConsoleWriter()]);
};
