/**
 * The application-owned capability contracts, stated once.
 *
 * The `agent.capabilities` receipt and the capability catalog discovery answers
 * from read this list, so an operation cannot be published to one surface and
 * withheld from the other. `availability` is the owner's own word for the
 * operation's state; a consumer that only distinguishes reachable from
 * unreachable maps it rather than the list restating it.
 */

import { ANALYSIS_REQUEST_TOOL_NAME, RENDER_REQUEST_TOOL_NAME } from './AgentToolCatalogNames';

export type AgentCapabilityAvailability = 'available' | 'proposal-only' | 'deferred';

export type AgentCapabilityOperation = {
    readonly name: string;
    readonly kind?: 'deferred-capability';
    readonly callable: boolean;
    readonly owner: string;
    readonly availability: AgentCapabilityAvailability;
    readonly reason?: string;
};

export const APPLICATION_OWNED_CAPABILITY_OPERATIONS: readonly AgentCapabilityOperation[] = [
    { name: 'command.batch.preview', callable: false, owner: 'Command', availability: 'available' },
    { name: 'command.batch.commit', callable: false, owner: 'Command', availability: 'available' },
    { name: 'command.approval', callable: false, owner: 'Command', availability: 'available' },
    { name: RENDER_REQUEST_TOOL_NAME, callable: true, owner: 'AiRuntime', availability: 'proposal-only' },
    { name: ANALYSIS_REQUEST_TOOL_NAME, callable: true, owner: 'AiRuntime', availability: 'proposal-only' },
];

/** Whether a caller can reach the operation at all, from the owner's declared state. */
export function isCapabilityReachable(availability: AgentCapabilityAvailability): boolean {
    return availability !== 'deferred';
}
