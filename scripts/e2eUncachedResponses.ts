import type { IncomingMessage, OutgoingHttpHeader, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

import { isSourdawE2eServeMode } from './e2eServerIdentity.ts';

/**
 * Chromium drops a tab's network connection after tens of thousands of
 * 304-revalidated module loads in one tab, and reopen specs reload one page
 * over the unbundled dev graph, so the e2e dev server answers every request
 * uncached and without validators: a reload refetches instead of revalidating.
 */
const UNCACHED = 'no-store';
const VALIDATOR_HEADERS = ['etag', 'last-modified'];
const CONDITIONAL_REQUEST_HEADERS = ['if-none-match', 'if-modified-since'];

export type UncachedResponseMiddleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;

function headerEntries(headers: OutgoingHttpHeaders | OutgoingHttpHeader[]): [string, OutgoingHttpHeader][] {
    if (!Array.isArray(headers)) {
        return Object.entries(headers).flatMap(([name, value]): [string, OutgoingHttpHeader][] =>
            value === undefined ? [] : [[name, value]]
        );
    }
    const entries: [string, OutgoingHttpHeader][] = [];
    for (let index = 0; index + 1 < headers.length; index += 2) {
        entries.push([String(headers[index]), headers[index + 1]]);
    }
    return entries;
}

/**
 * Vite's transform middleware sets its validators with `setHeader`, and the
 * public-directory server passes them as `writeHead` arguments, both after
 * this middleware runs; so the rewrite happens when the head is written.
 */
export function createUncachedResponseMiddleware(): UncachedResponseMiddleware {
    return (request, response, next) => {
        for (const name of CONDITIONAL_REQUEST_HEADERS) {
            delete request.headers[name];
        }
        const writeHead = response.writeHead.bind(response);
        response.writeHead = (
            statusCode: number,
            reasonOrHeaders?: string | OutgoingHttpHeaders | OutgoingHttpHeader[],
            headers?: OutgoingHttpHeaders | OutgoingHttpHeader[]
        ) => {
            const reason = typeof reasonOrHeaders === 'string' ? reasonOrHeaders : undefined;
            const passedHeaders = typeof reasonOrHeaders === 'string' ? headers : reasonOrHeaders;
            for (const [name, value] of headerEntries(passedHeaders ?? {})) {
                response.setHeader(name, value);
            }
            for (const name of VALIDATOR_HEADERS) {
                response.removeHeader(name);
            }
            response.setHeader('Cache-Control', UNCACHED);
            return reason === undefined ? writeHead(statusCode) : writeHead(statusCode, reason);
        };
        next();
    };
}

/** Dev server only: the e2e preview serves hashed production chunks, not the module graph. */
export function sourdawE2eUncachedResponsesPlugin(): Plugin {
    return {
        name: 'sourdaw-e2e-uncached-responses',
        apply: (_config, { command, mode }) => command === 'serve' && isSourdawE2eServeMode(mode),
        configureServer(server) {
            server.middlewares.use(createUncachedResponseMiddleware());
        },
    };
}
