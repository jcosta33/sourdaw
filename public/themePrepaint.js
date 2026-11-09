(() => {
    /** @typedef {Record<string, unknown>} JsonObject */

    /**
     * @param {unknown} value
     * @returns {value is JsonObject}
     */
    const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

    /**
     * Split a SuperJSON path string on unescaped dots, rejecting prototype
     * pollution segments.
     * @param {unknown} path
     * @returns {string[]}
     */
    const parsePath = (path) => {
        if (typeof path !== 'string') {
            throw new TypeError('Invalid SuperJSON path');
        }
        /** @type {string[]} */
        const segments = [];
        let segment = '';
        for (let index = 0; index < path.length; index += 1) {
            const character = path[index];
            if (character === '\\') {
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

    /**
     * @param {unknown} object
     * @param {string[]} path
     * @returns {unknown}
     */
    const getDeep = (object, path) => {
        let value = object;
        for (const key of path) {
            if (!isObject(value) && !Array.isArray(value)) {
                return undefined;
            }
            value = Array.isArray(value) ? value[Number(key)] : value[key];
        }
        return value;
    };

    /**
     * @param {unknown} object
     * @param {string[]} path
     * @param {unknown} value
     */
    const setDeep = (object, path, value) => {
        /** @type {unknown} */
        let parent = object;
        for (let index = 0; index < path.length - 1; index += 1) {
            const key = path[index];
            if (Array.isArray(parent)) {
                parent = parent[Number(key)];
            } else if (isObject(parent)) {
                parent = parent[key];
            } else {
                return;
            }
        }
        const lastKey = path[path.length - 1];
        if (Array.isArray(parent)) {
            parent[Number(lastKey)] = value;
        } else if (isObject(parent)) {
            parent[lastKey] = value;
        }
    };

    /**
     * @param {JsonObject} json
     * @param {unknown} equalities
     */
    const applyNestedEqualities = (json, equalities) => {
        if (!isObject(equalities)) {
            throw new TypeError('Invalid SuperJSON nested equalities');
        }
        for (const [source, targets] of Object.entries(equalities)) {
            if (!Array.isArray(targets)) {
                throw new TypeError('Invalid SuperJSON equality targets');
            }
            const value = getDeep(json, parsePath(source));
            for (const target of /** @type {unknown[]} */ (targets)) {
                setDeep(json, parsePath(target), value);
            }
        }
    };

    let theme = 'dark';
    try {
        /** @type {unknown} */
        const stored = JSON.parse(window.localStorage.getItem('sourdaw-preferences') ?? 'null');
        // SuperJSON value metadata can transform the raw string into a value
        // runtime preferences validation rejects. Referential equalities then
        // apply afterwards, with root aliases stored in a separate tuple entry.
        const json = isObject(stored) ? stored.json : undefined;
        const meta = isObject(stored) ? stored.meta : undefined;
        const values = isObject(meta) ? meta.values : undefined;
        const transformsTheme = Array.isArray(values) || (isObject(values) && Array.isArray(values.theme));
        if (isObject(json) && json.theme === 'light' && !transformsTheme) {
            const equalities = isObject(meta) ? meta.referentialEqualities : undefined;
            if (Array.isArray(equalities)) {
                const rootAliases = /** @type {unknown} */ (equalities[0]);
                const nestedEqualities = /** @type {unknown} */ (equalities[1]);
                if (!Array.isArray(rootAliases)) {
                    throw new TypeError('Invalid SuperJSON root equalities');
                }
                for (const alias of /** @type {unknown[]} */ (rootAliases)) {
                    setDeep(json, parsePath(alias), json);
                }
                if (nestedEqualities !== undefined) {
                    applyNestedEqualities(json, nestedEqualities);
                }
            } else if (equalities !== undefined) {
                applyNestedEqualities(json, equalities);
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
