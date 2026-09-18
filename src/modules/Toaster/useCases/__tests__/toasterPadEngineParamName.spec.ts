/**
 * The whole translation `toasterPadEngineParamName` states (#3124), pinned as
 * literal pairs rather than derived from the module: a table read back from
 * itself cannot catch a wrong entry or a dropped one, only a build that fails
 * to import.
 */

import { describe, expect, it } from 'vitest';

import { toasterPadEngineParamName } from '../toasterPadEngineParamName';

describe('toasterPadEngineParamName', () => {
    it.each([
        ['chokeGroup', 'choke_group'],
        ['filterCutoff', 'filter_cutoff'],
        ['filterResonance', 'filter_resonance'],
        ['sendReverb', 'send_reverb'],
        ['sendDelay', 'send_delay'],
        ['engineType', 'engine_type'],
        ['transientAttack', 'transient_attack'],
        ['transientSustain', 'transient_sustain'],
        ['busRoute', 'bus_route'],
        ['volume', 'volume'],
        ['pan', 'pan'],
        ['muted', 'muted'],
        ['soloed', 'soloed'],
        ['tune', 'tune'],
        ['decay', 'decay'],
        ['tone', 'tone'],
        ['drive', 'drive'],
    ] as const)('translates %s to %s', (padField, engineName) => {
        expect(toasterPadEngineParamName(padField)).toBe(engineName);
    });
});
