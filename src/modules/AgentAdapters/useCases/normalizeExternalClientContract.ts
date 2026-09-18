/**
 * The published manifest, restated as the operations an external client may ask for.
 *
 * Every operation this module names is answered by exactly one owner contract,
 * so normalization is a lookup rather than a second source of truth: the
 * version an operation reports is the owner's own `schemaVersion`, copied. An
 * operation whose owner contract is absent from the manifest is `deferred` —
 * the module still names it, because a client needs to hear that it exists and
 * is not published rather than that it does not exist.
 *
 * `agent.capabilities` is the exception, and reads across the whole manifest
 * instead of one contract: it answers with the catalog built from every
 * published contract, so it carries this module's own schema version and is
 * deferred only when nothing at all is published.
 */

import {
    EXTERNAL_CLIENT_CONTRACT_SCHEMA_VERSION,
    EXTERNAL_CLIENT_OPERATIONS,
    type ExternalClientOperation,
    type NormalizedExternalClientContract,
    type NormalizedExternalClientOperation,
} from '../models/ExternalClientContract';

import { externalClientManifestPort } from './externalClientManifestPort';

type PublishedContract = ReturnType<typeof externalClientManifestPort.read>[number];

/** Which owner contract answers each operation, by the id the manifest publishes. */
const OPERATION_OWNER_CONTRACT_IDS: Readonly<Record<Exclude<ExternalClientOperation, 'agent.capabilities'>, string>> = {
    'project.query': 'query',
    'project.discover': 'discovery',
    'command.preview': 'command',
    'command.approval': 'command',
    'receipt.read': 'receipt',
};

const CAPABILITIES_CONTRACT_ID = 'capabilities';

/** What a deferred operation reports instead of a version nothing published. */
const UNPUBLISHED_CONTRACT_VERSION = 'unpublished';

function normalizeOperation(
    name: ExternalClientOperation,
    contracts: readonly PublishedContract[]
): NormalizedExternalClientOperation {
    if (name === 'agent.capabilities') {
        return {
            name,
            contractId: CAPABILITIES_CONTRACT_ID,
            contractVersion: String(EXTERNAL_CLIENT_CONTRACT_SCHEMA_VERSION),
            availability: contracts.length > 0 ? 'available' : 'deferred',
        };
    }
    const contractId = OPERATION_OWNER_CONTRACT_IDS[name];
    const contract = contracts.find((published) => published.id === contractId);
    if (!contract) {
        return { name, contractId, contractVersion: UNPUBLISHED_CONTRACT_VERSION, availability: 'deferred' };
    }
    return { name, contractId, contractVersion: String(contract.schemaVersion), availability: 'available' };
}

export function normalizeExternalClientContract(): NormalizedExternalClientContract {
    const contracts = externalClientManifestPort.read();
    return {
        schemaVersion: EXTERNAL_CLIENT_CONTRACT_SCHEMA_VERSION,
        operations: EXTERNAL_CLIENT_OPERATIONS.map((name) => normalizeOperation(name, contracts)),
    };
}
