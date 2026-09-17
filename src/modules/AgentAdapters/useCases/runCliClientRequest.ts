/**
 * The reference external adapter: one CLI request, admitted then routed.
 *
 * It is deliberately small, and every other adapter is meant to look like it.
 * Admission runs first and nothing is routed until it answers `admitted`, so
 * the transport gate, the grant, the project scope and the schema version are
 * enforced in one place rather than once per client.
 *
 * What it will not do is the point. It reads, it previews, and it stops:
 * `command.approval` returns `approval-required` without touching anything,
 * because approving a change belongs to the local pending-action confirmation
 * flow, where a person sees it. No route here executes, commits or confirms,
 * and the boundary spec pins that no file in this module can — an adapter is
 * the far end of a wire, and a wire never gets to approve its own request.
 */

import { getAgentCapabilityCatalog } from '#/modules/AiRuntime/useCases';
import { parseVersionedCommandBatchEnvelope, previewVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { queryAgentDiscovery, querySemanticProject } from '#/modules/Project/useCases';

import {
    type ExternalClientOperation,
    type ExternalClientRefusalReason,
    type ExternalClientRequest,
} from '../models/ExternalClientContract';

import { admitExternalClientRequest } from './admitExternalClientRequest';
import { externalClientManifestPort } from './externalClientManifestPort';
import { parseExternalClientDiscoveryPayload } from './parseExternalClientDiscoveryPayload';
import { parseExternalClientQueryPayload } from './parseExternalClientQueryPayload';

type CliClientResult =
    | { status: 'completed'; operation: ExternalClientOperation; data: unknown }
    | { status: 'refused'; reason: ExternalClientRefusalReason }
    | { status: 'approval-required'; operation: ExternalClientOperation }
    | { status: 'not-implemented'; operation: ExternalClientOperation };

const payloadInvalid = { status: 'refused', reason: 'payload-invalid' } as const;

function runQuery(payload: unknown): CliClientResult {
    const parsed = parseExternalClientQueryPayload(payload);
    if (parsed.status === 'invalid') {
        return payloadInvalid;
    }
    return { status: 'completed', operation: 'project.query', data: querySemanticProject(parsed.input) };
}

function runDiscovery(payload: unknown): CliClientResult {
    const parsed = parseExternalClientDiscoveryPayload(payload);
    if (parsed.status === 'invalid') {
        return payloadInvalid;
    }
    return { status: 'completed', operation: 'project.discover', data: queryAgentDiscovery(parsed.input) };
}

/**
 * Preview a batch and hand back only what can safely leave this process.
 *
 * A previewed result owns an isolated workspace and the live project document
 * it built there. Neither may cross an external boundary — the document is a
 * project, not a report, and the workspace leaks until someone releases it. So
 * the adapter releases it here and answers with the outcome, the revision the
 * preview ran against, and the labels of the actions it prepared.
 */
function runPreview(payload: unknown): CliClientResult {
    if (typeof payload !== 'string') {
        return payloadInvalid;
    }
    const parsed = parseVersionedCommandBatchEnvelope(payload);
    if (parsed.status === 'invalid') {
        return payloadInvalid;
    }
    const preview = previewVersionedCommandBatchEnvelope(parsed.envelope);
    if (preview.status !== 'previewed') {
        return {
            status: 'completed',
            operation: 'command.preview',
            data: { status: preview.status, reason: 'reason' in preview ? preview.reason : null },
        };
    }
    const data = {
        status: preview.status,
        baseRevision: preview.baseRevision,
        actionLabels: preview.actions.map((prepared) => prepared.label),
    };
    preview.resource.release();
    return { status: 'completed', operation: 'command.preview', data };
}

/**
 * Every route this adapter has, one row per published operation.
 *
 * A table rather than a switch so the whole reachable surface can be read at
 * once — there is no execute, commit or confirm row, and the type requires a
 * row for any operation added to the contract, so a new one cannot quietly
 * inherit somebody else's behaviour.
 */
const EXTERNAL_CLIENT_ROUTES: Readonly<
    Record<ExternalClientOperation, (request: ExternalClientRequest) => CliClientResult>
> = {
    'project.query': (request) => runQuery(request.payload),
    'project.discover': (request) => runDiscovery(request.payload),
    'agent.capabilities': () => ({
        status: 'completed',
        operation: 'agent.capabilities',
        data: getAgentCapabilityCatalog(externalClientManifestPort.read()),
    }),
    'command.preview': (request) => runPreview(request.payload),
    'command.approval': () => ({ status: 'approval-required', operation: 'command.approval' }),
    'receipt.read': () => ({ status: 'not-implemented', operation: 'receipt.read' }),
};

export function runCliClientRequest(request: ExternalClientRequest): CliClientResult {
    const admission = admitExternalClientRequest(request);
    if (admission.status === 'refused') {
        return { status: 'refused', reason: admission.reason };
    }
    return EXTERNAL_CLIENT_ROUTES[request.operation](request);
}
