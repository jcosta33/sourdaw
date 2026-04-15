/**
 * Vercel Edge Function — model download proxy.
 *
 * Fetches model files from CORS-restricted origins (GitHub releases) server-side
 * and streams them to the browser. Browsers cannot fetch GitHub release assets
 * directly because `release-assets.githubusercontent.com` does not send CORS
 * headers.
 *
 * Usage: GET /api/proxy-model?url=<encoded-url>
 *
 * Allowed origins (whitelist):
 *   - release-assets.githubusercontent.com  (GitHub release downloads)
 *   - objects.githubusercontent.com          (GitHub LFS / raw objects)
 *   - github.com/*/releases/download/*       (release page redirects)
 *
 * All other URLs are rejected with 403.
 */

export const config = { runtime: 'edge' };

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
} as const;

function isAllowed(url: URL): boolean {
    // Any GitHub *.githubusercontent.com CDN subdomain (release-assets, objects, etc.)
    if (url.hostname.endsWith('.githubusercontent.com')) {
        return true;
    }
    // GitHub release page URLs (redirect to CDN above)
    if (url.hostname === 'github.com') {
        return /^\/[^/]+\/[^/]+\/releases\/download\//.test(url.pathname);
    }
    return false;
}

export default async function handler(request: Request): Promise<Response> {
    // Handle CORS preflight immediately — no upstream fetch needed.
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const { searchParams } = new URL(request.url);
    const rawUrl = searchParams.get('url');

    if (!rawUrl) {
        return new Response('Missing url parameter', { status: 400, headers: CORS_HEADERS });
    }

    let target: URL;
    try {
        target = new URL(rawUrl);
    } catch {
        return new Response('Invalid url parameter', { status: 400, headers: CORS_HEADERS });
    }

    if (!isAllowed(target)) {
        return new Response(`URL not in allowlist: ${target.hostname}`, { status: 403, headers: CORS_HEADERS });
    }

    let upstream: Response;
    try {
        upstream = await fetch(target.toString(), {
            headers: { 'User-Agent': 'Sourdaw-Model-Proxy/1.0' },
            redirect: 'follow',
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return new Response(`Upstream fetch failed: ${msg}`, { status: 502, headers: CORS_HEADERS });
    }

    // Validate the final URL after redirect resolution.
    if (upstream.url && upstream.url !== target.toString()) {
        try {
            const finalUrl = new URL(upstream.url);
            if (!isAllowed(finalUrl)) {
                return new Response(`Redirect target not in allowlist: ${finalUrl.hostname}`, {
                    status: 403,
                    headers: CORS_HEADERS,
                });
            }
        } catch {
            return new Response('Invalid redirect target', { status: 403, headers: CORS_HEADERS });
        }
    }

    if (!upstream.ok) {
        return new Response(`Upstream returned ${String(upstream.status)}`, {
            status: upstream.status,
            headers: CORS_HEADERS,
        });
    }

    const headers = new Headers({
        ...CORS_HEADERS,
        'Cache-Control': 'public, max-age=31536000, immutable',
    });

    const contentType = upstream.headers.get('content-type');
    if (contentType) {
        headers.set('Content-Type', contentType);
    }
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) {
        headers.set('Content-Length', contentLength);
    }

    return new Response(upstream.body, { status: 200, headers });
}
