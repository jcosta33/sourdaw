import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readProjectJson, writeProjectJson, removeProjectJson } from '../storageOperations';

describe('storageOperations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        // Reset the internal module state is hard without a factory,
        // but we can test the behavior of the exported functions.
    });

    it('should write and read from cache and localStorage', () => {
        const json = JSON.stringify({ name: 'Test' });
        writeProjectJson(json);
        
        expect(readProjectJson()).toBe(json);
        expect(localStorage.getItem('sourdaw-project')).toBe(json);
    });

    it('should remove project from cache and localStorage', () => {
        writeProjectJson('{}');
        removeProjectJson();
        
        expect(readProjectJson()).toBeNull();
        expect(localStorage.getItem('sourdaw-project')).toBeNull();
    });

    it('should fallback to legacy localStorage if cache is empty', () => {
        const json = JSON.stringify({ name: 'Legacy' });
        localStorage.setItem('sourdaw-project', json);
        
        // Ensure cache is clear (this might be tricky if other tests ran)
        removeProjectJson(); 
        localStorage.setItem('sourdaw-project', json);

        expect(readProjectJson()).toBe(json);
    });
});
