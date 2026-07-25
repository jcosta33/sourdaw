import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Clip, type Track } from '#/modules/Arrangement/stores';
import { type KneadClipState } from '#/modules/Knead/stores';
import { grooveTemplateStore } from '#/modules/MIDI/stores';
import { yeastStore } from '#/modules/Yeast/stores';

import { projectChangedCrdtSlots } from '../projectChangedCrdtSlots';
import { projectCrdtToStores } from '../projectProjection';
import { projectSlotProjections } from '../projectSlotProjections';

/**
 * Class guard for audit CC-2 — a projection reads the document, it never writes
 * it.
 *
 * Review round 1 on PR #793 found the `yeast` projection breaking this: it ran
 * `reconcileYeastGrooveAssignments`, which writes the `grooveTemplates` slot in
 * response to `yeast` slot content. Nothing caught it because the Yeast specs
 * call the projection function directly. This guard drives the real registry
 * with a live storage port and fails on *any* document write during a
 * projection pass, so the next such side effect fails here instead of in
 * review.
 *
 * The one sanctioned exception is a slot whose entry declares
 * `derivedFromSiblingSlot` — those rebuild a store from another store's read
 * model by definition, so their own slot is written as a consequence. The
 * assertions below pin that the writes stay inside that declared set.
 */

type TestDoc = { [key: string]: unknown };
type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

const ORPHANED_PROCESSOR_ID = 'yeast-rack:groove-orphan';

function createClipFixture(overrides: Partial<Clip> = {}): Clip {
    return {
        id: 'clip-1',
        trackId: 'track-knead',
        name: 'Clip',
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
        locked: false,
        muted: false,
        ...overrides,
    };
}

function createTrackFixture(overrides: Partial<Track> = {}): Track {
    return {
        id: 'track-knead',
        name: 'Knead Track',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        ...overrides,
    };
}

const kneadClipState: KneadClipState = {
    clipId: 'clip-knead',
    blobs: [],
    retuneSpeedMs: 25,
    toleranceCents: 25,
    toleranceTimeMs: 30,
    humanizePercent: 40,
    formantPreserve: true,
};

describe('projection write freedom (audit CC-2 class guard)', () => {
    const doc: TestDoc = {};
    let writtenSlots: string[] = [];

    beforeEach(() => {
        for (const key of Object.keys(doc)) {
            delete doc[key];
        }
        writtenSlots = [];
        const port: TestPort = {
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changedKeys, changeFn }) => {
                changeFn(doc);
                writtenSlots.push(...changedKeys);
            },
        };
        configureAutomergeStoragePort(port);
        // Drain writes queued by earlier suites so the measured window holds
        // only what the projection pass itself does.
        flushAutomergeStorageWrites();
        writtenSlots = [];
    });

    afterEach(() => {
        configureAutomergeStoragePort(null);
        flushAutomergeStorageWrites();
    });

    /**
     * Arms both known write temptations: an orphaned Yeast groove assignment
     * (the round-1 finding) and a clip whose Knead state the derived `knead`
     * projection copies across.
     */
    function armProjectionSideEffects(): void {
        const grooveState = grooveTemplateStore.value;
        if (!grooveState) {
            throw new Error('grooveTemplateStore must hold its seeded default');
        }
        yeastStore.set({ processors: [], uiLevel: 1 });
        grooveTemplateStore.set({
            ...grooveState,
            assignments: [
                {
                    consumerType: 'yeast-processor',
                    consumerId: ORPHANED_PROCESSOR_ID,
                    templateId: 'straight',
                    amount: 0.5,
                },
            ],
        });
        trackStore.set({
            tracks: [
                createTrackFixture({
                    clips: [createClipFixture({ id: 'clip-knead', kneadState: kneadClipState })],
                }),
            ],
            selectedTrackId: null,
            ghostClips: [],
        });
        flushAutomergeStorageWrites();
        writtenSlots = [];
    }

    function declaredDerivedSlots(): Set<string> {
        return new Set(
            projectSlotProjections
                .filter((projection) => projection.derivedFromSiblingSlot)
                .map((projection) => projection.slot)
        );
    }

    it('writes no slot outside the declared derived set during a full projection pass', () => {
        armProjectionSideEffects();

        projectCrdtToStores();
        flushAutomergeStorageWrites();

        const derived = declaredDerivedSlots();
        expect([...new Set(writtenSlots)].filter((slot) => !derived.has(slot))).toEqual([]);
    });

    it('keeps the derived-slot exception to the entries that declare it', () => {
        armProjectionSideEffects();

        projectCrdtToStores();
        flushAutomergeStorageWrites();

        // The exception is real, not theoretical: `knead` is rebuilt from
        // trackStore clip state, so its own slot is written as a consequence.
        // Any other slot appearing here is an undeclared projection write.
        expect([...new Set(writtenSlots)]).toEqual(['knead']);
    });

    it('never reconciles Yeast groove assignments from the yeast slot projection', () => {
        armProjectionSideEffects();

        // Document-origin so the yeast projection definitely runs — this is the
        // exact pass that used to delete the assignment from inside a read.
        projectChangedCrdtSlots({ changedSlots: ['yeast'], origin: 'document' });
        flushAutomergeStorageWrites();

        expect(writtenSlots).toEqual([]);
        expect(grooveTemplateStore.value?.assignments.map((assignment) => assignment.consumerId)).toEqual([
            ORPHANED_PROCESSOR_ID,
        ]);
    });

    it('leaves the orphan untouched when a local yeast write skips its own slot', () => {
        armProjectionSideEffects();

        // The local-origin skip elides the yeast slot entirely. That is only
        // safe because the reconciliation no longer lives here; the mutation
        // site owns it (see commitYeastProjection).
        projectChangedCrdtSlots({ changedSlots: ['yeast'], origin: 'local-store' });
        flushAutomergeStorageWrites();

        expect(writtenSlots).toEqual([]);
    });
});
