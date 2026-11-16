const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);
const NETWORK_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'ws:', 'wss:']);
const LOCAL_BASE = 'http://localhost/';

export type ProviderHostGuard = {
    /** Every URL a guarded transport was asked to reach on a non-local host, in order. */
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
 * Refuses fetch, XMLHttpRequest and WebSocket to every non-local network origin, recording each
 * attempt: no acceptance run may reach a real model, whatever host a provider, artifact manifest or
 * user configuration names. Local hosts, non-network schemes and relative URLs pass through to the
 * transport that was installed before the guard.
 */
export function installProviderHostGuard(): ProviderHostGuard {
    const attempts: string[] = [];
    const refusal = (url: string): Error | null => {
        let parsed: URL;
        try {
            parsed = new URL(url, LOCAL_BASE);
        } catch {
            return null;
        }
        if (!NETWORK_PROTOCOLS.has(parsed.protocol) || LOCAL_HOSTNAMES.has(parsed.hostname)) {
            return null;
        }
        attempts.push(url);
        return new TypeError(`An acceptance run reached the remote host ${parsed.host}.`);
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
