/**
 * The parameter vocabularies the composition root answers for (#3124).
 *
 * A device module that delivers its own live writes into AudioEngine cannot
 * have AudioEngine read its parameter map back, so the body table asks through
 * the runtime sink and this dispatch answers. The cases read the module's own
 * published translation rather than restating names, because a restated table
 * is exactly what would drift from the engine the sampler is welded to.
 */

import { describe, expect, it } from 'vitest';

import { getLevainEngineParameterName } from '#/modules/Levain/useCases';

import { nativeBuiltinParameterName } from '../nativeBuiltinParameterNames';

describe('nativeBuiltinParameterName', () => {
    it('answers the sampler’s own engine name for a project id it addresses', () => {
        expect(nativeBuiltinParameterName({ deviceType: 'levain', paramId: 'masterGain' })).toBe(
            getLevainEngineParameterName({ paramId: 'masterGain' })
        );
        expect(nativeBuiltinParameterName({ deviceType: 'levain', paramId: 'masterGain' })).toBe('master_gain');
    });

    // The id whose engine spelling is not its own, which is what proves the
    // answer comes from the module's translation rather than from a rewrite of
    // the id into snake_case.
    it('answers the engine name for an id spelled differently in project truth', () => {
        expect(nativeBuiltinParameterName({ deviceType: 'levain', paramId: 'humanize' })).toBe('humanize_amount');
    });

    // `null`, not the id itself: the engine refuses a whole
    // `write-device-parameter` batch over one name it cannot resolve, so a
    // caller deciding whether to admit a lane needs the "not addressed" answer.
    it('answers null for an id the sampler does not address', () => {
        expect(nativeBuiltinParameterName({ deviceType: 'levain', paramId: 'bogus' })).toBeNull();
    });

    // Every other native body states its vocabulary in the body table itself,
    // and a type with no native body at all has none to state.
    it('answers null for a body whose vocabulary it does not hold', () => {
        expect(nativeBuiltinParameterName({ deviceType: 'fermenter', paramId: 'oscEngine' })).toBeNull();
        expect(nativeBuiltinParameterName({ deviceType: 'builtin-eq', paramId: 'frequency' })).toBeNull();
    });
});
