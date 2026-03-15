/* (c) Copyright Frontify Ltd., all rights reserved. */

import { captureException } from '@sentry/react';
import { afterEach, describe, it, vi, expect } from 'vitest';

import { SentryWriter } from './SentryWriter';

vi.mock(import('@sentry/react'));
const mockedCapture = vi.mocked(captureException);

describe('SentryWriter', () => {
    const writer = new SentryWriter();

    afterEach(() => {
        vi.resetAllMocks();
    });

    describe('error', () => {
        it('should capture an exception', () => {
            const error = new Error('Test message message');

            writer.error(error);

            expect(mockedCapture).toHaveBeenCalledWith(error);
        });
    });
});
