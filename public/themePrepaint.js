(() => {
    let theme = 'dark';
    try {
        const stored = JSON.parse(window.localStorage.getItem('sourdaw-preferences') ?? 'null');
        // SuperJSON metadata can transform the raw string into a value that
        // runtime preferences validation rejects; only an untransformed string
        // is authoritative for the prepaint.
        if (stored?.json?.theme === 'light' && stored?.meta?.values?.theme === undefined) {
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
