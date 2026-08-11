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
    glutenCardNotice,
    glutenControlGate,
    glutenStageTwoOptionGate,
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
 * ## Two populations, two derivations
 *
 * An arm scan sees one of the two ways a Gluten control reaches nothing, and
 * an earlier revision of this file shipped with only that one — which made the
 * census blind by construction to the other two rather than merely incomplete.
 *
 * - **`set-param`** — derived from the four structs' arms, as above.
 * - **detector routing** — every configured detector stage is derived from
 *   `engine.rs`, then `process_topology` is checked to prove all four topology
 *   calls consume the conditioned detector.
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
 * One `match` arm head, and every name it answers to.
 *
 * ## Why the head is captured whole and then split
 *
 * The first version of this parse read one literal per arm:
 * `/^[ \t]*"([a-z0-9_]+)"\s*=>/gm`. Against an **or-pattern** —
 * `"knee" | "range" => { … }` — it matches nothing at all: the first literal is
 * followed by `|` rather than `=>`, and the second is not at line start. Both
 * names would stay in the derived gap population, both census rows would
 * survive, and nothing would red.
 *
 * That is not a hypothetical shape. `GLUTEN_TOPOLOGY_GAPS` says in its own
 * reason text that the FET's `knee` and `range` are literals at the call site,
 * one field away, and would close together — so an or-pattern is precisely how
 * someone closes them, and the census would have gone on greying two controls
 * that had started working. The file's own docstring says the weld exists so
 * that "the fix for a dead control would become a permanently dead control"
 * cannot happen; that was the exact hole.
 *
 * The Rust reach test is not a backstop for this. Its `audible_on` lists are
 * hand-written and are edited in the same change that adds the arm, so it goes
 * green with the implementation.
 *
 * `\s*` between the alternatives spans newlines, so the multi-line form
 * (`"knee"\n| "range" => …`) is read too.
 */
const ARM_HEAD_PATTERN = /^[ \t]*("[a-z0-9_]+"(?:\s*\|\s*"[a-z0-9_]+")*)\s*=>/gm;

type ArmHead = { readonly names: string[]; readonly start: number; readonly end: number };

function readArmHeads(block: string): ArmHead[] {
    return [...block.matchAll(ARM_HEAD_PATTERN)].map((match) => ({
        names: [...match[1]!.matchAll(/"([a-z0-9_]+)"/g)].map((name) => name[1]!),
        start: match.index,
        end: match.index + match[0].length,
    }));
}

/**
 * Names that *look* like arm heads and were not captured — the fail-closed
 * half.
 *
 * Capturing the or-pattern fixes the shape known today. This reds on the shape
 * nobody has thought of yet: any line inside the `match` that begins with a
 * quoted name or with `|` is an arm head or its continuation, so every literal
 * on it must have been read. An arm written in a form this parse cannot see
 * therefore fails the spec instead of silently narrowing the population it
 * derives.
 */
function uncapturedArmNames(block: string, captured: ReadonlySet<string>): string[] {
    const missed: string[] = [];
    for (const line of block.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('"') && !trimmed.startsWith('|')) {
            continue;
        }
        for (const match of trimmed.matchAll(/"([a-z0-9_]+)"/g)) {
            if (!captured.has(match[1]!)) {
                missed.push(match[1]!);
            }
        }
    }
    return missed;
}

/** The `match name { … }` block of one `set_param`, bounded to that function. */
function readSetParamBlock(relativePath: string): string {
    const source = readSource(relativePath);
    const start = source.indexOf('pub fn set_param');
    expect(start, `${relativePath} must declare set_param`).toBeGreaterThan(-1);

    const body = source.slice(start + 'pub fn set_param'.length);
    const end = /\n {4}(?:pub )?fn /.exec(body)?.index ?? body.length;
    return body.slice(0, end);
}

/**
 * The parameter names one `set_param` has a match arm for.
 *
 * Bounded to the function, because a whole file's string literals are not the
 * same population: `GlutenEngine::set_param`'s `amount` arm *calls*
 * `self.vca.set_param("threshold", …)`, and counting that would file
 * `threshold` as a name the engine handles itself — which would drop it out of
 * the forwarded set and quietly stop the census asking about it on any
 * topology. Arm heads are anchored at line start, which the nested calls are
 * not.
 */
function readSetParamArms(relativePath: string): Set<string> {
    const block = readSetParamBlock(relativePath);
    const captured = new Set(readArmHeads(block).flatMap((arm) => arm.names));

    expect(
        uncapturedArmNames(block, captured),
        `${relativePath} has match arms this spec cannot read — the derived population would be too wide`
    ).toEqual([]);

    return captured;
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

/**
 * The whole `set_param` match block of `GlutenEngine`, arm by arm.
 *
 * Every name in an or-pattern maps to the same body, which is what the arm
 * means. Shares `readArmHeads` with the arm scan above so the two cannot read
 * the same file differently — the earlier duplicate of the one-literal regex
 * lived here and carried the same hole.
 */
function readEngineArmBodies(): Map<string, string> {
    const block = readSetParamBlock(ENGINE_SOURCE);
    const arms = readArmHeads(block);

    const bodies = new Map<string, string>();
    for (const [index, arm] of arms.entries()) {
        const armBody = block.slice(arm.end, arms[index + 1]?.start ?? block.length);
        for (const name of arm.names) {
            bodies.set(name, armBody);
        }
    }
    return bodies;
}

/**
 * The engine fields that own the detector source and conditioning chain.
 */
function readDetectorChainFields(): Set<string> {
    const source = readSource(ENGINE_SOURCE);
    expect(source).toContain('let external_detector');
    expect(source).toContain('self.sidechains[topo.index()].process');
    return new Set(['ext_sidechain', 'sidechains']);
}

/**
 * The patch keys whose engine arm configures a stage in that chain.
 *
 * Every one of these has an engine arm and configures the shared detector path.
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
 * The arms that take `detector_l`/`detector_r` are the ones that can hear it.
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
    return new Set(arms.filter((arm) => arm[2]!.includes('detector_l')).map((arm) => arm[1]!.toLowerCase()));
}

const ALL_TOPOLOGIES: GlutenTopology[] = ['vca', 'opto', 'fet', 'diode'];

/**
 * The arm reader, against arm shapes that are not in the crate *yet*.
 *
 * Everything else in this file reads the live sources, which means it can only
 * guard the parse against shapes already written. That is the wrong way round
 * for this particular reader: its whole job is to keep working when someone
 * changes those sources, and the change most likely to break it — collapsing
 * two dead parameters into one or-pattern — is exactly how the FET's `knee` and
 * `range` get implemented, by this file's own account.
 *
 * Narrowing `ARM_HEAD_PATTERN` back to one literal per arm is invisible against
 * today's crate: no arm uses an or-pattern, so both versions agree. These
 * fixtures are what make that mutation red.
 */
describe('the set_param arm reader', () => {
    const INLINE_OR = '            "knee" | "range" => {\n                self.x = value;\n            }\n';
    const MULTILINE_OR =
        '            "knee"\n            | "range" => {\n                self.x = value;\n            }\n';
    const NESTED_CALL =
        '            "amount" => {\n                self.vca.set_param("threshold", t);\n            }\n';

    function namesIn(block: string): string[] {
        return readArmHeads(block)
            .flatMap((arm) => arm.names)
            .sort();
    }

    it('reads both names out of an inline or-pattern', () => {
        expect(namesIn(INLINE_OR)).toEqual(['knee', 'range']);
    });

    it('reads both names out of a multi-line or-pattern', () => {
        expect(namesIn(MULTILINE_OR)).toEqual(['knee', 'range']);
    });

    it('still refuses a nested set_param call that is not an arm', () => {
        // The other half of the bound: `GlutenEngine`'s `amount` arm *calls*
        // `self.vca.set_param("threshold", …)`, and reading that as an arm
        // would file `threshold` as engine-handled and drop it out of the
        // forwarded population entirely.
        expect(namesIn(NESTED_CALL)).toEqual(['amount']);
    });

    it('maps every name of an or-pattern to the arm’s one body', () => {
        const [arm] = readArmHeads('            "knee" | "range" => { self.x = value; }\n');
        expect(arm?.names).toEqual(['knee', 'range']);
    });

    it('reports a name it could not read as an arm head', () => {
        // Fail-closed. A guard arm (`"knee" if … =>`) is a shape this parse
        // cannot read, and reading zero arms from it would widen the derived
        // gap population in silence.
        const block = '            "knee" if value > 0.0 => {\n                self.x = value;\n            }\n';
        expect(uncapturedArmNames(block, new Set(namesIn(block)))).toEqual(['knee']);
    });

    it('reports nothing when every arm head was read', () => {
        const block = '            "knee" | "range" => {\n                self.x = value;\n            }\n';
        expect(uncapturedArmNames(block, new Set(namesIn(block)))).toEqual([]);
    });
});

describe('Gluten topology gap census', () => {
    it.each(ALL_TOPOLOGIES)('matches the %s struct’s set_param arms exactly', (topology) => {
        const arms = readSetParamArms(TOPOLOGY_SOURCES[topology]);
        const derived = forwardedSharedControls()
            .filter((paramKey) => !arms.has(wireName(paramKey)))
            .map((paramKey) => String(paramKey))
            .sort();

        expect(censusFor(topology)).toEqual(derived);
    });

    it('finds the detector chain rather than assuming it', () => {
        // The vacuity guard for the derivation above. A rename in `engine.rs`
        // that made either read return nothing would empty the routing
        // population while the routing check kept passing by comparing nothing
        // to nothing. Both ends are pinned: the configured controls and all
        // four topology consumers.
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
        expect([...readDetectorAwareTopologies()]).toEqual(['vca', 'opto', 'fet', 'diode']);
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
        // Vacuity guard first: the assertion below is `unaccounted == []`,
        // which an empty `WIRE_NAMES` satisfies for free. Breaking the
        // `PARAM_MAP` read reds nine of this file's assertions and used to
        // leave this one green, so it pins the map is non-empty and covers the
        // whole patch surface the panel writes.
        expect(WIRE_NAMES.size).toBeGreaterThanOrEqual(GLUTEN_SHARED_CONTROLS.length);

        const claimed = new Set<string>([
            ...GLUTEN_SHARED_CONTROLS.map(String),
            ...ALL_TOPOLOGIES.flatMap((topology) => GLUTEN_TOPOLOGY_OWNED_CONTROLS[topology].map(String)),
            ...GLUTEN_UNRENDERED_PARAMS,
        ]);
        const unaccounted = [...WIRE_NAMES.keys()].filter((paramKey) => !claimed.has(paramKey)).sort();

        expect(unaccounted).toEqual([]);
    });

    it('leaves at least one topology able to hear every censused control', () => {
        // `remedyFor` returns `null` when nothing hears the parameter, and that
        // branch would drop the way-back clause off the end of an explanation
        // with nothing to catch it. It is unreachable today; this is what makes
        // that a fact rather than a comment, and it reds on the first row that
        // is dead everywhere.
        function isDeafTo(topology: GlutenTopology, paramKey: string): boolean {
            return censusFor(topology).includes(paramKey);
        }

        const censused = new Set(
            GLUTEN_TOPOLOGY_GAPS.flatMap((gap) => gap.params.map((param) => String(param.paramKey)))
        );
        const deadEverywhere = [...censused]
            .filter((paramKey) => ALL_TOPOLOGIES.every((topology) => isDeafTo(topology, paramKey)))
            .sort();

        expect(deadEverywhere).toEqual([]);
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

        expect(gate).toEqual({ isInert: false, kind: null, explanation: null, remedy: null });
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

    it('leaves the detector controls live on every topology', () => {
        for (const topology of ALL_TOPOLOGIES) {
            for (const paramKey of ['scHpfFreq', 'scEqGain', 'thrust', 'extSidechain'] as const) {
                expect(
                    glutenControlGate({
                        patch: { ...DEFAULT_PATCH, topology, scEqGain: 6 },
                        paramKey,
                        controlLabel: 'x',
                    }).isInert,
                    `${paramKey} on ${topology}`
                ).toBe(false);
            }
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

    it('uses the flat-EQ patch-state reason on every topology', () => {
        const gate = glutenControlGate({
            patch: { ...DEFAULT_PATCH, topology: 'vca', scEqGain: 0 },
            paramKey: 'scEqQ',
            controlLabel: 'EQ Q',
        });

        expect(gate.kind).toBe('overridden');
        expect(gate.explanation).toContain('Set EQ Gain first');
    });

    it('has a patch-state row for every control the panel can switch off with another control', () => {
        // The population, pinned in two halves.
        //
        // The four hand-written rows first. `gain_match_bypass` is measured
        // `0e0` on all four topologies while the device is not bypassed and is
        // deliberately absent — the bypass state is not in `GlutenPatch`, and
        // Match would then be greyed in the device's resting state. The
        // reasoning is in `GLUTEN_PATCH_STATE_GAPS`; this pins the decision so
        // reversing it is an edit rather than a drift.
        const generated = new Set(
            Object.values(GLUTEN_TOPOLOGY_OWNED_CONTROLS)
                .flat()
                .map((paramKey) => String(paramKey))
        );
        const handWritten = GLUTEN_PATCH_STATE_GAPS.map((gap) => String(gap.paramKey)).filter(
            (paramKey) => !generated.has(paramKey)
        );
        expect(handWritten.sort()).toEqual(['blendAmount', 'scEqFreq', 'scEqQ', 'stereoLink']);

        // …and the generated half: every Character-card control gets a row, so
        // the Stage-two block can stay mounted while its stage is switched off.
        const covered = new Set(GLUTEN_PATCH_STATE_GAPS.map((gap) => String(gap.paramKey)));
        expect([...generated].filter((paramKey) => !covered.has(paramKey))).toEqual([]);
        expect(generated.size).toBe(11);
    });

    it('refuses a Stage-two topology’s Character controls while Stage 2 sits at zero', () => {
        const named: GlutenPatch = { ...DEFAULT_PATCH, topology: 'vca', blendTopology: 'diode', blendAmount: 0 };

        const off = glutenControlGate({ patch: named, paramKey: 'recovery', controlLabel: 'Recovery' });
        expect(off.isInert).toBe(true);
        expect(off.kind).toBe('overridden');
        expect(off.remedy).toBe('Raise Stage 2 above 0% to use this.');

        const on = glutenControlGate({
            patch: { ...named, blendAmount: 0.5 },
            paramKey: 'recovery',
            controlLabel: 'Recovery',
        });
        expect(on.isInert).toBe(false);

        // A topology's own Character controls stay live while it is the primary,
        // whatever Stage two is doing.
        expect(
            glutenControlGate({
                patch: { ...DEFAULT_PATCH, topology: 'diode', blendAmount: 0 },
                paramKey: 'recovery',
                controlLabel: 'Recovery',
            }).isInert
        ).toBe(false);
    });

    it('names every topology that would bring a refused control back', () => {
        // The escape clause, derived per parameter rather than phrased
        // generically — "run another topology in Stage two" is false. Knee
        // comes back only under the VCA; Release under the VCA or the FET.
        function onDiode(paramKey: keyof GlutenPatch): string | null {
            return glutenControlGate({ patch: diode, paramKey, controlLabel: 'x' }).remedy;
        }

        expect(onDiode('knee')).toBe('Select VCA, or run VCA in Stage two, to use this.');
        expect(onDiode('release')).toBe('Select VCA or FET, or run one of them in Stage two, to use this.');
        // And it is the tail of the explanation, so a `title` reader gets it too.
        const gate = glutenControlGate({ patch: diode, paramKey: 'knee', controlLabel: 'Knee' });
        expect(gate.explanation?.endsWith(gate.remedy ?? '')).toBe(true);
    });

    it('builds one card line from the controls it is given', () => {
        const gates = ['knee', 'range'].map((paramKey) =>
            glutenControlGate({ patch: diode, paramKey: paramKey as keyof GlutenPatch, controlLabel: 'x' })
        );
        const notice = glutenCardNotice({ labels: ['Knee', 'Range'], gates });

        // Both names, and the remedy they share stated once rather than twice.
        expect(notice).toBe('Knee and Range are inert here. Select VCA, or run VCA in Stage two, to use this.');

        expect(
            glutenCardNotice({
                labels: ['Threshold'],
                gates: [glutenControlGate({ patch: diode, paramKey: 'threshold', controlLabel: 'Threshold' })],
            })
        ).toBeNull();
    });

    it('refuses only the primary’s own chip in the Stage-two chooser', () => {
        // The chooser used to filter the primary out, which left it showing
        // three chips with none active while Stage 2's own reason said "both
        // are Opto" — a state named on screen nowhere. All four render now.
        const opto: GlutenPatch = { ...DEFAULT_PATCH, topology: 'opto' };

        const own = glutenStageTwoOptionGate({ patch: opto, option: 'opto' });
        expect(own.isInert).toBe(true);
        expect(own.kind).toBe('overridden');
        expect(own.explanation).toContain('already the primary topology');

        for (const option of ['vca', 'fet', 'diode'] as const) {
            expect(glutenStageTwoOptionGate({ patch: opto, option }).isInert, option).toBe(false);
        }
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
