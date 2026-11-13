/** The public inputs and rows of the browser and Node quantum-cost recipes. */
import type {
    BacteriaInstance,
    CrumbsInstance,
    CrustInstance,
    FermenterInstance,
    GlutenInstance,
    GrandBouleInstance,
    GrinderInstance,
    KneadInstance,
    LevainInstance,
    ProofInstance,
    ToasterInstance,
} from '../../../../public/wasm/daw-dsp/daw_dsp.js';
import type { ProofChamberInstance } from '../../../../public/wasm/proof-chamber/proof_chamber.js';
import type { ScoringInstance } from '../../../../public/wasm/scoring/scoring.js';

export const SAMPLE_RATE: number;
export const QUANTUM: number;
export const BUDGET_MS: number;
export const DEVICE_IDS: string[];
export const COST_SITE: Record<string, string>;
export const DUTY_CYCLE: Record<string, { periodQuanta: number; source: string }>;
export const RESTRIKE_INTERVAL_QUANTA: number;
export function excitation(frame: number): [number, number];
export function spreadNotes(count: number): number[];
export function loopSample(frames: number): Float32Array;

type DspConstructors = {
    BacteriaInstance: typeof BacteriaInstance;
    CrumbsInstance: typeof CrumbsInstance;
    CrustInstance: typeof CrustInstance;
    FermenterInstance: typeof FermenterInstance;
    GlutenInstance: typeof GlutenInstance;
    GrandBouleInstance: typeof GrandBouleInstance;
    GrinderInstance: typeof GrinderInstance;
    KneadInstance: typeof KneadInstance;
    LevainInstance: typeof LevainInstance;
    ProofInstance: typeof ProofInstance;
    ToasterInstance: typeof ToasterInstance;
};
type RingProtocol = {
    GRAND_BOULE_CONTROL_HEADER_BYTES: number;
    GRAND_BOULE_SYNC_INT_COUNT: number;
    GRAND_BOULE_READ_HEAD_IDX: number;
    GRAND_BOULE_WRITE_HEAD_IDX: number;
    GRAND_BOULE_FLUSH_GENERATION_IDX: number;
    GRAND_BOULE_SLEEP_HEAD_IDX: number;
    GRAND_BOULE_RENDER_REQUEST_IDX: number;
    GRAND_BOULE_SYNC_READ_HEAD_IDX: number;
    GRAND_BOULE_CONSUMER_CLOCK_PUBLISHED_IDX: number;
};

/** Dependencies are needed only by the selected rows; omitted dependencies fail if a selected row uses them. */
export type DeviceRecipeInputs = {
    dsp?: Partial<DspConstructors> & { memory: WebAssembly.Memory };
    chamber?: { ProofChamberInstance: typeof ProofChamberInstance; memory: WebAssembly.Memory };
    scoring?: { ScoringInstance: typeof ScoringInstance; memory: WebAssembly.Memory };
    ring?: RingProtocol;
    publishGrandBouleConsumerClock?: (syncInts: Int32Array, contextFrame: number, readHead: number) => void;
    readBlockAcquire?: (
        controlInts: Int32Array,
        leftRing: Float32Array,
        rightRing: Float32Array,
        ringFrames: number,
        out0: Float32Array,
        out1: Float32Array | undefined,
        frames: number
    ) => boolean;
    only?: string;
    quantaBudget?: number;
};

export type DeviceRecipe = {
    id: string;
    label: string;
    note: string;
    feed?: (frame: number) => void;
    render: (frame: number) => number;
    verify: () => { ok: boolean; detail: string };
};

export function buildDevices(inputs: DeviceRecipeInputs): DeviceRecipe[];
