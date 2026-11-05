import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import { type AppAction } from '#/utils/handlerContract';

import { projectSlotProjectionRegistry } from '../projectSlotProjections';

type CreateDrumPreviewBranchesAction = Extract<AppAction, { type: 'createDrumPreviewBranches' }>;

const UNREGISTERED_FIX =
    'slot projections are not registered; call registerProjectSlotProjections() from #/app/registerProjectSlotProjections (bootstrap does this)';

/**
 * The kernel cannot import the stores its root slots project into, so the
 * composition root registers them. The registry is module state: a case that
 * needs it empty starts from freshly evaluated modules.
 */
function startFromFreshModules(): void {
    beforeEach(() => {
        vi.resetModules();
    });
}

function createDrumPreviewAction(): CreateDrumPreviewBranchesAction {
    const sourceClip = {
        trackId: 'track-kick',
        trackName: 'Kick',
        expectedTrackFrozen: false,
        clipId: 'clip-kick',
        clipName: 'Kick',
        expectedClipLocked: false,
        expectedNotes: [],
    };
    return {
        type: 'createDrumPreviewBranches',
        payload: {
            ownerId: 'owner',
            createdAt: 0,
            expectedSourceBranchId: 'main',
            expectedSourceHeads: [],
            expectedDocuments: [],
            expectedBranchState: { activeBranchId: 'main', branches: [] },
            sectionId: 'section',
            sectionName: 'Verse',
            sectionStartBeat: 0,
            sectionEndBeat: 4,
            candidateCount: 3,
            varyingRoles: ['snare', 'hi-hat'],
            kick: sourceClip,
            snare: sourceClip,
            hiHat: sourceClip,
            candidates: [],
        },
    };
}

describe('slot projection registry before registration', () => {
    startFromFreshModules();

    it('refuses a full projection instead of projecting nothing', async () => {
        const { projectCrdtToStores } = await import('../projectProjection');

        expect(() => projectCrdtToStores()).toThrow(`projectCrdtToStores: ${UNREGISTERED_FIX}`);
    });

    it('refuses a changed-slot projection instead of projecting nothing', async () => {
        const { projectChangedCrdtSlots } = await import('../projectChangedCrdtSlots');

        expect(() => projectChangedCrdtSlots({ changedSlots: ['tracks'], origin: 'document' })).toThrow(
            `projectChangedCrdtSlots: ${UNREGISTERED_FIX}`
        );
    });

    it('refuses to prepare drum preview branches without their source reads', async () => {
        const { prepareDrumPreviewBranches } = await import('../../crdtBranching/prepareDrumPreviewBranches');

        expect(() => prepareDrumPreviewBranches(createDrumPreviewAction())).toThrow(
            'prepareDrumPreviewBranches: drum preview sources are not configured; call registerProjectSlotProjections() from #/app/registerProjectSlotProjections (bootstrap does this)'
        );
    });
});

describe('production slot projection registration', () => {
    it('accepts the production registration again, in the same order', () => {
        registerProjectSlotProjections();
        const first = projectSlotProjectionRegistry.read('spec').map(({ slot }) => slot);
        registerProjectSlotProjections();

        expect(projectSlotProjectionRegistry.read('spec').map(({ slot }) => slot)).toEqual(first);
    });
});

describe('slot projection registration', () => {
    startFromFreshModules();

    it('refuses to rebind a registered slot to another projection', async () => {
        const { kernelSlotProjections, projectSlotProjectionRegistry: registry } =
            await import('../projectSlotProjections');
        const { slotProjection } = await import('../slotProjection');
        const store = { hydrate: vi.fn() };
        registry.configure([
            slotProjection({ slot: 'tracks', getStore: () => store }),
            kernelSlotProjections.actionHistory,
            kernelSlotProjections.commandBatchIdempotency,
        ]);

        expect(() =>
            registry.configure([
                slotProjection({ slot: 'tracks', getStore: () => store }),
                kernelSlotProjections.actionHistory,
                kernelSlotProjections.commandBatchIdempotency,
            ])
        ).toThrow(
            "projectSlotProjectionRegistry.configure: slot 'tracks' is already registered with a different projection"
        );
    });

    it('refuses a list that names one slot twice', async () => {
        const { kernelSlotProjections, projectSlotProjectionRegistry: registry } =
            await import('../projectSlotProjections');
        const { slotProjection } = await import('../slotProjection');
        const store = { hydrate: vi.fn() };

        expect(() =>
            registry.configure([
                slotProjection({ slot: 'tracks', getStore: () => store }),
                slotProjection({ slot: 'tracks', getStore: () => store }),
                kernelSlotProjections.actionHistory,
                kernelSlotProjections.commandBatchIdempotency,
            ])
        ).toThrow("projectSlotProjectionRegistry.configure: slot 'tracks' is registered twice");
    });

    it('refuses a list that drops a kernel slot', async () => {
        const { kernelSlotProjections, projectSlotProjectionRegistry: registry } =
            await import('../projectSlotProjections');

        expect(() => registry.configure([kernelSlotProjections.actionHistory])).toThrow(
            "projectSlotProjectionRegistry.configure: kernel slot 'commandBatchIdempotency' must be registered with its built-in projection"
        );
        expect(() => registry.read('spec')).toThrow(`spec: ${UNREGISTERED_FIX}`);
    });
});
