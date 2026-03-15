/* (c) Copyright Frontify Ltd., all rights reserved. */

import { vi, describe, beforeEach, it, expect } from 'vitest';

import { ErrorConsoleWriter } from '#/helpers/Logger/Writer/ErrorConsoleWriter';

import { type Configuration } from '../Configuration/Configuration';

import { Logger } from './Logger';
import { ConsoleWriter } from './Writer/ConsoleWriter';
import { DatadogWriter } from './Writer/DatadogWriter';
import { SentryWriter } from './Writer/SentryWriter';
import { createLogger } from './createLogger';

vi.mock(import('./Logger'));
vi.mock(import('./Writer/ConsoleWriter'));
vi.mock(import('./Writer/DatadogWriter'));
vi.mock(import('./Writer/SentryWriter'));
vi.mock(import('./Writer/ErrorConsoleWriter'));

describe('createLogger', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should use DatadogWriter and SentryWriter in production', () => {
        const configuration = { environment: 'production' } as Configuration;
        createLogger(configuration);
        expect(Logger).toHaveBeenCalledWith([
            expect.any(DatadogWriter),
            expect.any(SentryWriter),
            expect.any(ErrorConsoleWriter),
        ]);
    });

    it('should use ConsoleWriter in non-production', () => {
        const configuration = { environment: 'development' } as Configuration;
        createLogger(configuration);
        expect(Logger).toHaveBeenCalledWith([expect.any(ConsoleWriter)]);
    });
});
