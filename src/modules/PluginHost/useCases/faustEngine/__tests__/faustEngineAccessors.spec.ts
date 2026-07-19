import { describe, it, expect, beforeEach } from 'vitest';

import { createAppError } from '#/infra/errors/createAppError';

import { type FaustModule } from '../../../models/FaustEngineTypes';
import { faustEngineState } from '../faustEngineState';
import { getFaustCompilerError } from '../getFaustCompilerError';
import { getFaustErrorMessage } from '../getFaustErrorMessage';
import { getFaustModule } from '../getFaustModule';
import { getFaustModules } from '../getFaustModules';
import { isFaustCompilerReady } from '../isFaustCompilerReady';
import { isFaustModule } from '../isFaustModule';

function sampleModule(id: string, name: string): FaustModule {
    return {
        id,
        name,
        dspCode: 'process = _;',
        paramDescriptors: [],
        compiled: false,
        isInstrument: false,
        generator: null,
    };
}

describe('faustEngineState accessors', () => {
    beforeEach(() => {
        faustEngineState.modules.clear();
        faustEngineState.compilationPromises.clear();
        faustEngineState.compiler.promise = null;
        faustEngineState.compiler.ready = false;
        faustEngineState.compiler.error = null;
    });

    describe('getFaustCompilerError', () => {
        it('should return null when the compiler has not recorded a failure', () => {
            expect(getFaustCompilerError()).toBeNull();
        });

        it('should return the recorded compiler error message', () => {
            faustEngineState.compiler.error = 'wasm module failed to load';
            expect(getFaustCompilerError()).toBe('wasm module failed to load');
        });
    });

    describe('isFaustCompilerReady', () => {
        it('should be false before the compiler finishes initializing', () => {
            expect(isFaustCompilerReady()).toBe(false);
        });

        it('should be true once the compiler flags ready', () => {
            faustEngineState.compiler.ready = true;
            expect(isFaustCompilerReady()).toBe(true);
        });
    });

    describe('getFaustModule / isFaustModule', () => {
        it('should report null / false for an unregistered module id', () => {
            expect(getFaustModule('faust-missing')).toBeNull();
            expect(isFaustModule('faust-missing')).toBe(false);
        });

        it('should return the registered module by its wire id', () => {
            const module = sampleModule('faust-reverb', 'Reverb');
            faustEngineState.modules.set('faust-reverb', module);

            expect(getFaustModule('faust-reverb')).toBe(module);
            expect(isFaustModule('faust-reverb')).toBe(true);
        });
    });

    describe('getFaustModules', () => {
        it('should return an empty array when nothing is registered', () => {
            expect(getFaustModules()).toEqual([]);
        });

        it('should return every registered module as a fresh array snapshot', () => {
            const reverb = sampleModule('faust-reverb', 'Reverb');
            const chorus = sampleModule('faust-chorus', 'Chorus');
            faustEngineState.modules.set(reverb.id, reverb);
            faustEngineState.modules.set(chorus.id, chorus);

            const first = getFaustModules();
            const second = getFaustModules();

            expect(first).not.toBe(second);
            expect(first.map((module) => module.id).sort()).toEqual(['faust-chorus', 'faust-reverb']);
        });
    });

    describe('getFaustErrorMessage', () => {
        it('should extract the message from an AppError', () => {
            const error = createAppError('FaustCompileError', 'DSP syntax error at line 4');
            expect(getFaustErrorMessage(error)).toBe('DSP syntax error at line 4');
        });

        it('should extract the message from a native Error', () => {
            expect(getFaustErrorMessage(new Error('compiler crashed'))).toBe('compiler crashed');
        });

        it('should stringify non-Error values', () => {
            expect(getFaustErrorMessage('boom')).toBe('boom');
            expect(getFaustErrorMessage({ reason: 'timeout' })).toBe('[object Object]');
        });
    });
});
