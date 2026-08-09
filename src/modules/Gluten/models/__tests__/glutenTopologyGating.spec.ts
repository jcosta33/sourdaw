import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_PATCH, type GlutenPatch, type GlutenTopology } from '../GlutenPatch';
import {
    GLUTEN_SHARED_CONTROLS,
    GLUTEN_TOPOLOGY_GAPS,
    GLUTEN_TOPOLOGY_LABELS,
    GLUTEN_TOPOLOGY_OWNED_CONTROLS,
    GLUTEN_UNRENDERED_PARAMS,
    glutenControlGate,
} from '../GlutenTopologyGating';

/**
 * The census the panel gates from, welded to the Rust it describes.
 *
 * `GLUTEN_TOPOLOGY_GAPS` is a hand-written table, and a hand-written table of
 * what some other file does *not* do is the kind that rots silently: the day
 * someone gives the FET a `knee` field, nothing would tell the panel to stop
 * greying the knob, and the fix for a dead control would become a permanently
 * dead control. Which is worse, because a user can at least discover that the
 * first one does nothing.
 *
 * So the population is derived here, out of the files production compiles, and
 * compared to the table in both directions. Three sources, none allowed to
 * vouch for another:
 *
 * - the four topology structs' `set_param` arms, read out of the crate;
 * - `GlutenEngine::set_param`'s own arms, which say which names never reach a
 *   topology in the first place;
 * - the worklet's `PARAM_MAP`, which is the camelCase→snake_case translation
 *   every write actually goes through.
 *
 * `crates/daw-dsp/tests/gluten_topology_param_reach.rs` is the layer below
 * this: it *renders* the crate at two values per parameter and compares the
 * output sample for sample, so the arms this file reads are known to mean what
 * their absence implies.
 *
 * ## What this file cannot see
 *
 * `set_param` reach only. There is a second, separate way a Gluten control
 * reaches nothing: `process_block` filters the detector signal
 * (`sc_hpf`/`sc_lpf`/`sc_eq`/`thrust`, and the external sidechain) and then
 * hands it only to `DiodeCompressor::process_sample_with_sc` — the other three
 * topologies call `process_sample`, which derives its own detector from the
 * audio path. Those seven controls have engine-level arms, so no arm-scan can
 * find them, and they are already documented as inactive in
 * `docs/manual/devices/07-gluten.md`. They are a routing defect whose fix is a
 * few lines of Rust rather than a gate, and gating seven controls on three of
 * four topologies days before that lands would be the larger harm. Filed
 * separately; deliberately not in this table.
 */

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../../../');

const ENGINE_SOURCE = 'crates/daw-dsp/src/gluten/engine.rs';
const TOPOLOGY_SOURCES: Record<GlutenTopology, string> = {
    vca: 'crates/daw-dsp/src/gluten/vca.rs',
    opto: 'crates/daw-dsp/src/gluten/opto.rs',
    fet: 'crates/daw-dsp/src/gluten/fet.rs',
    diode: 'crates/daw-dsp/src/gluten/diode.rs',
};
const WORKLET_SOURCE = 'src/modules/AudioEngine/services/glutenProcessor.ts';

function readSource(relativePath: string): string {
    return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * The parameter names one `set_param` has a match arm for.
 *
 * Bounded to the function, because a whole file's string literals are not the
 * same population: `GlutenEngine::set_param`'s `amount` arm *calls*
 * `self.vca.set_param("threshold", …)`, and counting that would file
 * `threshold` as a name the engine handles itself — which would drop it out of
 * the forwarded set and quietly stop the census asking about it on any
 * topology. Arms are matched at line start followed by `=>`, which the nested
 * calls are not.
 */
function readSetParamArms(relativePath: string): Set<string> {
    const source = readSource(relativePath);
    const start = source.indexOf('pub fn set_param');
    expect(start, `${relativePath} must declare set_param`).toBeGreaterThan(-1);

    const body = source.slice(start + 'pub fn set_param'.length);
    const end = /\n {4}(?:pub )?fn /.exec(body)?.index ?? body.length;
    const arms = [...body.slice(0, end).matchAll(/^[ \t]*"([a-z0-9_]+)"\s*=>/gm)];
    return new Set(arms.map((arm) => arm[1]!));
}

/** The worklet's camelCase → snake_case map, read out of the file that performs it. */
function readWireNames(): Map<string, string> {
    const source = readSource(WORKLET_SOURCE);
    const block = /const PARAM_MAP: Record<string, string> = \{([\s\S]*?)\n\};/.exec(source);
    expect(block, `${WORKLET_SOURCE} must declare PARAM_MAP`).not.toBeNull();

    const entries = [...block![1]!.matchAll(/^\s*([A-Za-z0-9_]+):\s*'([a-z0-9_]+)',/gm)];
    return new Map(entries.map((entry) => [entry[1]!, entry[2]!]));
}

const WIRE_NAMES = readWireNames();
const ENGINE_ARMS = readSetParamArms(ENGINE_SOURCE);

function wireName(paramKey: string): string {
    const wire = WIRE_NAMES.get(paramKey);
    expect(wire, `${paramKey} must be in the worklet's PARAM_MAP`).toBeDefined();
    return wire!;
}

/**
 * The shared controls whose writes actually reach a topology struct — the
 * engine's own arms are the ones that never do.
 */
function forwardedSharedControls(): (keyof GlutenPatch)[] {
    return GLUTEN_SHARED_CONTROLS.filter((paramKey) => !ENGINE_ARMS.has(wireName(paramKey)));
}

function censusFor(topology: GlutenTopology): string[] {
    const gap = GLUTEN_TOPOLOGY_GAPS.find((entry) => entry.topology === topology);
    return [...(gap?.params ?? [])].map((param) => String(param.paramKey)).sort();
}

const ALL_TOPOLOGIES: GlutenTopology[] = ['vca', 'opto', 'fet', 'diode'];

describe('Gluten topology gap census', () => {
    it.each(ALL_TOPOLOGIES)('matches the %s struct’s set_param arms exactly', (topology) => {
        const arms = readSetParamArms(TOPOLOGY_SOURCES[topology]);
        const derived = forwardedSharedControls()
            .filter((paramKey) => !arms.has(wireName(paramKey)))
            .map((paramKey) => String(paramKey))
            .sort();

        expect(censusFor(topology)).toEqual(derived);
    });

    it('leaves every topology-owned control answered by its own topology', () => {
        // The Character card's conditionals are the other half of the gating,
        // and they are only correct while each topology really does implement
        // what its own card offers. `feedForward` is the one that goes through
        // the engine, which forwards it to the VCA alone.
        for (const topology of ALL_TOPOLOGIES) {
            const arms = readSetParamArms(TOPOLOGY_SOURCES[topology]);
            for (const paramKey of GLUTEN_TOPOLOGY_OWNED_CONTROLS[topology]) {
                expect(arms.has(wireName(paramKey)), `${topology} must answer ${String(paramKey)}`).toBe(true);
            }
        }
    });

    it('accounts for every name the worklet can send', () => {
        const claimed = new Set<string>([
            ...GLUTEN_SHARED_CONTROLS.map(String),
            ...ALL_TOPOLOGIES.flatMap((topology) => GLUTEN_TOPOLOGY_OWNED_CONTROLS[topology].map(String)),
            ...GLUTEN_UNRENDERED_PARAMS,
        ]);
        const unaccounted = [...WIRE_NAMES.keys()].filter((paramKey) => !claimed.has(paramKey)).sort();

        expect(unaccounted).toEqual([]);
    });

    it('gives every structural row a reason to show the user', () => {
        // A structural row is a claim that no DSP will close it, and the panel
        // prints the claim. One invented to silence a control nobody wants to
        // build would be indistinguishable from a real one without this.
        for (const gap of GLUTEN_TOPOLOGY_GAPS) {
            for (const param of gap.params) {
                if (param.kind === 'structural') {
                    expect(param.note.length, `${gap.topology}/${String(param.paramKey)}`).toBeGreaterThan(40);
                }
            }
        }
    });
});

describe('glutenControlGate', () => {
    const diode: GlutenPatch = { ...DEFAULT_PATCH, topology: 'diode' };

    it('refuses Release on Diode and names Recovery as the reason', () => {
        const gate = glutenControlGate({ patch: diode, paramKey: 'release', controlLabel: 'Release' });

        expect(gate.isInert).toBe(true);
        expect(gate.kind).toBe('structural');
        expect(gate.explanation).toContain('Release does not apply to the Diode topology');
        expect(gate.explanation).toContain('Recovery');
    });

    it('leaves Release live on VCA', () => {
        const gate = glutenControlGate({
            patch: { ...DEFAULT_PATCH, topology: 'vca' },
            paramKey: 'release',
            controlLabel: 'Release',
        });

        expect(gate).toEqual({ isInert: false, kind: null, explanation: null });
    });

    it('leaves Release live on Diode once Stage two runs a topology that reads it', () => {
        // Measured, not assumed: `stage_two_makes_release_audible_on_diode`
        // renders Diode at 50 ms and 3000 ms with the VCA blended in at 50%
        // and gets a max delta of 3.94e-2, against exactly 0 with Stage 2 down.
        const gate = glutenControlGate({
            patch: { ...diode, blendTopology: 'vca', blendAmount: 0.5 },
            paramKey: 'release',
            controlLabel: 'Release',
        });

        expect(gate.isInert).toBe(false);
    });

    it('keeps refusing Release when Stage two runs a topology that is also deaf to it', () => {
        const gate = glutenControlGate({
            patch: { ...diode, blendTopology: 'opto', blendAmount: 0.5 },
            paramKey: 'release',
            controlLabel: 'Release',
        });

        expect(gate.isInert).toBe(true);
        expect(gate.explanation).toContain('the Diode topology, or to the Opto stage behind it');
    });

    it('treats a Stage two amount below the engine’s own threshold as disengaged', () => {
        // `process_block` engages the blend at `blend_amount > 0.001`. A gate
        // that tested against zero would leave a genuinely dead control live.
        const gate = glutenControlGate({
            patch: { ...diode, blendTopology: 'vca', blendAmount: 0.001 },
            paramKey: 'release',
            controlLabel: 'Release',
        });

        expect(gate.isInert).toBe(true);
    });

    it('refuses Ratio on Opto only while Auto gain is off', () => {
        const opto: GlutenPatch = { ...DEFAULT_PATCH, topology: 'opto', autoMakeup: false };

        expect(glutenControlGate({ patch: opto, paramKey: 'ratio', controlLabel: 'Ratio' }).isInert).toBe(true);
        expect(
            glutenControlGate({
                patch: { ...opto, autoMakeup: true },
                paramKey: 'ratio',
                controlLabel: 'Ratio',
            }).isInert
        ).toBe(false);
    });

    it('says "yet" for an unbuilt row and not for a structural one', () => {
        // The two populations get the same interactivity and different words,
        // because "not implemented yet" and "does not apply" tell the user
        // different things about where the product is going.
        const unbuilt = glutenControlGate({ patch: diode, paramKey: 'knee', controlLabel: 'Knee' });
        expect(unbuilt.kind).toBe('unbuilt');
        expect(unbuilt.explanation).toContain('not implemented on the Diode topology yet');

        const structural = glutenControlGate({ patch: diode, paramKey: 'autoRelease', controlLabel: 'Auto rel' });
        expect(structural.explanation).not.toContain('yet');
    });

    it('leaves a control with no census row alone on every topology', () => {
        for (const topology of ALL_TOPOLOGIES) {
            const gate = glutenControlGate({
                patch: { ...DEFAULT_PATCH, topology },
                paramKey: 'threshold',
                controlLabel: 'Threshold',
            });
            expect(gate.isInert, `threshold on ${GLUTEN_TOPOLOGY_LABELS[topology]}`).toBe(false);
        }
    });
});
