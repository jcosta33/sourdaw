/**
 * What an external client may reach, and what no adapter may do.
 *
 * Two halves. The behavioural half drives the real admission gate through a
 * real session store: a fresh session refuses everything reachable from
 * outside, a transport this build cannot carry never opens, the minted token is
 * what admits rather than the client's name, revoking it is a different refusal
 * from never having had one, and a grant is bound to the project it was issued
 * against on both sides. The source half is a census over this module's own
 * files, because "an adapter never executes, commits or confirms" is a property
 * of the whole module rather than of any one call: a future file that imported
 * the document, the batch executor or the desktop bridge from the wrong place
 * would pass every behavioural test above and still break it.
 *
 * The owners' payload parsers are the real ones. A mocked parser would let this
 * spec agree with an adapter that admitted payloads the published contract
 * refuses.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    EXTERNAL_CLIENT_CONTRACT_SCHEMA_VERSION,
    type ExternalClientOperation,
    type ExternalClientRequest,
    type ExternalClientTransport,
} from '../../models/ExternalClientContract';
import { externalClientSessionStore, resetExternalClientSession } from '../../stores/externalClientSessionStore';
import { admitExternalClientRequest } from '../admitExternalClientRequest';
import { disableExternalClientTransport } from '../disableExternalClientTransport';
import { enableExternalClientTransport } from '../enableExternalClientTransport';
import { externalClientManifestPort } from '../externalClientManifestPort';
import { issueExternalClientGrant } from '../issueExternalClientGrant';
import { normalizeExternalClientContract } from '../normalizeExternalClientContract';
import { revokeExternalClientGrant } from '../revokeExternalClientGrant';
import { runCliClientRequest } from '../runCliClientRequest';
import { setExternalClientActiveProject } from '../setExternalClientActiveProject';

const {
    getAgentCapabilityCatalogMock,
    readNativeTransportSupportMock,
    parseVersionedCommandBatchEnvelopeMock,
    previewVersionedCommandBatchEnvelopeMock,
    executeVersionedCommandBatchEnvelopeMock,
    queryAgentDiscoveryMock,
    querySemanticProjectMock,
} = vi.hoisted(() => ({
    getAgentCapabilityCatalogMock: vi.fn(),
    readNativeTransportSupportMock: vi.fn(),
    parseVersionedCommandBatchEnvelopeMock: vi.fn(),
    previewVersionedCommandBatchEnvelopeMock: vi.fn(),
    executeVersionedCommandBatchEnvelopeMock: vi.fn(),
    queryAgentDiscoveryMock: vi.fn(),
    querySemanticProjectMock: vi.fn(),
}));

vi.mock('../../repositories/nativeTransportRepository', () => ({
    readNativeTransportSupport: readNativeTransportSupportMock,
}));

vi.mock('#/modules/AiRuntime/useCases', () => ({
    getAgentCapabilityCatalog: getAgentCapabilityCatalogMock,
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    parseVersionedCommandBatchEnvelope: parseVersionedCommandBatchEnvelopeMock,
    previewVersionedCommandBatchEnvelope: previewVersionedCommandBatchEnvelopeMock,
    executeVersionedCommandBatchEnvelope: executeVersionedCommandBatchEnvelopeMock,
}));

vi.mock('#/modules/Project/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/useCases')>()),
    queryAgentDiscovery: queryAgentDiscoveryMock,
    querySemanticProject: querySemanticProjectMock,
}));

const MODULE_ROOT = join(import.meta.dirname, '..', '..');
const PROJECT_ID = 'project-under-test';
const CLIENT_ID = 'client-under-test';
const QUERY_TYPE = 'project-summary';

/**
 * One published contract per owner this module maps an operation onto, each
 * carrying a distinct `schemaVersion` so a normalized version can only be
 * right by having been copied from the contract that owns the operation.
 */
const FIXTURE_CONTRACTS = [
    { id: 'command', owner: 'Command', schemaVersion: 3, operations: [] },
    { id: 'query', owner: 'Project', schemaVersion: 4, operations: [] },
    { id: 'discovery', owner: 'Project', schemaVersion: 5, operations: [] },
    { id: 'receipt', owner: 'Command', schemaVersion: 6, operations: [] },
] as const;

/** The token the last grant handed back, so a request can present the one it holds. */
let heldToken = '';

function publishedVersion(contractId: string): string {
    const contract = FIXTURE_CONTRACTS.find((candidate) => candidate.id === contractId);
    return contract ? String(contract.schemaVersion) : 'absent-from-fixture';
}

function grantFor(
    operations: readonly ExternalClientOperation[],
    transport: ExternalClientTransport = 'cli'
): string | null {
    const issued = issueExternalClientGrant({ clientId: CLIENT_ID, transport, operations });
    heldToken = issued?.token ?? '';
    return issued?.token ?? null;
}

function externalRequest(overrides: Partial<ExternalClientRequest> = {}): ExternalClientRequest {
    return {
        clientId: CLIENT_ID,
        transport: 'cli',
        operation: 'project.query',
        schemaVersion: EXTERNAL_CLIENT_CONTRACT_SCHEMA_VERSION,
        projectId: PROJECT_ID,
        grantToken: heldToken,
        payload: { type: QUERY_TYPE },
        ...overrides,
    };
}

/** The keys a completed result actually carries, so an extra one is visible. */
function completedData(result: ReturnType<typeof runCliClientRequest>): object {
    if (result.status !== 'completed' || typeof result.data !== 'object' || result.data === null) {
        return {};
    }
    return result.data;
}

/** A token of the right shape that no grant ever minted. */
function forgedToken(token: string): string {
    return token.startsWith('0') ? `1${token.slice(1)}` : `0${token.slice(1)}`;
}

function collectModuleSources(directory: string, into: string[]): string[] {
    for (const entry of readdirSync(directory)) {
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) {
            if (entry !== '__tests__') {
                collectModuleSources(path, into);
            }
            continue;
        }
        if (entry.endsWith('.ts')) {
            into.push(path);
        }
    }
    return into;
}

/** The names a barrel re-exports, aliases counted as the name callers see. */
function barrelExportNames(barrelPath: string): string[] {
    const source = readFileSync(barrelPath, 'utf8');
    const names: string[] = [];
    for (const block of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
        for (const entry of (block[1] ?? '').split(',')) {
            const name = entry
                .trim()
                .replace(/^type\s+/, '')
                .split(/\s+as\s+/)
                .at(-1);
            if (name) {
                names.push(name);
            }
        }
    }
    return names;
}

describe('external agent adapter conformance', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetExternalClientSession();
        heldToken = '';
        readNativeTransportSupportMock.mockReturnValue({ available: true });
        externalClientManifestPort.setProvider(() => FIXTURE_CONTRACTS);
        querySemanticProjectMock.mockReturnValue({ items: [] });
        queryAgentDiscoveryMock.mockReturnValue({ status: 'receipt' });
        getAgentCapabilityCatalogMock.mockReturnValue({ version: 'catalog-v1', entries: [] });
        parseVersionedCommandBatchEnvelopeMock.mockReturnValue({ status: 'valid', envelope: { commands: [] } });
        previewVersionedCommandBatchEnvelopeMock.mockReturnValue({ status: 'no-op', actions: [] });
    });

    it('refuses every externally reachable transport on a fresh session, and a local one for want of a grant', () => {
        expect(admitExternalClientRequest(externalRequest({ transport: 'mcp' }))).toEqual({
            status: 'refused',
            reason: 'transport-disabled',
        });
        expect(admitExternalClientRequest(externalRequest({ transport: 'remote' }))).toEqual({
            status: 'refused',
            reason: 'transport-disabled',
        });
        expect(admitExternalClientRequest(externalRequest({ transport: 'cli' }))).toEqual({
            status: 'refused',
            reason: 'grant-missing',
        });
    });

    it('opens an externally reachable transport only where a desktop shell carries it', () => {
        readNativeTransportSupportMock.mockReturnValue({ available: false });

        expect(enableExternalClientTransport('mcp')).toEqual({
            status: 'refused',
            reason: 'native-transport-unavailable',
        });
        expect(externalClientSessionStore.value?.enabledTransports).toEqual([]);
        expect(enableExternalClientTransport('cli')).toEqual({ status: 'enabled' });

        readNativeTransportSupportMock.mockReturnValue({ available: true });
        expect(enableExternalClientTransport('mcp')).toEqual({ status: 'enabled' });
        expect(externalClientSessionStore.value?.enabledTransports).toContain('mcp');
    });

    it('admits the token it minted, refuses a name presented without it, and keeps the token out of the session', () => {
        setExternalClientActiveProject(PROJECT_ID);
        const token = grantFor(['project.query']) ?? '';

        expect(token).toMatch(/^[0-9a-f]{64}$/);
        expect(admitExternalClientRequest(externalRequest()).status).toBe('admitted');

        const forged = admitExternalClientRequest(externalRequest({ grantToken: forgedToken(token) }));
        expect(forged).toEqual({ status: 'refused', reason: 'grant-missing' });
        expect(admitExternalClientRequest(externalRequest({ grantToken: '' }))).toEqual({
            status: 'refused',
            reason: 'grant-missing',
        });
        expect(JSON.stringify(forged)).not.toContain(token);
        expect(JSON.stringify(externalClientSessionStore.value)).not.toContain(token);
    });

    it('admits an enabled, granted client and refuses the same client once its grant is revoked', () => {
        setExternalClientActiveProject(PROJECT_ID);
        expect(enableExternalClientTransport('mcp')).toEqual({ status: 'enabled' });
        expect(grantFor(['project.query'], 'mcp')).not.toBeNull();

        expect(admitExternalClientRequest(externalRequest({ transport: 'mcp' })).status).toBe('admitted');

        revokeExternalClientGrant(CLIENT_ID);
        expect(admitExternalClientRequest(externalRequest({ transport: 'mcp' }))).toEqual({
            status: 'refused',
            reason: 'grant-revoked',
        });
    });

    it('refuses an operation the grant does not name', () => {
        setExternalClientActiveProject(PROJECT_ID);
        grantFor(['project.query']);

        expect(admitExternalClientRequest(externalRequest({ operation: 'project.discover' }))).toEqual({
            status: 'refused',
            reason: 'operation-not-granted',
        });
    });

    it('refuses a request naming another project, and one whose session moved on after the grant', () => {
        setExternalClientActiveProject(PROJECT_ID);
        grantFor(['project.query']);

        expect(admitExternalClientRequest(externalRequest({ projectId: 'another-project' }))).toEqual({
            status: 'refused',
            reason: 'project-scope-mismatch',
        });

        setExternalClientActiveProject('project-opened-later');
        expect(admitExternalClientRequest(externalRequest())).toEqual({
            status: 'refused',
            reason: 'project-scope-mismatch',
        });
    });

    it('refuses a client speaking a schema version this build does not publish', () => {
        setExternalClientActiveProject(PROJECT_ID);
        grantFor(['project.query']);

        expect(admitExternalClientRequest(externalRequest({ schemaVersion: 2 }))).toEqual({
            status: 'refused',
            reason: 'schema-version-unsupported',
        });
    });

    it('defers an operation whose owner contract is absent from the manifest, and refuses it as unpublished', () => {
        externalClientManifestPort.setProvider(() => FIXTURE_CONTRACTS.filter((contract) => contract.id !== 'receipt'));
        setExternalClientActiveProject(PROJECT_ID);
        grantFor(['receipt.read']);

        const receiptRead = normalizeExternalClientContract().operations.find(
            (operation) => operation.name === 'receipt.read'
        );
        expect(receiptRead?.availability).toBe('deferred');

        expect(admitExternalClientRequest(externalRequest({ operation: 'receipt.read' }))).toEqual({
            status: 'refused',
            reason: 'operation-not-published',
        });
    });

    it('carries each owner contract’s own schema version as the operation’s contract version', () => {
        const versions = Object.fromEntries(
            normalizeExternalClientContract().operations.map((operation) => [operation.name, operation.contractVersion])
        );

        expect(versions['project.query']).toBe(publishedVersion('query'));
        expect(versions['project.discover']).toBe(publishedVersion('discovery'));
        expect(versions['command.preview']).toBe(publishedVersion('command'));
        expect(versions['command.approval']).toBe(publishedVersion('command'));
        expect(versions['receipt.read']).toBe(publishedVersion('receipt'));
    });

    it('previews a command batch without ever executing one, and hands approval back to the local flow', () => {
        setExternalClientActiveProject(PROJECT_ID);
        grantFor(['command.preview', 'command.approval']);

        const previewed = runCliClientRequest(
            externalRequest({ operation: 'command.preview', payload: '{"schemaVersion":1}' })
        );
        expect(previewed.status).toBe('completed');
        expect(previewVersionedCommandBatchEnvelopeMock).toHaveBeenCalledOnce();
        expect(executeVersionedCommandBatchEnvelopeMock).not.toHaveBeenCalled();

        previewVersionedCommandBatchEnvelopeMock.mockClear();
        expect(runCliClientRequest(externalRequest({ operation: 'command.approval', payload: null }))).toEqual({
            status: 'approval-required',
            operation: 'command.approval',
        });
        expect(previewVersionedCommandBatchEnvelopeMock).not.toHaveBeenCalled();
        expect(executeVersionedCommandBatchEnvelopeMock).not.toHaveBeenCalled();
    });

    it('releases a previewed workspace and reports only what may leave the process', () => {
        const release = vi.fn();
        previewVersionedCommandBatchEnvelopeMock.mockReturnValue({
            status: 'previewed',
            actions: [{ action: { type: 'addTrack', payload: {} }, label: 'x' }],
            audioGraphValid: true,
            baseRevision: 'revision-under-test',
            projectDocument: { tracks: [] },
            projectInvariantsValid: true,
            partialAcceptance: { commandIds: [] },
            semanticDiff: { changed: [] },
            resource: { baseRevision: 'revision-under-test', release },
        });
        setExternalClientActiveProject(PROJECT_ID);
        grantFor(['command.preview']);

        const previewed = runCliClientRequest(
            externalRequest({ operation: 'command.preview', payload: '{"schemaVersion":1}' })
        );

        expect(release).toHaveBeenCalledOnce();
        expect(previewed).toEqual({
            status: 'completed',
            operation: 'command.preview',
            data: { status: 'previewed', baseRevision: 'revision-under-test', actionLabels: ['x'] },
        });
        expect(Object.keys(completedData(previewed))).toEqual(['status', 'baseRevision', 'actionLabels']);
    });

    it('refuses a malformed query payload without reaching the owner', () => {
        setExternalClientActiveProject(PROJECT_ID);
        grantFor(['project.query']);

        expect(runCliClientRequest(externalRequest({ payload: { type: QUERY_TYPE, unknownKey: 1 } }))).toEqual({
            status: 'refused',
            reason: 'payload-invalid',
        });
        expect(querySemanticProjectMock).not.toHaveBeenCalled();
    });

    it('closes a transport without deleting what was granted over it', () => {
        setExternalClientActiveProject(PROJECT_ID);
        expect(enableExternalClientTransport('remote')).toEqual({ status: 'enabled' });
        grantFor(['project.query'], 'remote');

        disableExternalClientTransport('remote');
        expect(admitExternalClientRequest(externalRequest({ transport: 'remote' }))).toEqual({
            status: 'refused',
            reason: 'transport-disabled',
        });
    });

    describe('module boundary census', () => {
        const sources = collectModuleSources(MODULE_ROOT, []);

        it('reads a module that actually has production sources', () => {
            expect(sources.length).toBeGreaterThan(5);
        });

        it('holds no route to the document, the batch executor, or a mutation of project truth', () => {
            const offenders = sources.filter((path) => {
                const source = readFileSync(path, 'utf8');
                return (
                    source.includes('@automerge') ||
                    source.includes('#/modules/CrdtDocument') ||
                    source.includes('executeVersionedCommandBatchEnvelope')
                );
            });

            expect(offenders).toEqual([]);
        });

        it('keeps the desktop bridge inside repositories/', () => {
            const bridgeCallers = sources.filter((path) =>
                readFileSync(path, 'utf8').includes('#/utils/desktopBridge')
            );

            expect(bridgeCallers).not.toEqual([]);
            expect(bridgeCallers.filter((path) => !path.includes(`${join('AgentAdapters', 'repositories')}`))).toEqual(
                []
            );
        });

        it('publishes no barrel symbol that executes, commits, confirms or mutates', () => {
            const published = [
                ...barrelExportNames(join(MODULE_ROOT, 'useCases', 'index.ts')),
                ...barrelExportNames(join(MODULE_ROOT, 'stores', 'index.ts')),
            ];

            expect(published).not.toEqual([]);
            expect(published.filter((name) => /execute|commit|confirm|mutate|change/i.test(name))).toEqual([]);
        });
    });
});
