import { afterEach, describe, expect, it } from 'vitest';

import { getTemplates } from '../getTemplates';

describe('getTemplates', () => {
    afterEach(() => {
        Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    });

    it('excludes native-only templates in the browser', () => {
        const ids = getTemplates().map((time) => time.id);
        expect(ids).not.toContain('demo-native-showcase');
    });

    it('includes native-only templates when the Tauri marker is present', () => {
        Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
        const ids = getTemplates().map((time) => time.id);
        expect(ids).toContain('demo-native-showcase');
    });

    it('always includes the empty project template', () => {
        const ids = getTemplates().map((time) => time.id);
        expect(ids).toContain('empty');
    });
});
