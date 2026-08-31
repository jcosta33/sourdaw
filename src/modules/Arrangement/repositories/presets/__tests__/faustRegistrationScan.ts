// Source-text scan of `registerFaustDSP`'s address lists — the addresses that
// actually reach the compiled Faust node (see `FaustDeviceStrategy.setParam`).
// Read as raw text via `import.meta.glob` rather than imported, because
// PluginHost and Synth are outside this module's ownership and cross-module
// imports may only target their contract barrels (`useCases/`, `stores/`,
// `events/`, `presentations/views/`), none of which currently re-export this
// data. Mirrors the source-scanning "class guard" pattern already used in
// `CrdtDocument/useCases/projection/__tests__/projectionCompleteness.spec.ts`
// for the same kind of cross-module-truth problem.
//
// All live registration sites are scanned: PluginHost's `builtinDSP.ts`,
// `registerSupersawUnison.ts`, and Synth's `proSynthInstruments.ts`. Scanning
// only the first would declare Supersaw Unison addresses unreal, so every
// supersaw preset key would read as a stray even though it reaches the DSP.
//
// Shared by the preset-key guard and the descriptor welds (instruments in
// `faustInstrumentPresets.spec.ts`, effects in
// `PluginDescriptors/__tests__/FaustEffectDescriptors.spec.ts`) so they all
// read one registration table instead of three drifting copies of a scanner.
const FAUST_DSP_SOURCE_GLOB = import.meta.glob(
    [
        '/src/modules/PluginHost/useCases/faustEngine/builtinDSP.ts',
        '/src/modules/PluginHost/useCases/faustEngine/registerSupersawUnison.ts',
        '/src/modules/Synth/useCases/proSynthInstruments.ts',
    ],
    {
        query: '?raw',
        import: 'default',
        eager: true,
    }
);

const REGISTER_FAUST_DSP_CALL = /registerFaustDSP\(\s*'([^']+)',\s*\w+,\s*\[([\s\S]*?)\]/g;
// One registered parameter entry. Entries are flat object literals (no nested
// braces), so `[^{}]*` cannot run past an entry's own `}`.
const REGISTERED_PARAM_ENTRY = /\{[^{}]*address:\s*'\/[^/']+\/([^']+)'[^{}]*\}/g;

export type RegisteredFaustParam = {
    min: number;
    max: number;
    defaultValue: number;
    type?: string;
    scaling?: 'log' | 'linear';
};

function numberField(entry: string, field: 'min' | 'max' | 'defaultValue'): number | undefined {
    const match = entry.match(new RegExp(`${field}:\\s*(-?\\d+(?:\\.\\d+)?)`));
    return match?.[1] === undefined ? undefined : Number(match[1]);
}

function scalingOf(entry: string): { scaling?: 'log' | 'linear' } {
    const match = entry.match(/scaling:\s*'(log|linear)'/)?.[1];
    if (match !== 'log' && match !== 'linear') {
        return {};
    }
    return { scaling: match };
}

/** Bargraph entries are meters the compiled node emits, not settable controls. */
export function isOutputMeter(param: RegisteredFaustParam): boolean {
    return param.type?.endsWith('bargraph') ?? false;
}

/**
 * The real, running parameters for each built-in Faust device, keyed the
 * same way `registerFaustDSP` derives its module id (`faust-${lower,
 * hyphenated name}`). This is the ground truth `FaustDeviceStrategy.setParam`
 * actually resolves against — not any TS-side descriptor catalog. F1 — the
 * previous version of this guard checked presets against
 * `FaustEffectDescriptors.ts` instead, which had independently invented a
 * `dry_wet` key for zita-rev1/tape-delay that the compiled node never
 * accepted; two catalogs that drifted the same way passed regardless of
 * what the DSP actually declared.
 *
 * Each entry carries the registered bounds, default, type, and scaling, so a
 * descriptor weld can compare more than ids.
 */
export function scanRealFaustDeviceParams(): Map<string, Map<string, RegisteredFaustParam>> {
    const paramsByDevice = new Map<string, Map<string, RegisteredFaustParam>>();
    for (const source of Object.values(FAUST_DSP_SOURCE_GLOB)) {
        if (!source) {
            throw new Error('Faust DSP source not found via import.meta.glob — check the glob pattern');
        }
        for (const call of source.matchAll(REGISTER_FAUST_DSP_CALL)) {
            const name = call[1];
            const block = call[2];
            if (!name || !block) {
                continue;
            }
            const deviceId = `faust-${name.toLowerCase().replaceAll(/\s+/g, '-')}`;
            const params = paramsByDevice.get(deviceId) ?? new Map<string, RegisteredFaustParam>();
            for (const entry of block.matchAll(REGISTERED_PARAM_ENTRY)) {
                const id = entry[1];
                const text = entry[0];
                const min = numberField(text, 'min');
                const max = numberField(text, 'max');
                const defaultValue = numberField(text, 'defaultValue');
                if (id === undefined || min === undefined || max === undefined || defaultValue === undefined) {
                    throw new Error(`Unparseable registerFaustDSP entry for ${deviceId}: ${text}`);
                }
                const type = text.match(/type:\s*'([^']+)'/)?.[1];
                params.set(id, { min, max, defaultValue, ...(type === undefined ? {} : { type }), ...scalingOf(text) });
            }
            paramsByDevice.set(deviceId, params);
        }
    }
    return paramsByDevice;
}

/** Id-only view of {@link scanRealFaustDeviceParams} for the preset-key guard. */
export function scanRealFaustDeviceParamIds(): Map<string, Set<string>> {
    return new Map([...scanRealFaustDeviceParams()].map(([deviceId, params]) => [deviceId, new Set(params.keys())]));
}
