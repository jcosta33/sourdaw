import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { SafeMarkdown, safeUrlTransform } from '../SafeMarkdown';

/**
 * Model-produced content is untrusted. Every view that displays it renders
 * through SafeMarkdown, which applies a strict element allow-list and a
 * URL-scheme guard. These tests pin that the component neutralizes the known
 * exfiltration / injection vectors while leaving benign formatting intact —
 * rendering the real component rather than a copy of its config.
 */
function renderAssistantMarkdown(content: string): HTMLDivElement {
    const { container } = render(<SafeMarkdown>{content}</SafeMarkdown>);
    return container as HTMLDivElement;
}

describe('SafeMarkdown', () => {
    it('drops remote images (no referer/IP exfiltration on render)', () => {
        const container = renderAssistantMarkdown('![tracker](https://attacker.example/pixel.gif)');
        expect(container.querySelector('img')).toBeNull();
    });

    it('does not allow embedded raw HTML img through markdown', () => {
        const container = renderAssistantMarkdown('<img src="https://attacker.example/pixel.gif" />');
        // Raw HTML is off by default (no rehype-raw); the literal text may show
        // but no <img> element is created.
        expect(container.querySelector('img')).toBeNull();
    });

    it('neutralizes javascript: link hrefs', () => {
        const container = renderAssistantMarkdown('[click me](javascript:alert(1))');
        const anchor = container.querySelector('a');
        expect(anchor).not.toBeNull();
        // urlTransform returns '' for disallowed schemes → empty/safe href.
        expect(anchor?.getAttribute('href') ?? '').not.toContain('javascript:');
    });

    it('neutralizes data: URI hrefs', () => {
        const container = renderAssistantMarkdown('[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)');
        const anchor = container.querySelector('a');
        expect(anchor?.getAttribute('href') ?? '').not.toContain('data:');
    });

    it('keeps safe http(s) links', () => {
        const container = renderAssistantMarkdown('[docs](https://example.com/guide)');
        const anchor = container.querySelector('a');
        expect(anchor?.getAttribute('href')).toBe('https://example.com/guide');
    });

    it('renders benign formatting (bold, code, lists, links)', () => {
        const container = renderAssistantMarkdown('**bold** and `code`\n\n- one\n- two');
        expect(container.querySelector('strong')?.textContent).toBe('bold');
        expect(container.querySelector('code')?.textContent).toBe('code');
        expect(container.querySelectorAll('li')).toHaveLength(2);
    });
});

describe('safeUrlTransform', () => {
    it.each([
        ['https://example.com/x', 'https://example.com/x'],
        ['http://example.com', 'http://example.com'],
        ['mailto:a@b.com', 'mailto:a@b.com'],
        ['/relative/path', '/relative/path'],
    ])('allows safe url %s', (input, expected) => {
        expect(safeUrlTransform(input)).toBe(expected);
    });

    it.each([
        ['javascript:alert(1)'],
        ['data:text/html,<script>alert(1)</script>'],
        ['vbscript:msgbox(1)'],
        ['file:///etc/passwd'],
    ])('blocks dangerous url %s', (input) => {
        expect(safeUrlTransform(input)).toBe('');
    });
});
