import { describe, it, expect } from 'vitest';

import * as subject from '../compilerEngine';

describe('compilerEngine', () => {
    it('should export compileAllFaustModules', () => {
        expect(subject.compileAllFaustModules).toBeDefined();
        const t = typeof subject.compileAllFaustModules;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export compileFaustDSP', () => {
        expect(subject.compileFaustDSP).toBeDefined();
        const t = typeof subject.compileFaustDSP;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export createFaustNode', () => {
        expect(subject.createFaustNode).toBeDefined();
        const t = typeof subject.createFaustNode;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export getFaustCompilerError', () => {
        expect(subject.getFaustCompilerError).toBeDefined();
        const t = typeof subject.getFaustCompilerError;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export getFaustModule', () => {
        expect(subject.getFaustModule).toBeDefined();
        const t = typeof subject.getFaustModule;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export getFaustModules', () => {
        expect(subject.getFaustModules).toBeDefined();
        const t = typeof subject.getFaustModules;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export isFaustCompilerReady', () => {
        expect(subject.isFaustCompilerReady).toBeDefined();
        const t = typeof subject.isFaustCompilerReady;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export isFaustModule', () => {
        expect(subject.isFaustModule).toBeDefined();
        const t = typeof subject.isFaustModule;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export registerFaustDSP', () => {
        expect(subject.registerFaustDSP).toBeDefined();
        const t = typeof subject.registerFaustDSP;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
