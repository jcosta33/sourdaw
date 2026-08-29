import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    agentProjectInspectionPort,
    createCrdtDoc,
    inspectCurrentAgentProjectRepairState,
    mutateCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
} from '#/modules/CrdtDocument/useCases';

import { captureAgentProjectInspectionState } from '../captureCommandBatchPreflightState';

function trackRow(id: string, kind: 'master' | 'midi', outputId: string): Record<string, unknown> {
    return {
        activeAlternativeId: `alt-${id}`,
        alternatives: [{ clips: [], id: `alt-${id}`, name: 'Alternative 1' }],
        armed: false,
        automationMode: 'read',
        clips: [],
        collapsed: false,
        color: 'oklch(0.40 0.08 150)',
        devices: [],
        disabled: false,
        followChordTrack: false,
        freezeState: { status: 'unfrozen' },
        frozen: false,
        gain: 0.8,
        groupId: null,
        height: 80,
        hidden: false,
        id,
        inputId: null,
        inputMonitoring: 'auto',
        kind,
        midiFx: [],
        midiOutputTrackId: null,
        muted: false,
        name: id,
        notes: '',
        outputId,
        pan: 0,
        parentId: null,
        sends: [],
        soloSafe: false,
        soloed: false,
        vcaGroupId: null,
    };
}

function track(id: string): Record<string, unknown> {
    return trackRow(id, 'midi', 'master');
}

function trackSharingAlternativeId(id: string, alternativeId: string): Record<string, unknown> {
    return {
        ...track(id),
        activeAlternativeId: alternativeId,
        alternatives: [{ clips: [], id: alternativeId, name: 'Alternative 1' }],
    };
}

function masterBus(): Record<string, unknown> {
    return trackRow('master', 'master', 'hw_out');
}

function tracksSlot(tracks: readonly Record<string, unknown>[]): Record<string, unknown> {
    return { selectedTrackId: null, tracks };
}

function arrangement(id: string, tracks: Record<string, unknown>): Record<string, unknown> {
    return {
        automation: { lanes: [] },
        id,
        markers: { markers: [], sections: [] },
        midi: { ccByClipId: {}, notesByClipId: {}, pitchBendByClipId: {} },
        name: 'Arrangement 1',
        takeLanes: { lanes: [] },
        tempoMap: { changes: [] },
        timeSignatureMap: { changes: [] },
        tracks,
    };
}

/**
 * The wire encoding `grooveTemplateAutomergeStorage` writes: entity maps keyed
 * by id, each carrying a tombstone flag beside its value, under a schema
 * version. Nothing in the store's own shape looks like this — that is the whole
 * point of the encoding, and the property this fixture reproduces from a real
 * poisoned document.
 */
function encodedGrooveTemplates(): Record<string, unknown> {
    return {
        schemaVersion: 1,
        assignments: {},
        templates: {
            'groove-straight': {
                deleted: false,
                value: {
                    id: 'groove-straight',
                    name: 'Straight',
                    schemaVersion: 1,
                    subdivision: '1/16',
                    slots: [],
                    provenance: { type: 'builtin', sourceId: 'straight' },
                },
            },
        },
    };
}

function seedRootDocument(slots: Record<string, unknown>): void {
    createCrdtDoc('root');
    mutateCrdtDoc<Record<string, unknown>>({
        id: 'root',
        changeFn: (doc) => {
            for (const [slot, value] of Object.entries(slots)) {
                doc[slot] = value;
            }
        },
    });
}

describe('agent project repair inspection', () => {
    beforeEach(() => {
        vi.stubGlobal(
            'requestAnimationFrame',
            vi.fn(() => 1)
        );
        vi.stubGlobal(
            'cancelAnimationFrame',
            vi.fn(() => undefined)
        );
        registerCrdtStorageRuntime();
        agentProjectInspectionPort.setProvider(captureAgentProjectInspectionState);
    });

    afterEach(() => {
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    it('does not require repair for arrangement snapshots that copy the live track ids', () => {
        const tracks = tracksSlot([masterBus(), track('track-a'), track('track-b')]);
        seedRootDocument({
            tracks,
            // An arrangement is an arrangement *of* those tracks: the snapshot
            // repeats their ids, and every clip, alternative and device id under
            // them, by design.
            arrangements: {
                activeArrangementId: 'arrangement-1',
                arrangements: [arrangement('arrangement-1', tracks)],
            },
            grooveTemplates: encodedGrooveTemplates(),
        });

        expect(inspectCurrentAgentProjectRepairState()).toBeNull();
    });

    it('does not require repair when two arrangement snapshots repeat one another’s track ids', () => {
        const tracks = tracksSlot([masterBus(), track('track-a'), track('track-b')]);
        seedRootDocument({
            tracks,
            // The ordinary state after `duplicateArrangement`: the clone keeps
            // every track, clip and alternative id of the arrangement it was
            // copied from, and only its own `id` is reminted. Each snapshot's
            // contents are a namespace of their own, so those repeats are not
            // collisions.
            arrangements: {
                activeArrangementId: 'arrangement-1',
                arrangements: [arrangement('arrangement-1', tracks), arrangement('arrangement-2', tracks)],
            },
            grooveTemplates: encodedGrooveTemplates(),
        });

        expect(inspectCurrentAgentProjectRepairState()).toBeNull();
    });

    it('still reports a raw projection loss on a slot the store projects directly', () => {
        seedRootDocument({
            tracks: tracksSlot([masterBus(), track('track-a')]),
            // `transport` carries no custom encoding, so its sanitizer output is
            // the store's own shape and containment is a real question there.
            transport: { unprojectedKey: 'lost' },
        });

        expect(inspectCurrentAgentProjectRepairState()).toMatchObject({
            repairCandidates: [{ targetIds: ['@project/raw/transport'] }],
            status: 'repair-required',
        });
    });

    it('still requires repair when one id is genuinely used twice inside the live project', () => {
        seedRootDocument({
            // Two distinct tracks sharing one alternative id. `inspectStagedProjectDocument`
            // walks track ids and never descends into alternatives, so only the
            // whole-document duplicate scan can see this collision.
            tracks: tracksSlot([
                masterBus(),
                trackSharingAlternativeId('track-a', 'alt-shared'),
                trackSharingAlternativeId('track-b', 'alt-shared'),
            ]),
        });

        expect(inspectCurrentAgentProjectRepairState()).toMatchObject({
            projectInvariantsValid: false,
            status: 'repair-required',
        });
    });

    it('still requires repair when two arrangement snapshots carry the same arrangement id', () => {
        const tracks = tracksSlot([masterBus(), track('track-a')]);
        seedRootDocument({
            tracks,
            // `duplicateArrangement` remints only the clone's own `id`, so a
            // repeated one is a real collision: `syncCurrentArrangementToStore`
            // overwrites every snapshot matching the active id and destroys the
            // other arrangement's tracks, clips and MIDI.
            arrangements: {
                activeArrangementId: 'arrangement-1',
                arrangements: [arrangement('arrangement-1', tracks), arrangement('arrangement-1', tracks)],
            },
        });

        expect(inspectCurrentAgentProjectRepairState()).toMatchObject({
            projectInvariantsValid: false,
            status: 'repair-required',
        });
    });

    it('still requires repair when one arrangement snapshot collides with itself', () => {
        seedRootDocument({
            tracks: tracksSlot([masterBus(), track('track-a')]),
            arrangements: {
                activeArrangementId: 'arrangement-1',
                arrangements: [
                    arrangement('arrangement-1', tracksSlot([masterBus(), track('track-a'), track('track-a')])),
                ],
            },
        });

        expect(inspectCurrentAgentProjectRepairState()).toMatchObject({
            projectInvariantsValid: false,
            status: 'repair-required',
        });
    });
});
