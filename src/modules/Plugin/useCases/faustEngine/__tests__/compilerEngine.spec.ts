import { describe, it, expect } from 'vitest';

import * as subject from '../compilerEngine';

describe('compilerEngine', () => {
    it('should export compileAllFaustModules', () => {
        expect(subject.compileAllFaustModules).toBeDefined();
        const time = typeof subject.compileAllFaustModules;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export compileFaustDSP', () => {
        expect(subject.compileFaustDSP).toBeDefined();
        const time = typeof subject.compileFaustDSP;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export createFaustNode', () => {
        expect(subject.createFaustNode).toBeDefined();
        const time = typeof subject.createFaustNode;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export getFaustCompilerError', () => {
        expect(subject.getFaustCompilerError).toBeDefined();
        const time = typeof subject.getFaustCompilerError;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export getFaustModule', () => {
        expect(subject.getFaustModule).toBeDefined();
        const time = typeof subject.getFaustModule;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export getFaustModules', () => {
        expect(subject.getFaustModules).toBeDefined();
        const time = typeof subject.getFaustModules;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export isFaustCompilerReady', () => {
        expect(subject.isFaustCompilerReady).toBeDefined();
        const time = typeof subject.isFaustCompilerReady;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export isFaustModule', () => {
        expect(subject.isFaustModule).toBeDefined();
        const time = typeof subject.isFaustModule;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export registerFaustDSP', () => {
        expect(subject.registerFaustDSP).toBeDefined();
        const time = typeof subject.registerFaustDSP;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
