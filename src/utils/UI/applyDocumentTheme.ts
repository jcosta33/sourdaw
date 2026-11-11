type DocumentTheme = 'dark' | 'light';

const THEME_COLORS: Record<DocumentTheme, string> = {
    dark: '#020100',
    light: '#ded8cf',
};

function applyTheme(target: Document, theme: DocumentTheme): void {
    const root = target.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.classList.toggle('light', theme === 'light');
    root.style.colorScheme = theme;
    target.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
    root.style.visibility = 'visible';
}

export function applyDocumentTheme(theme: DocumentTheme, target: Window = window): void {
    applyTheme(target.document, theme);
    if (target.parent === target) {
        return;
    }
    try {
        applyTheme(target.parent.document, theme);
    } catch {
        // Cross-origin browser hosts do not expose their document.
    }
}
