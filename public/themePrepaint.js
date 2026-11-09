(() => {
    const isPlainObject = (value) => {
        if (typeof value !== 'object' || value === null) {
            return false;
        }
        const prototype = Object.getPrototypeOf(value);
        return prototype === null || prototype === Object.prototype;
    };
    const parsePath = (path, legacyPaths) => {
        const segments = [];
        let segment = '';
        for (let index = 0; index < path.length; index += 1) {
            const character = path[index];
            if (character === '\\' && path[index + 1] === '.') {
                segment += '.';
                index += 1;
            } else if (!legacyPaths && character === '\\') {
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
        return segments;
    };
    const validatePath = (path) => {
        if (path.some((part) => ['__proto__', 'prototype', 'constructor'].includes(part))) {
            throw new Error('Unsafe SuperJSON path');
        }
    };
    const getNthKey = (value, index) => {
        if (index > value.size) {
            throw new Error('index out of bounds');
        }
        const keys = value.keys();
        while (index > 0) {
            keys.next();
            index -= 1;
        }
        return keys.next().value;
    };
    const getDeep = (object, path) => {
        validatePath(path);
        let value = object;
        for (let index = 0; index < path.length; index += 1) {
            const key = path[index];
            if (value instanceof Set) {
                value = getNthKey(value, Number(key));
            } else if (value instanceof Map) {
                const row = Number(key);
                const type = Number(path[(index += 1)]) === 0 ? 'key' : 'value';
                const rowKey = getNthKey(value, row);
                value = type === 'key' ? rowKey : value.get(rowKey);
            } else {
                value = value[key];
            }
        }
        return value;
    };
    const setDeep = (object, path, mapper) => {
        validatePath(path);
        if (path.length === 0) {
            return mapper(object);
        }
        let parent = object;
        for (let index = 0; index < path.length - 1; index += 1) {
            const key = path[index];
            if (Array.isArray(parent)) {
                parent = parent[Number(key)];
            } else if (isPlainObject(parent)) {
                parent = parent[key];
            } else if (parent instanceof Set) {
                parent = getNthKey(parent, Number(key));
            } else if (parent instanceof Map) {
                if (index === path.length - 2) {
                    break;
                }
                const row = Number(key);
                const type = Number(path[(index += 1)]) === 0 ? 'key' : 'value';
                const rowKey = getNthKey(parent, row);
                parent = type === 'key' ? rowKey : parent.get(rowKey);
            }
        }
        const lastKey = path[path.length - 1];
        if (Array.isArray(parent)) {
            parent[Number(lastKey)] = mapper(parent[Number(lastKey)]);
        } else if (isPlainObject(parent)) {
            parent[lastKey] = mapper(parent[lastKey]);
        } else if (parent instanceof Set) {
            const oldValue = getNthKey(parent, Number(lastKey));
            const newValue = mapper(oldValue);
            if (oldValue !== newValue) {
                parent.delete(oldValue);
                parent.add(newValue);
            }
        } else if (parent instanceof Map) {
            const rowKey = getNthKey(parent, Number(path[path.length - 2]));
            if (Number(lastKey) === 0) {
                const newKey = mapper(rowKey);
                parent.set(newKey, parent.get(rowKey));
                if (newKey !== rowKey) {
                    parent.delete(rowKey);
                }
            } else {
                parent.set(rowKey, mapper(parent.get(rowKey)));
            }
        }
        return object;
    };
    const untransformValue = (value, type) => {
        if (Array.isArray(type)) {
            if (type[0] === 'typed-array') {
                const constructors = {
                    Int8Array,
                    Uint8Array,
                    Int16Array,
                    Uint16Array,
                    Int32Array,
                    Uint32Array,
                    Float32Array,
                    Float64Array,
                    Uint8ClampedArray,
                };
                const Constructor = constructors[type[1]];
                if (Constructor === undefined) {
                    throw new Error('Trying to deserialize unknown typed array');
                }
                return new Constructor(value);
            }
            throw new Error(`Unknown transformation: ${type}`);
        }
        switch (type) {
            case undefined:
            case 'undefined':
                return undefined;
            case 'bigint':
                return BigInt(value);
            case 'Date':
                return new Date(value);
            case 'Error': {
                const error = new Error(value.message, { cause: value.cause });
                error.name = value.name;
                error.stack = value.stack;
                return error;
            }
            case 'regexp': {
                const body = value.slice(1, value.lastIndexOf('/'));
                const flags = value.slice(value.lastIndexOf('/') + 1);
                return new RegExp(body, flags);
            }
            case 'set':
                return new Set(value);
            case 'map':
                return new Map(value);
            case 'number':
                return Number(value);
            case 'URL':
                return new URL(value);
            default:
                throw new Error(`Unknown transformation: ${type}`);
        }
    };
    const applyValueAnnotations = (json, annotations, legacyPaths) => {
        const traverse = (tree, origin) => {
            if (!tree) {
                return;
            }
            if (!Array.isArray(tree)) {
                for (const [key, subtree] of Object.entries(tree)) {
                    traverse(subtree, [...origin, ...parsePath(key, legacyPaths)]);
                }
                return;
            }
            const [nodeValue, children] = tree;
            if (children) {
                for (const [key, child] of Object.entries(children)) {
                    traverse(child, [...origin, ...parsePath(key, legacyPaths)]);
                }
            }
            json = setDeep(json, origin, (value) => untransformValue(value, nodeValue));
        };
        traverse(annotations, []);
        return json;
    };
    const applyReferentialEqualities = (json, annotations, legacyPaths) => {
        const applyNested = (targets, source) => {
            const value = getDeep(json, parsePath(source, legacyPaths));
            for (const target of targets.map((path) => parsePath(path, legacyPaths))) {
                json = setDeep(json, target, () => value);
            }
        };
        if (Array.isArray(annotations)) {
            const [root, other] = annotations;
            root.forEach((path) => {
                json = setDeep(json, parsePath(path, legacyPaths), () => json);
            });
            if (other) {
                for (const [source, targets] of Object.entries(other)) {
                    applyNested(targets, source);
                }
            }
        } else {
            for (const [source, targets] of Object.entries(annotations)) {
                applyNested(targets, source);
            }
        }
        return json;
    };

    let theme = 'dark';
    try {
        const stored = JSON.parse(window.localStorage.getItem('sourdaw-preferences') ?? 'null');
        // SuperJSON transforms every annotated value before applying aliases;
        // unrelated malformed annotations abort decoding just as they do at runtime.
        const legacyPaths = (stored?.meta?.v ?? 0) < 1;
        let decoded = stored?.json;
        if (stored?.meta?.values) {
            decoded = applyValueAnnotations(decoded, stored.meta.values, legacyPaths);
        }
        if (stored?.meta?.referentialEqualities) {
            decoded = applyReferentialEqualities(decoded, stored.meta.referentialEqualities, legacyPaths);
        }
        if (decoded?.theme === 'light') {
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
