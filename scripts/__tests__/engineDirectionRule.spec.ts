import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

type CruiserRule = {
    name: string;
    severity: string;
    from: { path: string };
    to: { path: string; dependencyTypes?: string[] };
};

const require = createRequire(import.meta.url);
const mainConfig: { forbidden: CruiserRule[] } = require('../../.dependency-cruiser.cjs');
const typeConfig: { forbidden: CruiserRule[] } = require('../../.dependency-cruiser.types.cjs');

const RULE_NAME = 'engine-no-own-application-layers';

function findRule(config: { forbidden: CruiserRule[] }, name: string): CruiserRule {
    const rule = config.forbidden.find((candidate) => candidate.name === name);
    if (!rule) {
        throw new Error(`No dependency-cruiser rule named ${name}`);
    }
    return rule;
}

/** dependency-cruiser fills `$n` in `to` from the `from` match; a group the match lacks stays literal. */
function substituteGroups(pattern: string, groups: readonly (string | undefined)[]): string {
    return pattern.replace(/\$(\d)/g, (token, index: string) => groups[Number(index)] ?? token);
}

function violates(rule: CruiserRule, from: string, to: string): boolean {
    const fromMatch = new RegExp(rule.from.path).exec(from);
    if (!fromMatch) {
        return false;
    }
    return new RegExp(substituteGroups(rule.to.path, fromMatch)).test(to);
}

describe(RULE_NAME, () => {
    const rule = findRule(mainConfig, RULE_NAME);

    it('is an error in the main cruise and has a type-only twin', () => {
        expect(rule.severity).toBe('error');
        const typeOnly = findRule(typeConfig, `${RULE_NAME}-type-only`);
        expect(typeOnly.severity).toBe('error');
        expect(typeOnly.to.dependencyTypes).toEqual(['type-only']);
        expect(typeOnly.to.path).toBe(rule.to.path);
    });

    it('leaves a group the from match lacks literal', () => {
        expect(substituteGroups('^a/$1/$2/', ['whole', 'M'])).toBe('^a/M/$2/');
    });

    it('rejects an engine file importing its own module use cases, handlers or repositories', () => {
        const from = 'src/modules/AudioEngine/engine/TrackNode.ts';
        expect(violates(rule, from, 'src/modules/AudioEngine/useCases/deviceResolvers/applyParams.ts')).toBe(true);
        expect(violates(rule, from, 'src/modules/AudioEngine/useCases/index.ts')).toBe(true);
        expect(violates(rule, from, 'src/modules/AudioEngine/handlers/getFinalFeatureHandlers.ts')).toBe(true);
        expect(violates(rule, from, 'src/modules/AudioEngine/repositories/applyParams.ts')).toBe(true);
    });

    it('admits engine siblings, own models and stores, and foreign contract barrels', () => {
        const from = 'src/modules/AudioEngine/engine/wasmDeviceRegistry.ts';
        expect(violates(rule, from, 'src/modules/AudioEngine/engine/TrackNode.ts')).toBe(false);
        expect(violates(rule, from, 'src/modules/AudioEngine/models/EngineDeviceCollaborators.ts')).toBe(false);
        expect(violates(rule, from, 'src/modules/AudioEngine/stores/deviceParameterRuntimeWriteOwners.ts')).toBe(false);
        expect(violates(rule, from, 'src/modules/PluginHost/useCases/index.ts')).toBe(false);
    });

    it('admits a use case importing its own engine', () => {
        expect(
            violates(
                rule,
                'src/modules/AudioEngine/useCases/offlineRender/createOfflineAdjustmentBusChain.ts',
                'src/modules/AudioEngine/engine/AdjustmentBusNode.ts'
            )
        ).toBe(false);
    });

    it('does not treat a module whose name extends the engine module as the same module', () => {
        expect(violates(rule, 'src/modules/AudioEngine/engine/a.ts', 'src/modules/AudioEngineX/useCases/x.ts')).toBe(
            false
        );
    });
});
