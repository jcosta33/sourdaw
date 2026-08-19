import { fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockAudioContext, createMockAudioNode } from '#/helpers/__tests__/audioContext.mock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { defaultTrackState, sanitizeTrackSnapshot, trackStore } from '#/modules/Arrangement/stores';
import { getPlatformPlugins } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { CrumbsPanel } from '#/modules/Crumbs/presentations/views';
import { showDevicePanelForType } from '#/modules/WorkspaceShell/useCases';
import { createHandler } from '#/utils/createHandler';

import { type BuiltinDeviceNode } from '../../models/AudioEngineState';
import { createDeviceReadinessDiagnostics } from '../deviceReadinessDiagnostics';
import { TrackNode, type TrackNodeDeps } from '../TrackNode';

/**
 * Does a panel control write to the object that renders the audio?
 *
 * ## Why nothing else answers this
 *
 * Three gates already stand around this area and all three pass on every known
 * instance of the defect. `descriptorEngineParamWeld` proves a declared
 * parameter id has a matching Rust `set_param` arm — it never asks whether a
 * panel uses the descriptor path at all. `deviceWriteBoundaryClosure` counts
 * sink identifiers per file — a control that reaches *no* sink is invisible to
 * a count that was recorded while it already reached none. `offlineDeviceCoverage`
 * proves both registries claim the device type — not which object a knob
 * addresses. Each of them is satisfied by a control that fires a handler, hits
 * an existing parameter, calls a setter, and delivers the value *somewhere*.
 *
 * The only file in the repo that could see it is
 * `Levain/presentations/views/__tests__/levainPanelReachesTheEngine.spec.tsx`,
 * and what makes it able to is not the device it covers: it drives the real
 * panel with a real gesture and then reads the value **off an engine object**,
 * comparing it against a second, independently produced statement of the same
 * value. A mock-call assertion cannot do that, because in every defect below
 * the mock *is* called — just on the wrong instance.
 *
 * ## The generalisation
 *
 * Levain's second statement is its offline render (`prepareOfflineLevain`), and
 * only three modules have one. The property that generalises is not "offline",
 * it is **two objects that must agree and are not fed from each other**:
 *
 *  - the **panel's own rendered readout** — `aria-valuenow` on the control the
 *    user moved, which the panel derives from its module store, and
 *  - the **strip's device node** — a real `TrackNode` device entry, reached
 *    through the real `TrackNode.updateParam` lookup.
 *
 * Neither is computed from the other. The readout moving proves the gesture
 * landed and the control is live rather than dead; the node receiving the same
 * number proves it landed *in the thing that makes sound*. A control that
 * writes a session store and a native backend instance satisfies the first and
 * fails the second, which is exactly the shape being retired.
 *
 * Deriving the expected value from the readout rather than from a literal is
 * deliberate and is *not* the tautology this campaign has been bitten by: the
 * readout is produced by the presentation layer from module state, the actual
 * is produced by the audio engine's device lookup, and the two paths share no
 * code. A guard that asserted the node merely received *something* would pass
 * on a write that sent the wrong number.
 *
 * ## Why the singleton is stubbed and the strip is not
 *
 * `audioEngine` is constructed at module load with no `AudioContext`
 * (`createWebAudioEngine.ts:1686`), so under jsdom it sits in `fallbackMode`
 * and every `updateDeviceParam` returns before reaching a strip. The stub below
 * replaces **only that instance**, and forwards into a real `TrackNode`. The
 * device-id lookup, the missing-controller guard and the `setParam` dispatch in
 * `TrackNode.updateParam` are the production ones — a write addressed to a
 * device the strip does not hold still lands nowhere, which is the failure mode
 * under test one layer down.
 */

const harness = vi.hoisted(() => ({
    updateParam: null as null | ((deviceId: string, paramId: string, value: number) => void),
    updatePatch: null as null | ((deviceId: string, patch: Record<string, unknown>) => void),
    ensureTrackStrip: null as null | ((trackId: string) => unknown),
}));

vi.mock('../../repositories/createWebAudioEngine', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../repositories/createWebAudioEngine')>();
    return {
        ...actual,
        audioEngine: new Proxy(actual.audioEngine, {
            get(target, property, receiver) {
                if (property === 'updateDeviceParam') {
                    return (_trackId: string, deviceId: string, paramId: string, value: number): void => {
                        harness.updateParam?.(deviceId, paramId, value);
                    };
                }
                if (property === 'updateDevicePatch') {
                    return (_trackId: string, deviceId: string, patch: Record<string, unknown>): void => {
                        harness.updatePatch?.(deviceId, patch);
                    };
                }
                // Route B — the module resolves a handle off the strip itself
                // rather than pushing a param through the engine. The real
                // singleton would try to build a strip here and die on
                // `createStereoPanner`; this hands back the same `TrackNode`
                // the Route A interception writes into, so both routes are
                // observed on one node rather than two.
                if (property === 'ensureTrackStrip') {
                    return (trackId: string): unknown => harness.ensureTrackStrip?.(trackId);
                }
                const value: unknown = Reflect.get(target, property, receiver);
                if (typeof value === 'function') {
                    return value.bind(target);
                }
                return value;
            },
        }),
    };
});

// ── Population, derived from two production registries at test time ──────────

/**
 * Every device the product offers, read under a stubbed native runtime because
 * `getPlatformPlugins` hides `platform: 'native'` entries from a browser build
 * and native is the superset. Same source `offlineDeviceCoverage` uses: it is
 * authored for the Content Browser, so nobody edits it to move a test.
 */
function readFullDeviceCatalog(): readonly string[] {
    Object.defineProperty(window, 'sourdaw', { value: {}, configurable: true });
    try {
        return getPlatformPlugins().map((descriptor) => descriptor.id);
    } finally {
        Reflect.deleteProperty(window, 'sourdaw');
    }
}

/**
 * Which catalog ids actually open a panel, asked of the production dispatcher
 * rather than listed here. `showDevicePanelForType` emits `panel.showDevice`
 * only for a type in its map, so a device that gains a panel joins this
 * population without anyone editing this file — and then fails the partition
 * below until it is classified. Four hand-maintained device lists in this
 * campaign have been wrong; this one cannot be.
 */
function readPanelledDeviceTypes(): readonly string[] {
    const emitted: string[] = [];
    injectDependencies(showDevicePanelForType, {
        eventBus: {
            emit: (event: string, payload: { deviceType?: string }) => {
                if (event === 'panel.showDevice' && payload.deviceType !== undefined) {
                    emitted.push(payload.deviceType);
                }
                return Promise.resolve();
            },
            on: () => () => {},
        },
    });
    for (const id of readFullDeviceCatalog()) {
        showDevicePanelForType(id, 'probe-device');
    }
    return emitted;
}

const PANELLED_DEVICE_TYPES = readPanelledDeviceTypes();

/**
 * Devices this file drives end to end. Keys are checked against the derived
 * population in both directions below.
 */
const COVERED_DEVICE_TYPES = ['builtin-crumbs'] as const;

/**
 * Devices this file cannot drive, with the reason each one resists. This table
 * is the deliverable half of the guard: it is what stops "cover the easy
 * devices, skip the ones with the bugs" from being invisible. An entry is a
 * statement of work outstanding, not an exemption — the value is read by nobody
 * at runtime, and removing a device from here without covering it fails the
 * partition.
 */
const NOT_COVERED_DEVICE_TYPES: Readonly<Record<string, string>> = {
    fermenter:
        'Panel controls run through `fermenterParamBridge`, whose patch/preset surface needs a decoded preset bank before any knob renders; the panel mounts against a loading state under jsdom.',
    toaster:
        'Pad and kit params are strip-scoped by `deviceId` through `setToasterPadParam`/`setToasterKitParam`; driving one needs a loaded kit, which fetches sample content.',
    levain: 'Covered by the sibling guard this file generalises — `Levain/presentations/views/__tests__/levainPanelReachesTheEngine.spec.tsx` — which additionally compares against a real offline render. Duplicating it here would be a second, weaker copy.',
    'dutch-oven':
        'ProofChamber panel controls are Route A and drivable in principle, but the panel mounts a WebGL decay-EQ overlay (`ProofChamberPanel.tsx:430`) that jsdom cannot construct.',
    gluten: 'Not yet driven. No known blocker — the panel is Route A and this is the next device to add.',
    bacteria:
        'Not yet driven. The band controls are Route A; the step sequencer surface (`StepSequencerEditor`) has a known dead `onStepsChange` that belongs to a different defect class.',
    grinder:
        'Panel edits ride `updateDevicePatch` (patch, not param) via `sendPatchToDevice`; the readout half of the comparison is a pedal-board model rather than an `aria-valuenow`.',
    proof: 'Write path is Route A and sound. Its live defect is on the READ path — `useProofAnalyser.ts:36-50` calls `getMasterAnalyser()`, so on a non-master track the EQ curve is drawn over the master spectrum. Not assertable by this harness: the comparison needs a device-scoped analyser to compare against, and `ProofNodeResult` exposes no analyser tap to build one from.',
    yeast: 'No audio node at all. Yeast is a MIDI FX rack; the scheduler re-reads `yeastStore` per block, so there is no device node for a panel write to miss.',
    'native-scoring':
        'The Tuner panel is a read-only readout driven by `ScoringNode` meter data; it has no parameter write to route.',
    crust: 'Not yet driven. No known blocker — the panel is Route A.',
    'grand-boule':
        'Panel setters resolve a handle from the strip through `resolveGrandBouleEngine`, so the node under test must be published on the engine registry rather than pushed onto a strip; the harness below installs strips only.',
};

describe('the panel-to-engine guard covers the devices that have panels', () => {
    it('derives a non-empty device population from the panel dispatcher', () => {
        // A regex that matched nothing, or a probe that emitted nothing, would
        // make every assertion below vacuously true.
        expect(PANELLED_DEVICE_TYPES.length).toBeGreaterThan(10);
        expect(PANELLED_DEVICE_TYPES).toContain('builtin-crumbs');
    });

    it('classifies every panelled device as covered or not covered, with a reason', () => {
        const classified = new Set([...COVERED_DEVICE_TYPES, ...Object.keys(NOT_COVERED_DEVICE_TYPES)]);
        const unclassified = PANELLED_DEVICE_TYPES.filter((type) => !classified.has(type));

        expect(unclassified).toEqual([]);
    });

    it('carries no classification for a device that has no panel', () => {
        // The other direction. A device removed from the product, or renamed,
        // leaves a stale row here rather than silently shrinking coverage.
        const panelled = new Set(PANELLED_DEVICE_TYPES);
        const stale = [...COVERED_DEVICE_TYPES, ...Object.keys(NOT_COVERED_DEVICE_TYPES)].filter(
            (type) => !panelled.has(type)
        );

        expect(stale).toEqual([]);
    });

    it('gives every not-covered device a reason long enough to act on', () => {
        const empty = Object.entries(NOT_COVERED_DEVICE_TYPES)
            .filter(([, reason]) => reason.trim().length < 40)
            .map(([type]) => type);

        expect(empty).toEqual([]);
    });
});

// ── Harness ──────────────────────────────────────────────────────────────────

type EngineWrite = { paramId: string; value: number };

type StripHarness = {
    /** Every `setParam` the strip's device node received, in order. */
    writes: EngineWrite[];
    /** Every patch the strip's device node received, in order. */
    patches: Record<string, unknown>[];
    /** Every mode the strip's Crumbs control surface was told, in order. */
    modes: string[];
    dispose: () => void;
};

/**
 * Stand a real `TrackNode` up with one device on it and record what that
 * device's controller is told.
 */
function installStrip(deviceId: string, deviceType: string): StripHarness {
    const ctx = createMockAudioContext();
    const deps: TrackNodeDeps = {
        context: ctx as unknown as AudioContext,
        masterGainNode: ctx.createGain() as unknown as GainNode,
        getBusGainNode: () => undefined,
        getTrackGainNode: () => undefined,
        getSendsForTrack: () => [],
        pendingDevicePromises: new Set(),
        readinessDiagnostics: createDeviceReadinessDiagnostics(),
    };
    const track = new TrackNode('track-1', deps);

    const writes: EngineWrite[] = [];
    const patches: Record<string, unknown>[] = [];
    const modes: string[] = [];
    const node = createMockAudioNode('gain');
    const deviceNode: BuiltinDeviceNode = {
        deviceId,
        type: deviceType,
        nodes: [node],
        inputNode: node,
        outputNode: node,
        controller: {
            setParam: (paramId: string, value: number) => {
                writes.push({ paramId, value });
            },
            setPatch: (patch: Record<string, unknown>) => {
                patches.push(patch);
            },
        },
        // The control surface `wasmDeviceRegistry` publishes on the rendering
        // Crumbs node (`AudioEngineState.ts:336`). `setMode` sat on it with zero
        // callers for the whole life of the mode defect — the node was always
        // reachable, nothing reached it. `sendCrumbsModeToEngine` is what does
        // now, and this records what it was told.
        crumbsControls: {
            ready: true,
            noteOn: () => {},
            noteOff: () => {},
            allNotesOff: () => {},
            setParam: (name: string, value: number) => {
                writes.push({ paramId: name, value });
            },
            setMode: (mode: string) => {
                modes.push(mode);
            },
            setBypass: () => {},
            destroy: () => {},
        },
    };
    track.strip.deviceNodes.push(deviceNode);

    harness.updateParam = (targetId, paramId, value) => {
        track.updateParam(targetId, paramId, value);
    };
    harness.updatePatch = (targetId, patch) => {
        track.updatePatch(targetId, patch);
    };
    harness.ensureTrackStrip = () => track.strip;

    return {
        writes,
        patches,
        modes,
        dispose: () => {
            harness.updateParam = null;
            harness.updatePatch = null;
            harness.ensureTrackStrip = null;
        },
    };
}

function seedTrackWithDevice(deviceId: string, deviceType: string): void {
    trackStore.set({
        ...defaultTrackState,
        tracks: sanitizeTrackSnapshot({
            tracks: [
                {
                    id: 'track-1',
                    name: 'Probe',
                    kind: 'midi',
                    devices: [
                        {
                            id: deviceId,
                            name: deviceType,
                            type: deviceType,
                            bypassed: false,
                            parameterValues: {},
                        },
                    ],
                },
            ],
            selectedTrackId: null,
        }).tracks,
    });
}

/**
 * The knob a panel labels with `controlLabel`.
 *
 * `getByRole('slider', { name })` cannot be used: every `RotaryKnob` in the
 * Crumbs panel renders with the fallback accessible name "Parameter control",
 * because the wrapper draws the label in a sibling element instead of passing
 * it down (`CrumbsControls.tsx:39-73`). That is a real accessibility defect and
 * a separate piece of work — this walks the rendered tree the way a sighted
 * user reads it instead, from the visible label up to the control it names.
 */
function knobByLabel(controlLabel: string): HTMLElement {
    for (const labelNode of screen.getAllByText(controlLabel)) {
        let ancestor: HTMLElement | null = labelNode.parentElement;
        while (ancestor) {
            const slider = ancestor.querySelector('[role="slider"]');
            if (slider instanceof HTMLElement) {
                return slider;
            }
            ancestor = ancestor.parentElement;
        }
    }
    throw new Error(`no knob labelled ${controlLabel}`);
}

/** The panel's own rendered value for one control. */
function readout(controlLabel: string): number {
    const raw = knobByLabel(controlLabel).getAttribute('aria-valuenow');
    if (raw === null) {
        throw new Error(`control ${controlLabel} renders no aria-valuenow`);
    }
    return Number(raw);
}

/**
 * Drag one knob, which is the gesture that produces a *transient* edit.
 *
 * The keyboard path commits instead (`RotaryKnob.tsx:344` sends
 * `isTransient: false`), and a commit dispatches through `executeAppAction`,
 * which needs the whole Automerge document stood up. A drag is the shorter
 * route to the same question and is what a user actually does to a knob.
 */
function dragKnob(controlLabel: string, pixelsUp: number): void {
    const control = knobByLabel(controlLabel);
    fireEvent.pointerDown(control, { pointerId: 1, clientY: 200 });
    fireEvent.pointerMove(control, { pointerId: 1, clientY: 200 - pixelsUp });
}

const CRUMBS_DEVICE_ID = 'crumbs-probe';

describe('Crumbs panel edits reach the node in the track strip', () => {
    let strip: StripHarness;

    beforeEach(() => {
        Element.prototype.setPointerCapture = vi.fn();
        Element.prototype.releasePointerCapture = vi.fn();
        seedTrackWithDevice(CRUMBS_DEVICE_ID, 'builtin-crumbs');
        strip = installStrip(CRUMBS_DEVICE_ID, 'builtin-crumbs');
    });

    // Registered once, and never cleared per test: the commit fires during
    // Testing Library's unmount, which runs in an `afterEach` registered by the
    // global setup — that is, *after* this describe's own teardown. Clearing the
    // registry here would put the crash back.
    beforeAll(() => {
        // Releasing a knob ends the gesture with a *commit*, which dispatches
        // `setDeviceParameter` through `executeAppAction`. Unmounting at test
        // teardown blurs the knob and does the same. Standing the whole Automerge
        // document up for that is out of proportion — the question here is the
        // audible preview, which is the transient half — but leaving the dispatch
        // unregistered turns every teardown into an unhandled rejection that
        // fails the file independently of any assertion. Registering the
        // discriminant with a handler that does nothing keeps the commit path a
        // dispatch rather than a crash, and keeps it out of the measurement.
        registerHandlerMap({
            setDeviceParameter: createHandler<'setDeviceParameter'>({
                undoable: false,
                execute: () => {},
                describe: () => ({ label: 'noop', inverseAction: null }),
            }),
        });
    });

    afterAll(() => {
        clearHandlerRegistry();
    });

    afterEach(() => {
        strip.dispose();
        trackStore.set(defaultTrackState);
        vi.restoreAllMocks();
    });

    it('sends a filter cutoff move to the strip node — the route that works', () => {
        // Positive control. `filterCutoff` is one of the ten ids #1474 wired to
        // `updateDeviceParam`, so this arm proves the harness can observe a
        // correct route. Without it, a harness that observed nothing at all
        // would "catch" every device below for the wrong reason.
        render(<CrumbsPanel deviceId={CRUMBS_DEVICE_ID} />);

        // Downwards: Crumbs opens with the filter wide open at the declared
        // maximum, so a drag up quantises back to the same 20000 and the panel
        // never re-renders. Both halves of the comparison would then agree on
        // "unchanged" for the wrong reason.
        const before = readout('Cutoff');
        dragKnob('Cutoff', -40);
        const after = readout('Cutoff');

        expect(after).not.toBe(before);
        expect(strip.writes.findLast((write) => write.paramId === 'filterCutoff')?.value).toBe(after);
    });

    it('sends a voice-count move to the strip node', () => {
        render(<CrumbsPanel deviceId={CRUMBS_DEVICE_ID} />);

        const before = readout('Voices');
        dragKnob('Voices', 60);
        const after = readout('Voices');

        expect(after).not.toBe(before);
        expect(strip.writes.findLast((write) => write.paramId === 'stackCount')?.value).toBe(after);
    });

    it('sends a detune-spread move to the strip node', () => {
        render(<CrumbsPanel deviceId={CRUMBS_DEVICE_ID} />);

        const before = readout('Detune');
        dragKnob('Detune', 60);
        const after = readout('Detune');

        expect(after).not.toBe(before);
        expect(strip.writes.findLast((write) => write.paramId === 'detuneSpread')?.value).toBe(after);
    });

    it('sends a stereo-spread move to the strip node', () => {
        render(<CrumbsPanel deviceId={CRUMBS_DEVICE_ID} />);

        const before = readout('Spread');
        dragKnob('Spread', 60);
        const after = readout('Spread');

        expect(after).not.toBe(before);
        expect(strip.writes.findLast((write) => write.paramId === 'stackSpread')?.value).toBe(after);
    });

    it('sends an operating-mode switch to the strip node', () => {
        render(<CrumbsPanel deviceId={CRUMBS_DEVICE_ID} />);

        // The intent half is a conditional-rendering gate rather than a knob
        // readout: the Pad bay section exists only in Drum mode, so its arrival
        // proves the panel really changed mode and did not just repaint a chip.
        expect(screen.queryByText('Pad bay')).toBeNull();

        fireEvent.click(screen.getByText('Drum'));

        expect(screen.queryByText('Pad bay')).not.toBeNull();
        expect(strip.modes).toContain('drum');
    });
});
