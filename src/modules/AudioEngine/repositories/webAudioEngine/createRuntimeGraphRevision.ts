import { logger } from '#/infra/logger/appLogger';

import type { TrackNodeRuntimeGraphMutation } from '../../engine/TrackNode';
import type {
    RuntimeGraphProjectRevisionValidator,
    RuntimeGraphTopologyValidator,
} from '../../models/RuntimeGraphDelta';

export type RuntimeGraphMutation<TValue> = Readonly<{
    value: TValue;
    changed: boolean;
}>;

export type RuntimeGraphMutationReceipt<TValue> = Readonly<{
    value: TValue;
    runtimeRevision: number;
}>;

export type RuntimeGraphRevision = {
    /** The live-engine revision a compiled delta must be correlated against. */
    current(): number;
    /**
     * The sole revision writer for control-thread graph topology. A public graph
     * command reports whether it materially changed the graph; compound commands
     * (for example, removing a strip and its dependent edges) therefore publish
     * one generation, while no-ops and completed rollbacks publish none.
     */
    mutate<TValue>(mutation: () => RuntimeGraphMutation<TValue>): RuntimeGraphMutationReceipt<TValue>;
    /** Publishes one generation for a mutation a strip reported after the fact. */
    recordMutation(mutation: TrackNodeRuntimeGraphMutation): void;
    projectRevisionValidator(): RuntimeGraphProjectRevisionValidator | null;
    /** null clears the contract: an unregistered validator is skipped, not fail-closed. */
    setProjectRevisionValidator(validator: RuntimeGraphProjectRevisionValidator | null): void;
    topologyValidator(): RuntimeGraphTopologyValidator | null;
    /** null clears the contract: an unregistered validator is skipped, not fail-closed. */
    setTopologyValidator(validator: RuntimeGraphTopologyValidator | null): void;
};

export function createRuntimeGraphRevision(): RuntimeGraphRevision {
    let revision = 0;
    let projectRevisionValidator: RuntimeGraphProjectRevisionValidator | null = null;
    let topologyValidator: RuntimeGraphTopologyValidator | null = null;

    function advance(): number {
        revision++;
        return revision;
    }

    function mutate<TValue>(mutation: () => RuntimeGraphMutation<TValue>): RuntimeGraphMutationReceipt<TValue> {
        const result = mutation();
        return Object.freeze({
            value: result.value,
            runtimeRevision: result.changed ? advance() : revision,
        });
    }

    function recordMutation(mutation: TrackNodeRuntimeGraphMutation): void {
        mutate(() => ({ value: undefined, changed: true }));
        if (mutation.application === 'needs-reconcile') {
            logger.warn(`[AudioEngine] ${mutation.reason}`);
        }
    }

    return {
        current: () => revision,
        mutate,
        recordMutation,
        projectRevisionValidator: () => projectRevisionValidator,
        setProjectRevisionValidator: (validator) => {
            projectRevisionValidator = validator;
        },
        topologyValidator: () => topologyValidator,
        setTopologyValidator: (validator) => {
            topologyValidator = validator;
        },
    };
}
