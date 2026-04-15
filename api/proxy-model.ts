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

const ALLOWED_HOSTNAMES = new Set([
    'release-assets.githubusercontent.com',
    'objects.githubusercontent.com',
    'github.com',
    'codeload.github.com',
]);

function isAllowed(url: URL): boolean {
    if (!ALLOWED_HOSTNAMES.has(url.hostname)) {
        return false;
    }
    // GitHub releases must be under /*/releases/download/*
    if (url.hostname === 'github.com') {
        return /^\/[^/]+\/[^/]+\/releases\/download\//.test(url.pathname);
    }
    return true;
}

export default async function handler(request: Request): Promise<Response> {
    const { searchParams } = new URL(request.url);
    const rawUrl = searchParams.get('url');

    if (!rawUrl) {
        return new Response('Missing url parameter', { status: 400 });
    }

    let target: URL;
    try {
        target = new URL(rawUrl);
    } catch {
        return new Response('Invalid url parameter', { status: 400 });
    }

    if (!isAllowed(target)) {
        return new Response('URL not in allowlist', { status: 403 });
    }

    const upstream = await fetch(target.toString(), {
        headers: { 'User-Agent': 'Sourdaw-Model-Proxy/1.0' },
        redirect: 'follow',
    });

    // Validate the final URL after redirect resolution — prevents allowlist bypass
    // via a redirect chain (e.g. a GitHub release that redirects off-allowlist).
    if (upstream.url && upstream.url !== target.toString()) {
        try {
            const finalUrl = new URL(upstream.url);
            if (!isAllowed(finalUrl)) {
                return new Response('Redirect target not in allowlist', { status: 403 });
            }
        } catch {
            return new Response('Invalid redirect target', { status: 403 });
        }
    }

    if (!upstream.ok) {
        return new Response(`Upstream returned ${String(upstream.status)}`, { status: upstream.status });
    }

    const headers = new Headers({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers });
    }

    return new Response(upstream.body, { status: 200, headers });
}
