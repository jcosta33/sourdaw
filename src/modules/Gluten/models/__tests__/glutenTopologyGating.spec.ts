import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_PATCH, type GlutenPatch, type GlutenTopology } from '../GlutenPatch';
import {
    GLUTEN_PATCH_STATE_GAPS,
    GLUTEN_SHARED_CONTROLS,
    GLUTEN_TOPOLOGY_GAPS,
    GLUTEN_TOPOLOGY_LABELS,
    GLUTEN_TOPOLOGY_OWNED_CONTROLS,
    GLUTEN_UNRENDERED_PARAMS,
    glutenBlendStage,
    glutenControlGate,
    type GlutenGapLayer,
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
 * ## Three populations, three derivations
 *
 * An arm scan sees one of the three ways a Gluten control reaches nothing, and
 * an earlier revision of this file shipped with only that one — which made the
 * census blind by construction to the other two rather than merely incomplete.
 *
 * - **`set-param`** — derived from the four structs' arms, as above.
 * - **`detector-routing`** — derived too, and from two independent reads of
 *   `engine.rs`: which identifiers `process_block` uses to build `sc_l`/`sc_r`,
 *   and which `set_param` arms touch any of them. The topologies that *read*
 *   the filtered detector come from a third read, of `process_topology`. So
 *   giving the VCA a sidechain-aware entry point deletes ten rows here without
 *   anyone editing this file, and adding a filter stage adds its control to the
 *   population the same way.
 * - **patch state** — not derivable from source at all, because the claim is
 *   about a *value* rather than a name. Its weld is measurement:
 *   `crates/daw-dsp/tests/gluten_routing_and_patch_state_reach.rs` renders each
 *   row's inert state and its live state and compares them.
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

function censusFor(topology: GlutenTopology, layer: GlutenGapLayer): string[] {
    const gap = GLUTEN_TOPOLOGY_GAPS.find((entry) => entry.topology === topology);
    return [...(gap?.params ?? [])]
        .filter((param) => param.layer === layer)
        .map((param) => String(param.paramKey))
        .sort();
}

/** The whole `set_param` match block of `GlutenEngine`, arm by arm. */
function readEngineArmBodies(): Map<string, string> {
    const source = readSource(ENGINE_SOURCE);
    const start = source.indexOf('pub fn set_param');
    const body = source.slice(start + 'pub fn set_param'.length);
    const end = /\n {4}(?:pub )?fn /.exec(body)?.index ?? body.length;
    const block = body.slice(0, end);

    const arms = [...block.matchAll(/^[ \t]*"([a-z0-9_]+)"\s*=>/gm)];
    const bodies = new Map<string, string>();
    for (const [index, arm] of arms.entries()) {
        const from = arm.index + arm[0].length;
        const to = arms[index + 1]?.index ?? block.length;
        bodies.set(arm[1]!, block.slice(from, to));
    }
    return bodies;
}

/**
 * The engine fields that carry the *filtered detector* — the ones
 * `process_block` reads to build `sc_l` and `sc_r`.
 *
 * Read from the source rather than listed, so a stage added to the chain joins
 * the population without an edit here. The slice runs from the sidechain source
 * selection to the end of the `sc_r` assignment, which is the whole chain and
 * nothing else.
 */
function readDetectorChainFields(): Set<string> {
    const source = readSource(ENGINE_SOURCE);
    const from = source.indexOf('let (sc_raw_l, sc_raw_r)');
    expect(from, 'engine.rs must build a sidechain source').toBeGreaterThan(-1);
    const to = source.indexOf('// Process through active topology', from);
    expect(to, 'engine.rs must hand the sidechain on to a topology').toBeGreaterThan(from);

    const chain = source.slice(from, to);
    return new Set([...chain.matchAll(/self\.([a-z0-9_]+)/g)].map((match) => match[1]!));
}

/**
 * The patch keys whose engine arm configures a stage in that chain.
 *
 * This is the detector-routing population: every one of these has an arm, is
 * accepted, and shapes a signal only some topologies ever read.
 */
function readDetectorRoutedControls(): string[] {
    const chainFields = readDetectorChainFields();
    const armBodies = readEngineArmBodies();
    const routedWireNames = [...armBodies.entries()]
        .filter(([, armBody]) => [...chainFields].some((field) => armBody.includes(`self.${field}`)))
        .map(([wire]) => wire);

    return [...WIRE_NAMES.entries()]
        .filter(([, wire]) => routedWireNames.includes(wire))
        .map(([paramKey]) => paramKey)
        .sort();
}

/**
 * The topologies `process_topology` hands the filtered detector to.
 *
 * The arms that take `sc_l`/`sc_r` are the ones that can hear any of it. Today
 * that is the diode alone; the day another engine grows a sidechain-aware entry
 * point, this set widens and the rows for that topology have to go.
 */
function readDetectorAwareTopologies(): Set<string> {
    const source = readSource(ENGINE_SOURCE);
    const from = source.indexOf('fn process_topology');
    expect(from, 'engine.rs must dispatch to a topology').toBeGreaterThan(-1);
    const block = source.slice(from, source.indexOf('\n    fn ', from + 1));

    // To end of line, not to the first comma: the arm that *does* take the
    // sidechain is the one whose call has extra arguments, so a comma-bounded
    // read truncates exactly the arm being looked for and finds nothing.
    const arms = [...block.matchAll(/Topology::(\w+)\s*=>\s*(.+)$/gm)];
    return new Set(arms.filter((arm) => arm[2]!.includes('sc_l')).map((arm) => arm[1]!.toLowerCase()));
}

const ALL_TOPOLOGIES: GlutenTopology[] = ['vca', 'opto', 'fet', 'diode'];

describe('Gluten topology gap census', () => {
    it.each(ALL_TOPOLOGIES)('matches the %s struct’s set_param arms exactly', (topology) => {
        const arms = readSetParamArms(TOPOLOGY_SOURCES[topology]);
        const derived = forwardedSharedControls()
            .filter((paramKey) => !arms.has(wireName(paramKey)))
            .map((paramKey) => String(paramKey))
            .sort();

        expect(censusFor(topology, 'set-param')).toEqual(derived);
    });

    it.each(ALL_TOPOLOGIES)('matches what the %s topology can read of the filtered detector', (topology) => {
        const detectorAware = readDetectorAwareTopologies();
        const derived = detectorAware.has(topology) ? [] : readDetectorRoutedControls();

        expect(censusFor(topology, 'detector-routing')).toEqual(derived);
    });

    it('finds the detector chain rather than assuming it', () => {
        // The vacuity guard for the derivation above. A rename in `engine.rs`
        // that made either read return nothing would empty the routing
        // population and silently un-gate twelve controls on three topologies,
        // while the comparison above kept passing by comparing nothing to
        // nothing. Both ends are pinned: the count, and the one topology that
        // is currently allowed to hear any of it.
        expect(readDetectorRoutedControls()).toEqual([
            'extSidechain',
            'scEqEnabled',
            'scEqFreq',
            'scEqGain',
            'scEqQ',
            'scHpfEnabled',
            'scHpfFreq',
            'scLpfEnabled',
            'scLpfFreq',
            'thrust',
        ]);
        expect([...readDetectorAwareTopologies()]).toEqual(['diode']);
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

    it('refuses the detector controls off Diode, and names the way back', () => {
        const gate = glutenControlGate({
            patch: { ...DEFAULT_PATCH, topology: 'vca' },
            paramKey: 'scHpfFreq',
            controlLabel: 'SC HPF',
        });

        expect(gate.isInert).toBe(true);
        expect(gate.kind).toBe('unbuilt');
        expect(gate.explanation).toContain('only the Diode topology reads the filtered detector yet');
        expect(gate.explanation).toContain('Stage two');
        // Not the generic unbuilt sentence: this control is built, and telling
        // a user it is not implemented would send them looking for the wrong
        // thing.
        expect(gate.explanation).not.toContain('is not implemented on');
    });

    it('leaves the detector controls live on Diode, and on any primary running Diode in Stage two', () => {
        for (const paramKey of ['scHpfFreq', 'scEqGain', 'thrust', 'extSidechain'] as const) {
            expect(
                glutenControlGate({ patch: { ...diode, scEqGain: 6 }, paramKey, controlLabel: 'x' }).isInert,
                `${paramKey} on a Diode primary`
            ).toBe(false);

            expect(
                glutenControlGate({
                    patch: { ...DEFAULT_PATCH, topology: 'vca', blendTopology: 'diode', blendAmount: 0.5, scEqGain: 6 },
                    paramKey,
                    controlLabel: 'x',
                }).isInert,
                `${paramKey} on a VCA primary with a Diode stage two`
            ).toBe(false);
        }
    });

    it('refuses Link under Dual mono and names the move that brings it back', () => {
        const gate = glutenControlGate({
            patch: { ...DEFAULT_PATCH, stereoMode: 'dual-mono' },
            paramKey: 'stereoLink',
            controlLabel: 'Link',
        });

        expect(gate.isInert).toBe(true);
        expect(gate.kind).toBe('overridden');
        expect(gate.explanation).toContain('Link does nothing on this patch');
        expect(gate.explanation).toContain('Choose Stereo, Mid or Side');

        expect(glutenControlGate({ patch: DEFAULT_PATCH, paramKey: 'stereoLink', controlLabel: 'Link' }).isInert).toBe(
            false
        );
    });

    it('refuses Stage 2 while both stages name one topology, which the defaults reach in one click', () => {
        // `blendTopology` defaults to Opto, so selecting Opto as the primary is
        // the whole path to this state — and the Stage-two chooser then shows
        // three chips with none of them active above a knob that does nothing.
        const opto: GlutenPatch = { ...DEFAULT_PATCH, topology: 'opto' };
        expect(opto.blendTopology).toBe('opto');

        const gate = glutenControlGate({ patch: opto, paramKey: 'blendAmount', controlLabel: 'Stage 2' });
        expect(gate.isInert).toBe(true);
        expect(gate.kind).toBe('overridden');
        expect(gate.explanation).toContain('both are Opto');

        expect(
            glutenControlGate({
                patch: { ...opto, blendTopology: 'fet' },
                paramKey: 'blendAmount',
                controlLabel: 'Stage 2',
            }).isInert
        ).toBe(false);
    });

    it('refuses the SC EQ frequency and width while the bell is flat', () => {
        const flat: GlutenPatch = { ...diode, scEqGain: 0 };

        for (const paramKey of ['scEqFreq', 'scEqQ'] as const) {
            const gate = glutenControlGate({ patch: flat, paramKey, controlLabel: 'EQ Q' });
            expect(gate.kind, paramKey).toBe('overridden');
            expect(gate.explanation, paramKey).toContain('Set EQ Gain first');

            expect(
                glutenControlGate({ patch: { ...flat, scEqGain: 6 }, paramKey, controlLabel: 'EQ Q' }).isInert,
                paramKey
            ).toBe(false);
        }
    });

    it('prefers the topology reason over the patch-state one when both are true', () => {
        // On the VCA, EQ Q is inert whatever EQ Gain is. Telling the user to
        // set the gain would send them to a control that changes nothing
        // either, so the deeper fact wins.
        const gate = glutenControlGate({
            patch: { ...DEFAULT_PATCH, topology: 'vca', scEqGain: 0 },
            paramKey: 'scEqQ',
            controlLabel: 'EQ Q',
        });

        expect(gate.kind).toBe('unbuilt');
        expect(gate.explanation).not.toContain('Set EQ Gain first');
    });

    it('has a patch-state row for every control the panel can switch off with another control', () => {
        // The population, pinned. `gain_match_bypass` is measured `0e0` on all
        // four topologies while the device is not bypassed and is deliberately
        // absent — the bypass state is not in `GlutenPatch`, and Match would
        // then be greyed in the device's resting state. The reasoning is in
        // `GLUTEN_PATCH_STATE_GAPS`; this pins the decision so reversing it is
        // an edit rather than a drift.
        expect(GLUTEN_PATCH_STATE_GAPS.map((gap) => String(gap.paramKey)).sort()).toEqual([
            'blendAmount',
            'scEqFreq',
            'scEqQ',
            'stereoLink',
        ]);
    });

    it('engages Stage two exactly where the engine does', () => {
        expect(glutenBlendStage({ ...DEFAULT_PATCH, blendTopology: 'fet', blendAmount: 0.001 })).toBeNull();
        expect(glutenBlendStage({ ...DEFAULT_PATCH, blendTopology: 'fet', blendAmount: 0.002 })).toBe('fet');
        expect(
            glutenBlendStage({ ...DEFAULT_PATCH, topology: 'fet', blendTopology: 'fet', blendAmount: 1 })
        ).toBeNull();
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
