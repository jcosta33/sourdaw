type DocumentTheme = 'dark' | 'light';

const THEME_COLORS: Record<DocumentTheme, string> = {
    dark: '#020100',
    light: '#f0ece5',
};

export function applyDocumentTheme(theme: DocumentTheme): void {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.classList.toggle('light', theme === 'light');
    root.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
}
