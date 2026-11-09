(() => {
    let theme = 'dark';
    try {
        const stored = JSON.parse(window.localStorage.getItem('sourdaw-preferences') ?? 'null');
        // SuperJSON metadata can transform the raw string into a value that
        // runtime preferences validation rejects; only an untransformed string
        // is authoritative for the prepaint.
        const values = stored?.meta?.values;
        const transformsTheme = Array.isArray(values) || Array.isArray(values?.theme);
        const equalities = stored?.meta?.referentialEqualities;
        const targets = Array.isArray(equalities)
            ? equalities
            : typeof equalities === 'object' && equalities !== null
              ? Object.values(equalities)
              : [];
        const malformedTarget = targets.some(
            (path) => !Array.isArray(path) || path.some((segment) => !['string', 'number'].includes(typeof segment))
        );
        const retargetsTheme = targets.some(
            (path) => Array.isArray(path) && (path.length === 0 || (path.length === 1 && path[0] === 'theme'))
        );
        if (stored?.json?.theme === 'light' && !transformsTheme && !malformedTarget && !retargetsTheme) {
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
