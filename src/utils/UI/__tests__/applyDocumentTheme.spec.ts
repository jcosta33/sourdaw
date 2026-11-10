import { afterEach, describe, expect, it } from 'vitest';

import { applyDocumentTheme } from '../applyDocumentTheme';

function installThemeColor(target: Document, content: string): void {
    const meta = target.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('content', content);
    target.head.append(meta);
}

function expectTheme(target: Document, theme: 'dark' | 'light', color: string): void {
    expect(target.documentElement.classList.contains(theme)).toBe(true);
    expect(target.documentElement.classList.contains(theme === 'light' ? 'dark' : 'light')).toBe(false);
    expect(target.documentElement.style.colorScheme).toBe(theme);
    expect(target.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', color);
    expect(target.documentElement.style.visibility).toBe('visible');
}

afterEach(() => {
    document.body.replaceChildren();
    for (const meta of document.head.querySelectorAll('meta[name="theme-color"]')) {
        meta.remove();
    }
    document.documentElement.classList.remove('dark', 'light');
    document.documentElement.style.colorScheme = '';
    document.documentElement.style.visibility = '';
});

describe('applyDocumentTheme', () => {
    it('applies a live light-theme switch and reveals the application and its same-origin browser host', () => {
        document.documentElement.classList.add('dark');
        document.documentElement.style.visibility = 'hidden';
        installThemeColor(document, '#020100');
        const frame = document.createElement('iframe');
        document.body.append(frame);
        const childWindow = frame.contentWindow;
        if (childWindow === null) {
            throw new Error('expected the application frame window');
        }
        childWindow.document.documentElement.classList.add('dark');
        childWindow.document.documentElement.style.visibility = 'hidden';
        installThemeColor(childWindow.document, '#020100');

        applyDocumentTheme('light', childWindow);

        expectTheme(childWindow.document, 'light', '#ded8cf');
        expectTheme(document, 'light', '#ded8cf');
    });
});
