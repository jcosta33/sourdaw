import { describe, it, expect, beforeEach } from 'vitest';

import { extensionStore } from '../../stores/extension';
import { appendLog, createDawApi } from '../scripting';

function baseState(): NonNullable<typeof extensionStore.value> {
    return {
        installed: [],
        commands: [],
        consoleLog: [],
        editorOpen: false,
        editorContent: '',
    };
}

describe('appendLog', () => {
    beforeEach(() => {
        extensionStore.set(baseState());
    });

    it('should append a console entry and cap length at 100', () => {
        extensionStore.set({
            ...baseState(),
            consoleLog: Array.from({ length: 100 }, (_, i) => ({
                timestamp: 't',
                level: 'info' as const,
                message: String(i),
            })),
        });
        appendLog('warn', 'next');
        expect(extensionStore.value?.consoleLog.length).toBe(100);
        expect(extensionStore.value?.consoleLog.at(-1)?.message).toBe('next');
        expect(extensionStore.value?.consoleLog.at(-1)?.level).toBe('warn');
    });

    it('should not mutate when extension store is empty', () => {
        extensionStore.set(null);
        appendLog('info', 'x');
        expect(extensionStore.value).toBeNull();
    });
});

describe('createDawApi', () => {
    it('should expose version, notify, and executeAction', () => {
        const api = createDawApi();
        expect(api.version).toBe('0.1.0');
        expect(typeof api.notify).toBe('function');
        expect(typeof api.executeAction).toBe('function');
    });
});
