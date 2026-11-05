import { commandBatchIdempotencyStore } from '#/modules/Command/stores';

import { actionHistoryStore } from '../../stores/actionHistoryStore';

import { type ProjectSlotProjection, slotProjection } from './slotProjection';

/**
 * The slots the kernel itself owns. They are built here, and the composition
 * root places them in the registered order beside the domain modules' slots.
 */
export const kernelSlotProjections = {
    actionHistory: slotProjection({ slot: 'actionHistory', getStore: () => actionHistoryStore }),
    commandBatchIdempotency: slotProjection({
        slot: 'commandBatchIdempotency',
        getStore: () => commandBatchIdempotencyStore,
    }),
} as const;

let registeredProjections: readonly ProjectSlotProjection[] | null = null;

function assertDistinctSlots(projections: readonly ProjectSlotProjection[]): void {
    const seen = new Set<string>();
    for (const { slot } of projections) {
        if (seen.has(slot)) {
            throw new Error(`projectSlotProjectionRegistry.configure: slot '${slot}' is registered twice`);
        }
        seen.add(slot);
    }
}

function assertKernelSlotsPresent(projections: readonly ProjectSlotProjection[]): void {
    for (const kernelProjection of Object.values(kernelSlotProjections)) {
        if (!projections.includes(kernelProjection)) {
            throw new Error(
                `projectSlotProjectionRegistry.configure: kernel slot '${kernelProjection.slot}' must be registered with its built-in projection`
            );
        }
    }
}

function findFirstChangedSlot(
    current: readonly ProjectSlotProjection[],
    next: readonly ProjectSlotProjection[]
): string | null {
    const length = Math.max(current.length, next.length);
    for (let index = 0; index < length; index += 1) {
        if (current[index] !== next[index]) {
            return (next[index] ?? current[index])?.slot ?? null;
        }
    }
    return null;
}

/**
 * The ordered slot projection registry. The kernel cannot import the stores its
 * root slots project into, so the composition root
 * (`#/app/registerProjectSlotProjections`) configures it once at boot, before
 * anything can project; the list order is the projection order.
 */
export const projectSlotProjectionRegistry = {
    /**
     * Registering the identical list again is a no-op, so a caller that cannot
     * know whether registration already ran may repeat it. Any other change
     * refuses: a slot listed twice, a kernel slot missing its built-in
     * projection, or a list that differs from the registered one — a slot can
     * never be rebound to another projection once registered.
     */
    configure(projections: readonly ProjectSlotProjection[]): void {
        assertDistinctSlots(projections);
        assertKernelSlotsPresent(projections);
        if (registeredProjections === null) {
            registeredProjections = [...projections];
            return;
        }
        const changedSlot = findFirstChangedSlot(registeredProjections, projections);
        if (changedSlot !== null) {
            throw new Error(
                `projectSlotProjectionRegistry.configure: slot '${changedSlot}' is already registered with a different projection`
            );
        }
    },
    /**
     * The registered projections, in projection order. Projecting before
     * registration throws rather than projecting nothing: an empty registry
     * would silently skip every hydrate on a project load.
     */
    read(caller: string): readonly ProjectSlotProjection[] {
        if (registeredProjections === null) {
            throw new Error(
                `${caller}: slot projections are not registered; call registerProjectSlotProjections() from #/app/registerProjectSlotProjections (bootstrap does this)`
            );
        }
        return registeredProjections;
    },
};
