import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The production modules that hold every hosted model provider's base URL and every origin a model
 * artifact downloads from. The guard reads their single-quoted https literals, so a provider added
 * there is refused here without anyone remembering to list it.
 */
const PROVIDER_ORIGIN_SOURCES = [
    'src/modules/AiRuntime/repositories/cloudLlm/setCloudProviderConfig.ts',
    'src/modules/AiRuntime/useCases/cloudApiManagement/configureCloudProvider.ts',
    'src/modules/AiRuntime/repositories/webLlm/webLlmArtifactManifest.ts',
    'src/modules/AiRuntime/repositories/voiceInput/whisperModelArtifact.ts',
] as const;

const HTTPS_LITERAL = /'(https:\/\/[^'\s]+)'/gu;

/** The hosts the production provider base URLs name; a source naming none is a moved constant, never silence. */
export function readProviderHosts(repositoryRoot: string): ReadonlySet<string> {
    const hosts = new Set<string>();
    for (const path of PROVIDER_ORIGIN_SOURCES) {
        const text = readFileSync(resolve(repositoryRoot, path), 'utf8');
        const found = Array.from(text.matchAll(HTTPS_LITERAL), (match) => new URL(match[1] ?? '').host);
        if (found.length === 0) {
            throw new Error(`${path} no longer names a provider base URL the guard can read.`);
        }
        for (const host of found) {
            hosts.add(host);
        }
    }
    return hosts;
}

export type ProviderHostGuard = {
    /** Every URL a guarded transport was asked to reach on a provider host, in order. */
    attempts: () => readonly string[];
    restore: () => void;
};

function requestUrl(input: RequestInfo | URL): string {
    if (typeof input === 'string') {
        return input;
    }
    return input instanceof URL ? input.href : input.url;
}

/**
 * Refuses fetch, XMLHttpRequest and WebSocket to any provider host, recording each attempt: no
 * acceptance run may reach a real model, whatever route asked for it. Other hosts pass through to
 * the transport that was installed before the guard.
 */
export function installProviderHostGuard(hosts: ReadonlySet<string>): ProviderHostGuard {
    const attempts: string[] = [];
    const refusal = (url: string): Error | null => {
        let host: string;
        try {
            host = new URL(url).host;
        } catch {
            return null;
        }
        if (!hosts.has(host)) {
            return null;
        }
        attempts.push(url);
        return new TypeError(`An acceptance run reached the provider host ${host}.`);
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
        const refused = refusal(requestUrl(input));
        return refused === null ? originalFetch(input, init) : Promise.reject(refused);
    };

    const originalOpen = typeof XMLHttpRequest === 'undefined' ? null : XMLHttpRequest.prototype.open;
    if (originalOpen !== null) {
        XMLHttpRequest.prototype.open = function guardedOpen(this: XMLHttpRequest, ...args: unknown[]) {
            const refused = refusal(String(args[1]));
            if (refused !== null) {
                throw refused;
            }
            Reflect.apply(originalOpen, this, args);
        };
    }

    const OriginalWebSocket = typeof WebSocket === 'undefined' ? null : WebSocket;
    if (OriginalWebSocket !== null) {
        globalThis.WebSocket = new Proxy(OriginalWebSocket, {
            construct(target, args: unknown[]) {
                const refused = refusal(String(args[0]));
                if (refused !== null) {
                    throw refused;
                }
                return Reflect.construct(target, args);
            },
        });
    }

    return {
        attempts: () => [...attempts],
        restore: () => {
            globalThis.fetch = originalFetch;
            if (originalOpen !== null) {
                XMLHttpRequest.prototype.open = originalOpen;
            }
            if (OriginalWebSocket !== null) {
                globalThis.WebSocket = OriginalWebSocket;
            }
        },
    };
}
