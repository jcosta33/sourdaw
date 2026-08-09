import { describe, expect, it } from 'vitest';

import { clipTools, deviceTools } from '../ClipAndDevice';

describe('ClipAndDevice tools', () => {
    it('clipTools is non-empty with valid schemas', () => {
        expect(clipTools.length).toBeGreaterThan(0);
        for (const t of clipTools) {
            expect(t.type).toBe('function');
            expect(t.function.name).toBeTruthy();
            expect(t.function.parameters.type).toBe('object');
        }
    });

    it('deviceTools is non-empty with valid schemas', () => {
        expect(deviceTools.length).toBeGreaterThan(0);
        for (const t of deviceTools) {
            expect(t.type).toBe('function');
            expect(t.function.name).toBeTruthy();
            expect(t.function.parameters.type).toBe('object');
        }
    });

    it('includes well-known clip tools', () => {
        const names = clipTools.map((t) => t.function.name);
        expect(names).toContain('renameClip');
        expect(names).not.toContain('glueClips');
        expect(names).not.toContain('setClipLoopLength');
    });

    it('includes well-known device tools', () => {
        const names = deviceTools.map((t) => t.function.name);
        expect(names).toContain('addDevice');
        expect(names).toContain('bypassDevice');
        expect(names).toContain('removeDevice');
    });

    it('all tool names are unique across both arrays', () => {
        const allNames = [...clipTools.map((t) => t.function.name), ...deviceTools.map((t) => t.function.name)];
        expect(new Set(allNames).size).toBe(allNames.length);
    });

    it('every tool has a description', () => {
        for (const t of [...clipTools, ...deviceTools]) {
            expect(t.function.description).toBeTruthy();
        }
    });

    it('every tool has required fields array', () => {
        for (const t of [...clipTools, ...deviceTools]) {
            expect(Array.isArray(t.function.parameters.required)).toBe(true);
        }
    });
});
