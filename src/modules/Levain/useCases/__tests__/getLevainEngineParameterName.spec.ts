import { describe, expect, it } from 'vitest';

import { getPluginById } from '#/modules/Arrangement/useCases';

import { createDefaultPatch } from '../../models/LevainPatch';
import { getLevainEngineParameterName } from '../getLevainEngineParameterName';
import { getLevainProjectParameterId } from '../getLevainProjectParameterId';
import { projectLevainPatchToEngineParameters } from '../projectLevainPatchToEngineParameters';

describe('getLevainEngineParameterName', () => {
    it('round-trips every engine name the patch projection emits', () => {
        const emitted = projectLevainPatchToEngineParameters(createDefaultPatch());
        expect(emitted.length).toBeGreaterThan(0);

        const roundTripped = emitted.map((parameter) => ({
            engineName: parameter.name,
            resolved: getLevainEngineParameterName({ paramId: getLevainProjectParameterId(parameter.name) }),
        }));

        expect(roundTripped.filter((entry) => entry.resolved !== entry.engineName)).toEqual([]);
    });

    it('resolves the id whose project spelling differs from its engine name', () => {
        // `humanize_amount` is persisted as `humanize`, and the inverse of the
        // real projection is what keeps that exception from rotting in a table.
        expect(getLevainProjectParameterId('humanize_amount')).toBe('humanize');
        expect(getLevainEngineParameterName({ paramId: 'humanize' })).toBe('humanize_amount');
    });

    it('addresses every automatable parameter the descriptor publishes', () => {
        // The descriptor is the automation surface a lane can spell, so an id
        // it publishes and this cannot name is a knob a natively carried strip
        // would ignore while the web strip applies it.
        const published = getPluginById('levain')?.parameters ?? [];
        expect(published.length).toBeGreaterThan(0);

        const unaddressed = published
            .filter((parameter) => parameter.automatable)
            .map((parameter) => parameter.id)
            .filter((paramId) => getLevainEngineParameterName({ paramId }) === null);

        expect(unaddressed).toEqual([]);
    });

    it('resolves the ensemble ids the descriptor publishes beyond the patch', () => {
        // These reach project truth as `parameterValues` and are answered by
        // `LevainEngine::set_param`, but no patch field emits them — the
        // hand-welded half of the table, mirroring the worklet's `PARAM_MAP`.
        expect(getLevainEngineParameterName({ paramId: 'autoDivisiSize' })).toBe('auto_divisi_size');
        expect(getLevainEngineParameterName({ paramId: 'pitchConvergence' })).toBe('pitch_convergence');
    });

    it('answers null for an id no Levain body addresses', () => {
        // Not the id itself: one unresolvable key refuses the whole
        // `write-device-parameter` batch, so a caller needs the refusal.
        expect(getLevainEngineParameterName({ paramId: 'filterCutoff' })).toBeNull();
        expect(getLevainEngineParameterName({ paramId: '' })).toBeNull();
    });
});
