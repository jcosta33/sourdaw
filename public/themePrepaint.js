(() => {
    const parsePath = (path, legacyPaths) => {
        if (typeof path !== 'string') {
            throw new Error('Invalid SuperJSON path');
        }
        const segments = [];
        let segment = '';
        for (let index = 0; index < path.length; index += 1) {
            const character = path[index];
            if (!legacyPaths && character === '\\') {
                const escaped = path[index + 1];
                if (escaped !== '\\' && escaped !== '.') {
                    throw new Error('Invalid SuperJSON path escape');
                }
                segment += escaped;
                index += 1;
            } else if (character === '.') {
                segments.push(segment);
                segment = '';
            } else {
                segment += character;
            }
        }
        segments.push(segment);
        if (segments.some((part) => ['__proto__', 'prototype', 'constructor'].includes(part))) {
            throw new Error('Unsafe SuperJSON path');
        }
        return segments;
    };
    const getDeep = (object, path) => {
        let value = object;
        for (const key of path) {
            value = value[key];
        }
        return value;
    };
    const setDeep = (object, path, value) => {
        let parent = object;
        for (let index = 0; index < path.length - 1; index += 1) {
            const key = path[index];
            parent = Array.isArray(parent) ? parent[Number(key)] : parent?.[key];
        }
        const lastKey = path[path.length - 1];
        if (Array.isArray(parent)) {
            parent[Number(lastKey)] = value;
        } else if (typeof parent === 'object' && parent !== null) {
            parent[lastKey] = value;
        }
    };
    const applyNestedEqualities = (json, equalities, legacyPaths) => {
        if (typeof equalities !== 'object' || equalities === null || Array.isArray(equalities)) {
            throw new Error('Invalid SuperJSON nested equalities');
        }
        for (const [source, targets] of Object.entries(equalities)) {
            if (!Array.isArray(targets)) {
                throw new Error('Invalid SuperJSON equality targets');
            }
            const value = getDeep(json, parsePath(source, legacyPaths));
            for (const target of targets) {
                setDeep(json, parsePath(target, legacyPaths), value);
            }
        }
    };

    let theme = 'dark';
    try {
        const stored = JSON.parse(window.localStorage.getItem('sourdaw-preferences') ?? 'null');
        // SuperJSON value metadata can transform the raw string into a value
        // runtime preferences validation rejects. Referential equalities then
        // apply afterwards, with root aliases stored in a separate tuple entry.
        const json = stored?.json;
        const values = stored?.meta?.values;
        const transformsTheme = Array.isArray(values) || Array.isArray(values?.theme);
        const legacyPaths = (stored?.meta?.v ?? 0) < 1;
        if (typeof json === 'object' && json !== null && !Array.isArray(json) && !transformsTheme) {
            const equalities = stored?.meta?.referentialEqualities;
            if (Array.isArray(equalities)) {
                const [rootAliases, nestedEqualities] = equalities;
                if (!Array.isArray(rootAliases)) {
                    throw new Error('Invalid SuperJSON root equalities');
                }
                for (const alias of rootAliases) {
                    setDeep(json, parsePath(alias, legacyPaths), json);
                }
                if (nestedEqualities !== undefined) {
                    applyNestedEqualities(json, nestedEqualities, legacyPaths);
                }
            } else if (equalities !== undefined) {
                applyNestedEqualities(json, equalities, legacyPaths);
            }
            if (json.theme === 'light') {
                theme = 'light';
            }
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
