import { describe, it, expect } from 'vitest';

import { compileAllFaustModules } from '../compileAllFaustModules';
import { compileFaustDSP } from '../compileFaustDSP';
import { createFaustNode } from '../createFaustNode';
import { getFaustCompilerError } from '../getFaustCompilerError';
import { getFaustModule } from '../getFaustModule';
import { getFaustModules } from '../getFaustModules';
import { isFaustCompilerReady } from '../isFaustCompilerReady';
import { isFaustModule } from '../isFaustModule';
import { registerFaustDSP } from '../registerFaustDSP';

describe('compilerEngine', () => {
    it('should export compileAllFaustModules', () => {
        expect(typeof compileAllFaustModules).toBe('function');
    });
    it('should export compileFaustDSP', () => {
        expect(typeof compileFaustDSP).toBe('function');
    });
    it('should export createFaustNode', () => {
        expect(typeof createFaustNode).toBe('function');
    });
    it('should export getFaustCompilerError', () => {
        expect(typeof getFaustCompilerError).toBe('function');
    });
    it('should export getFaustModule', () => {
        expect(typeof getFaustModule).toBe('function');
    });
    it('should export getFaustModules', () => {
        expect(typeof getFaustModules).toBe('function');
    });
    it('should export isFaustCompilerReady', () => {
        expect(typeof isFaustCompilerReady).toBe('function');
    });
    it('should export isFaustModule', () => {
        expect(typeof isFaustModule).toBe('function');
    });
    it('should export registerFaustDSP', () => {
        expect(typeof registerFaustDSP).toBe('function');
    });

    it('shares registered modules across the query owners', () => {
        const registered = registerFaustDSP('Compiler Engine Test', 'process = _;');

        expect(getFaustModule(registered.id)).toBe(registered);
        expect(getFaustModules()).toContain(registered);
        expect(isFaustModule(registered.id)).toBe(true);
    });
});
