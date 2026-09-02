import { type ReactElement } from 'react';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Strict allow-list of markdown-derived HTML elements rendered from
 * model-produced (and thus untrusted) content. Raw HTML is already off by
 * default (no rehype-raw), but constraining the element set removes the
 * remaining exfiltration vectors: `img` (referer / IP leak on render) and any
 * `svg` / embedded element are absent here, so they are dropped.
 */
const ALLOWED_MARKDOWN_ELEMENTS: ReadonlyArray<string> = [
    'p',
    'br',
    'strong',
    'em',
    'del',
    'a',
    'code',
    'pre',
    'blockquote',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
];

/**
 * URL scheme allow-list for any surviving URL attribute (e.g. link `href`).
 * Blocks `javascript:`, `data:`, and other dangerous schemes regardless of
 * react-markdown's default; only http(s) and mailto links are kept.
 */
const SAFE_URL_SCHEMES = ['http:', 'https:', 'mailto:'];

export function safeUrlTransform(url: string): string {
    try {
        // Relative URLs (no scheme) resolve against this base and are allowed.
        const parsed = new URL(url, 'https://sourdaw.invalid/');
        return SAFE_URL_SCHEMES.includes(parsed.protocol) ? url : '';
    } catch {
        // Unparseable URL — drop it.
        return '';
    }
}

type SafeMarkdownProps = {
    children: string;
};

/**
 * The single markdown renderer for untrusted model output. Every surface that
 * displays generated text renders through it, so one allow-list and one URL
 * guard cover them all rather than each view re-deriving its own.
 */
export const SafeMarkdown = ({ children }: SafeMarkdownProps): ReactElement => (
    <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        allowedElements={ALLOWED_MARKDOWN_ELEMENTS}
        unwrapDisallowed
        urlTransform={safeUrlTransform}
    >
        {children}
    </ReactMarkdown>
);
