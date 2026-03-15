/* (c) Copyright Frontify Ltd., all rights reserved. */

import { captureException } from '@sentry/react';

import { type Writer, type WriteErrorParams } from './Writer';

export class SentryWriter implements Writer {
    debug(): void {
        // TODO: in next PR add a way to log to Sentry
    }

    info(): void {
        // TODO: in next PR add a way to log to Sentry
    }

    warn(): void {
        // TODO: in next PR add a way to log to Sentry
    }

    error(...args: WriteErrorParams) {
        captureException(...args);
    }
}
