/**
 * Import surface of `deviceRecipes.js`, the same role `measurementCensus.d.mts`
 * plays for the census: the type-aware pass does not resolve a `.js` specifier
 * to its JavaScript source (it probes only for a declaration sibling), so this
 * names the contracts the JSDoc annotations in the implementation carry. The
 * instance and module shapes are imported straight from the generated
 * `@wasm-bindgen` declarations rather than restated here. Kept in sync by hand
 * with those annotations.
 */
export const SAMPLE_RATE: number;
export const QUANTUM: number;
export const BUDGET_MS: number;
export const DEVICE_IDS: string[];
export type CostSite = 'audio-thread' | 'worker' | 'offline';
export const COST_SITE: { [deviceId: string]: CostSite | undefined };
export const DUTY_CYCLE: { [deviceId: string]: { periodQuanta: number; source: string } | undefined };
export const RESTRIKE_INTERVAL_QUANTA: number;
export function excitation(frame: number): [number, number];
export function spreadNotes(count: number): number[];
export function loopSample(frames: number): Float32Array;
export type BenchDevice = {
    id: string;
    label: string;
    note: string;
    feed?: ((frame: number) => void) | undefined;
    render: () => number;
    verify: () => { ok: boolean; detail: string };
};
export type SoloReference = {
    feed: (frame: number) => void;
    rms: () => number;
};
export type PointerEffectInstance =
    | import('../../../src/modules/AudioEngine/wasm/daw_dsp').BacteriaInstance
    | import('../../../src/modules/AudioEngine/wasm/daw_dsp').CrustInstance
    | import('../../../src/modules/AudioEngine/wasm/daw_dsp').GlutenInstance
    | import('../../../src/modules/AudioEngine/wasm/daw_dsp').GrinderInstance
    | import('../../../src/modules/AudioEngine/wasm/daw_dsp').KneadInstance
    | import('../../../src/modules/AudioEngine/wasm/daw_dsp').ProofInstance;
export type HeldInstrumentInstance =
    | import('../../../src/modules/AudioEngine/wasm/daw_dsp').CrumbsInstance
    | import('../../../src/modules/AudioEngine/wasm/daw_dsp').GrandBouleInstance
    | import('../../../src/modules/AudioEngine/wasm/daw_dsp').LevainInstance
    | import('../../../src/modules/AudioEngine/wasm/daw_dsp').ToasterInstance;
export type DawDspModule = {
    memory: WebAssembly.Memory;
    BacteriaInstance: typeof import('../../../src/modules/AudioEngine/wasm/daw_dsp').BacteriaInstance;
    CrumbsInstance: typeof import('../../../src/modules/AudioEngine/wasm/daw_dsp').CrumbsInstance;
    CrustInstance: typeof import('../../../src/modules/AudioEngine/wasm/daw_dsp').CrustInstance;
    FermenterInstance: typeof import('../../../src/modules/AudioEngine/wasm/daw_dsp').FermenterInstance;
    GlutenInstance: typeof import('../../../src/modules/AudioEngine/wasm/daw_dsp').GlutenInstance;
    GrandBouleInstance: typeof import('../../../src/modules/AudioEngine/wasm/daw_dsp').GrandBouleInstance;
    GrinderInstance: typeof import('../../../src/modules/AudioEngine/wasm/daw_dsp').GrinderInstance;
    KneadInstance: typeof import('../../../src/modules/AudioEngine/wasm/daw_dsp').KneadInstance;
    LevainInstance: typeof import('../../../src/modules/AudioEngine/wasm/daw_dsp').LevainInstance;
    ProofInstance: typeof import('../../../src/modules/AudioEngine/wasm/daw_dsp').ProofInstance;
    ToasterInstance: typeof import('../../../src/modules/AudioEngine/wasm/daw_dsp').ToasterInstance;
};
export type ProofChamberModule = {
    memory: WebAssembly.Memory;
    ProofChamberInstance: typeof import('../../../src/modules/AudioEngine/wasm/proof_chamber').ProofChamberInstance;
};
export type ScoringModule = {
    memory: WebAssembly.Memory;
    ScoringInstance: typeof import('../../../src/modules/AudioEngine/wasm/scoring').ScoringInstance;
};
export type PointerEffectSpec = {
    id: string;
    label: string;
    note: string;
    instance: PointerEffectInstance;
    module: DawDspModule;
};
export type HeldInstrumentSpec = {
    id: string;
    label: string;
    note: string;
    instance: HeldInstrumentInstance;
    module: DawDspModule;
    struck: number;
    expectSounding?: number | undefined;
    activeVoices?: (() => number) | undefined;
    restrike?: (() => void) | undefined;
    soloReference?: SoloReference | undefined;
};
export type BuildDevicesSpec = {
    dsp: DawDspModule;
    chamber: ProofChamberModule;
    scoring: ScoringModule;
    ring: typeof import('../../../src/modules/AudioEngine/models/GrandBouleRingProtocol');
    publishGrandBouleConsumerClock: typeof import('../../../src/modules/AudioEngine/worklets/grandBouleConsumerClock').publishGrandBouleConsumerClock;
    readBlockAcquire: typeof import('../../../src/modules/AudioEngine/worklets/grandBouleProcessor').readBlockAcquire;
    only?: string | undefined;
    quantaBudget?: number | undefined;
};
export function buildDevices(spec: BuildDevicesSpec): BenchDevice[];
