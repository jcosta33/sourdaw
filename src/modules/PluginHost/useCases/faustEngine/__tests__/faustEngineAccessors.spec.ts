import { describe, it, expect, beforeEach } from 'vitest';

import { createAppError } from '#/infra/errors/createAppError';

import { type FaustModule } from '../../../models/FaustEngineTypes';
import { faustEngineState } from '../faustEngineState';
import { getFaustErrorMessage } from '../getFaustErrorMessage';
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

    describe('isFaustModule', () => {
        it('should report false for an unregistered module id', () => {
            expect(isFaustModule('faust-missing')).toBe(false);
        });

        it('should report true for a module registered under its wire id', () => {
            const module = sampleModule('faust-reverb', 'Reverb');
            faustEngineState.modules.set('faust-reverb', module);

            expect(isFaustModule('faust-reverb')).toBe(true);
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
