import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ProjectContext } from '../../models/ProjectContext';
import { tryCompoundFastPath, tryParameterizedPath, tryPresetMatch } from '../../transformers/promptParser/parsing';
import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';
import { getAgentToolCatalogEntries } from '../getAgentToolCatalogEntries';
import { parsePromptToActions } from '../parsePromptToActions';

const DEFERRED_RECONSTRUCTION_NAME = 'agent.project.reconstruct';
const PROMPT = 'rebuild this song from these stems as a project';

const runtimeMocks = vi.hoisted(() => ({
    fetch: vi.fn<typeof fetch>(),
    generateWebLlmCompletion: vi.fn(),
}));

vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({
    getBackendChain: () => ['webllm'],
}));

vi.mock('../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: () => 'webllm',
}));

vi.mock('../../repositories/webLlm/generateWebLlmCompletion', () => ({
    generateWebLlmCompletion: runtimeMocks.generateWebLlmCompletion,
}));

vi.mock('../../repositories/webLlm/isWebLlmLoaded', () => ({
    isWebLlmLoaded: () => true,
}));

vi.mock('../../transformers/promptParser/parsing', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../transformers/promptParser/parsing')>();
    return {
        ...original,
        tryPresetMatch: vi.fn(original.tryPresetMatch),
        tryParameterizedPath: vi.fn(original.tryParameterizedPath),
        tryCompoundFastPath: vi.fn(original.tryCompoundFastPath),
    };
});

const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 0,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

function getProviderSection(userMessage: string, section: string): unknown {
    const match = new RegExp(String.raw`^${section}:\n(?<payload>.+)$`, 'mu').exec(userMessage);
    const payload = match?.groups?.payload;
    if (payload === undefined) {
        throw new TypeError(`Expected ${section} in the provider request`);
    }
    return JSON.parse(payload);
}

describe('agent reconstruction boundary (AC-048)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(tryPresetMatch).mockReturnValue([]);
        vi.mocked(tryParameterizedPath).mockReturnValue([]);
        vi.mocked(tryCompoundFastPath).mockReturnValue(null);
        vi.stubGlobal('fetch', runtimeMocks.fetch);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('reports agent.project.reconstruct as deferred in both the capabilities receipt and catalog discovery', async () => {
        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-reconstruct-capabilities',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn: vi
                .fn()
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [{ id: 'capabilities-1', name: 'agent.capabilities', arguments: {} }],
                })
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [] }),
        });

        const deferredEntry = {
            name: DEFERRED_RECONSTRUCTION_NAME,
            kind: 'deferred-capability',
            callable: false,
            owner: 'AiRuntime',
            availability: 'deferred',
            reason: expect.stringContaining('AC-048'),
        };
        expect(result.receipts.find((entry) => entry.callId === 'capabilities-1')?.data).toMatchObject({
            operations: expect.arrayContaining([deferredEntry]),
        });
        expect(
            getAgentToolCatalogEntries({ category: 'capability', names: [DEFERRED_RECONSTRUCTION_NAME] }).items
        ).toEqual([deferredEntry]);
    });

    it('rejects a reconstruction call for a rebuild-from-stems request without any media leaving the application', async () => {
        runtimeMocks.generateWebLlmCompletion.mockResolvedValue(
            JSON.stringify([
                {
                    name: DEFERRED_RECONSTRUCTION_NAME,
                    arguments: { source: 'these stems', target: 'project' },
                },
            ])
        );

        const result = await parsePromptToActions(PROMPT, context, undefined, 'revision-reconstruct');

        // The advertised tool set never carries the deferred name, so the request is refused one
        // gate before the loop; the loop refuses the same call on its own account below.
        expect(result).toMatchObject({
            actions: [],
            rejectionReason:
                'Provider planning rejected: Provider requested a tool that was not advertised for this request.',
        });
        expect(runtimeMocks.fetch).not.toHaveBeenCalled();

        const loopOutcome = await runApplicationOwnedToolLoop({
            loopId: 'loop-reconstruct-call',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn: vi.fn().mockResolvedValue({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'reconstruct-1',
                        name: DEFERRED_RECONSTRUCTION_NAME,
                        arguments: { source: 'these stems', target: 'project' },
                    },
                ],
            }),
        });
        expect(loopOutcome).toEqual({
            status: 'rejected',
            reason: 'Provider requested an unavailable application tool.',
            receipts: [],
            turns: 1,
        });

        const userMessage: unknown = runtimeMocks.generateWebLlmCompletion.mock.calls[0]?.[1];
        if (typeof userMessage !== 'string') {
            throw new TypeError('Expected one WebLLM planning request.');
        }
        expect(getProviderSection(userMessage, 'user_request')).toEqual({
            trust: 'untrusted_user_string',
            value: PROMPT,
            truncated: false,
        });
        // The only place the words "stems" and "song" appear is inside that untrusted user string:
        // the request carries no stem, audio or media field for the provider to read.
        expect(userMessage).not.toMatch(/"(?:stems|stemId|audio|pcm|samples|bytes|base64)"\s*:/u);
    });

    it('keeps ordinary application-owned stem import as the only route an import-stems search returns', () => {
        const catalog = getAgentToolCatalogEntries({ category: 'command-index', intent: 'import stems' });

        expect(catalog).toEqual({
            schema: 'sourdaw.intent-command-catalog',
            schemaVersion: 1,
            category: 'command-index',
            intent: 'import stems',
            items: [
                {
                    name: 'importStemSet',
                    purpose:
                        'Classify one exact application-selected stem set for application-owned tempo alignment, naming, grouping, and starting mix.',
                    semanticCategories: ['operation', 'import', 'stem', 'set', 'stems', 'create', 'starting', 'mix'],
                },
            ],
            nextCursor: null,
            page: { limit: 8, offset: 0, total: 1 },
            truncated: false,
        });
    });
});
