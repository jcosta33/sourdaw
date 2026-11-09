(() => {
    let theme = 'dark';
    try {
        const stored = JSON.parse(window.localStorage.getItem('sourdaw-preferences') ?? 'null');
        if (stored?.json?.theme === 'light') {
            theme = 'light';
        }
    } catch {
        // Storage denial and corrupt preferences retain the dark default.
    }
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.classList.toggle('light', theme === 'light');
    root.style.colorScheme = theme;
    document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', theme === 'light' ? '#ded8cf' : '#020100');
})();
