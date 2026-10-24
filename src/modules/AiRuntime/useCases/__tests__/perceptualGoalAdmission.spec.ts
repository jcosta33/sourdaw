import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { type ProjectContext, type ProjectContextTrack } from '../../models/ProjectContext';
import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';
import { getProjectContext } from '../getProjectContext';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { parsePromptToActions } from '../parsePromptToActions';
import { prepareCreativeInterpretationCatalog } from '../prepareCreativeInterpretationCatalog';

import { createTrack } from './trackFixture';

vi.mock('../llmOrchestration/inference', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../llmOrchestration/inference')>()),
    generateToolPlanningOutcome: vi.fn(),
}));

const vocals: ProjectContextTrack = {
    id: 'track-vocals',
    name: 'Vocals',
    kind: 'audio',
    canonicalRole: { role: 'lead vocal', source: 'name-tags', evidence: 'name-tokens' },
    muted: false,
    soloed: false,
    soloSafe: false,
    armed: false,
    gain: 0.8,
    pan: 0,
    automationMode: 'read',
    outputId: 'master',
    clipCount: 0,
    deviceCount: 0,
    clips: [],
    devices: [],
    sends: [],
};
const context: ProjectContext = {
    ...getProjectContext(),
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
    tracks: [vocals],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};
const decline = {
    id: 'decline-1',
    name: 'command.batch.decline',
    arguments: { kind: 'clarify', reason: 'Warmth is subjective.', questions: ['What do you mean by warmer?'] },
};

function repeatClarifications(): void {
    let turn = 0;
    vi.mocked(generateToolPlanningOutcome).mockImplementation(async () => {
        turn += 1;
        return { status: 'complete', toolCalls: [{ ...decline, id: `decline-${String(turn)}` }] };
    });
}

describe('perceptual goal admission', () => {
    let originalTrackState: typeof trackStore.value;

    beforeEach(() => {
        originalTrackState = trackStore.value;
        vi.mocked(generateToolPlanningOutcome).mockReset();
    });

    afterEach(() => {
        if (trackStore.value !== originalTrackState) {
            trackStore.set(originalTrackState);
        }
        vi.restoreAllMocks();
    });

    it.each(['local', 'anthropic', 'openai', 'openai-compatible'] as const)(
        'refuses needless clarification through the real %s planning loop and accepts the next recipe proposal',
        async (route) => {
            trackStore.set({
                tracks: [createTrack({ id: vocals.id, name: vocals.name })],
                selectedTrackId: null,
                ghostClips: [],
            });
            const planningContext = getProjectContext();
            const liveBefore = trackStore.value;
            const revisionBefore = captureProjectRevision();
            const snapshotBefore = structuredClone(planningContext);
            const providerTurn = route === 'local' ? undefined : { provider: route, assistantItems: null };
            const catalog = prepareCreativeInterpretationCatalog({
                prompt: 'make Vocals warmer',
                context: planningContext,
                projectRevision: 'snapshot-1',
            });
            vi.mocked(generateToolPlanningOutcome)
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [decline], providerTurn })
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'interpret-1',
                            name: 'selectCreativeInterpretation',
                            arguments: {
                                catalogId: catalog.catalogId,
                                modeId: 'edit',
                                targetCandidateIds: ['target-1'],
                                editDimensionCandidateIds: ['dimension-processing'],
                                constraintCandidateIds: [],
                                creationSlotIds: catalog.creationSlots
                                    .filter(
                                        (slot) => slot.objectType === 'device' && slot.parentCandidateId === 'target-1'
                                    )
                                    .map((slot) => slot.candidateId),
                                uncertainty: 'none',
                            },
                        },
                    ],
                })
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'discover-1',
                            name: 'recipe.discover',
                            arguments: { descriptors: ['warmer'], targetId: vocals.id },
                        },
                        {
                            id: 'expand-1',
                            name: 'recipe.expand',
                            arguments: { recipeId: 'vocal-warm', targetId: vocals.id },
                        },
                    ],
                })
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'proposal-1',
                            name: 'command.batch.propose',
                            arguments: { commands: [], compiledCallIds: ['expand-1'] },
                        },
                    ],
                });

            const result = await parsePromptToActions({
                prompt: 'make Vocals warmer',
                context: planningContext,
                projectRevision: 'snapshot-1',
            });

            expect(result.rejectionReason).toBeUndefined();
            expect(result.planningOutcome?.kind).toBe('proposal');
            expect(result.actions.some((action) => action.type === 'addDevice')).toBe(true);
            expect(result.adoptedRecipes).toMatchObject([{ recipeId: 'vocal-warm', targetId: vocals.id }]);
            expect(result.applicationToolReceipts).toMatchObject([
                {
                    callId: 'decline-1',
                    toolName: 'command.batch.decline',
                    status: 'failure',
                    error: { code: 'decline-not-admitted', retryable: true },
                },
                { callId: 'interpret-1', toolName: 'selectCreativeInterpretation', status: 'success' },
                { callId: 'discover-1', toolName: 'recipe.discover', status: 'success' },
                { callId: 'expand-1', toolName: 'recipe.expand', status: 'success' },
            ]);
            expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(4);
            const continuation = vi.mocked(generateToolPlanningOutcome).mock.calls[1];
            expect(continuation?.[1]).toContain('decline-not-admitted');
            expect(continuation?.[10]).toContain('decline-not-admitted');
            expect(continuation?.[9]?.history).toHaveLength(route === 'local' ? 0 : 1);
            if (route !== 'local') {
                expect(continuation?.[9]?.history[0]).toMatchObject({
                    calls: [{ id: 'decline-1', name: 'command.batch.decline' }],
                    receipts: [{ callId: 'decline-1', error: { code: 'decline-not-admitted' } }],
                });
            }
            expect(planningContext).toEqual(snapshotBefore);
            expect(trackStore.value).toBe(liveBefore);
            expect(captureProjectRevision()).toBe(revisionBefore);
        }
    );
    it('preserves an already-supported deterministic command without asking the provider', async () => {
        const result = await parsePromptToActions({ prompt: 'set tempo to 128', context });

        expect(result.actions).toEqual([{ type: 'setTempo', payload: { bpm: 128 } }]);
        expect(generateToolPlanningOutcome).not.toHaveBeenCalled();
    });

    it('ends honestly when every remaining turn repeats a clarification the application refuses', async () => {
        repeatClarifications();

        const result = await parsePromptToActions({
            prompt: 'make Vocals warmer',
            context,
            projectRevision: 'snapshot-1',
        });

        expect(result.actions).toEqual([]);
        expect(result.planningOutcome?.kind).toBe('denied');
        expect(result.rejectionReason).toContain('no turn remained');
        expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(4);
        expect(result.applicationToolReceipts).toHaveLength(3);
        expect(result.applicationToolReceipts?.every((receipt) => receipt.error?.code === 'decline-not-admitted')).toBe(
            true
        );
    });

    it.each([
        { label: 'literal name', prompt: 'make Vocals warmer', read: context },
        { label: 'quoted name', prompt: 'make "Vocals" warmer', read: context },
        { label: 'selection', prompt: 'make this track warmer', read: { ...context, selectedTrackId: vocals.id } },
        {
            label: 'role',
            prompt: 'make the vocal tracks warmer',
            read: {
                ...context,
                tracks: [
                    { ...vocals, name: 'Annie' },
                    {
                        ...vocals,
                        id: 'track-backing',
                        name: 'Bea',
                        canonicalRole: { role: 'backing vocal', source: 'name-tags', evidence: 'name-tokens' },
                    },
                ],
            },
        },
        {
            label: 'explicit target list',
            prompt: 'make Vocals and Keys warmer',
            read: {
                ...context,
                tracks: [
                    vocals,
                    {
                        ...vocals,
                        id: 'track-keys',
                        name: 'Keys',
                        canonicalRole: { role: 'keys', source: 'name-tags', evidence: 'name-tokens' },
                    },
                ],
            },
        },
        {
            label: 'quoted target list',
            prompt: 'make "Vocals" and "Keys" warmer',
            read: {
                ...context,
                tracks: [
                    vocals,
                    {
                        ...vocals,
                        id: 'track-keys',
                        name: 'Keys',
                        canonicalRole: { role: 'keys', source: 'name-tags', evidence: 'name-tokens' },
                    },
                ],
            },
        },
        { label: 'project scope', prompt: 'make the mix warmer', read: context },
        {
            label: 'quoted selection-like name',
            prompt: 'make "selected track" warmer',
            read: { ...context, tracks: [{ ...vocals, name: 'selected track' }], selectedTrackId: 'absent' },
        },
    ])('keeps planning a supported goal resolved by $label against its snapshot', async ({ prompt, read }) => {
        repeatClarifications();

        const result = await parsePromptToActions({ prompt, context: read, projectRevision: 'snapshot-1' });

        expect(result.applicationToolReceipts?.[0]).toMatchObject({
            callId: 'decline-1',
            error: { code: 'decline-not-admitted', retryable: true },
        });
        expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(4);
    });

    it.each([
        { label: 'unstated target', prompt: 'make it warmer', read: { ...context, selectedTrackId: vocals.id } },
        { label: 'absent selection', prompt: 'make the selected track warmer', read: context },
        { label: 'absent role', prompt: 'make the bass warmer', read: context },
        { label: 'absent named track', prompt: 'make Clarinet warmer', read: context },
        {
            label: 'tied names',
            prompt: 'make Vocals or Guitar warmer',
            read: { ...context, tracks: [vocals, { ...vocals, id: 'track-guitar', name: 'Guitar' }] },
        },
        { label: 'unresolved list member', prompt: 'make Vocals and "Missing" warmer', read: context },
        {
            label: 'duplicate names',
            prompt: 'make Vocals warmer',
            read: { ...context, tracks: [vocals, { ...vocals, id: 'track-vocals-2' }] },
        },
        { label: 'unknown descriptor', prompt: 'make Vocals holographic', read: context },
        {
            label: 'unrecognized role fragment',
            prompt: 'make the bas warmer',
            read: {
                ...context,
                tracks: [
                    {
                        ...vocals,
                        name: 'Low End',
                        canonicalRole: { role: 'bass', source: 'name-tags', evidence: 'name-tokens' },
                    },
                ],
            },
        },
        {
            label: 'descriptor only inside a name',
            prompt: 'change Bright Keys',
            read: { ...context, tracks: [{ ...vocals, name: 'Bright Keys' }] },
        },
        {
            label: 'quoted descriptor only inside a name',
            prompt: 'change "Bright Keys"',
            read: { ...context, tracks: [{ ...vocals, name: 'Bright Keys' }] },
        },
        {
            label: 'folder',
            prompt: 'make Vocals warmer',
            read: { ...context, tracks: [{ ...vocals, kind: 'folder' }] },
        },
        {
            label: 'frozen track',
            prompt: 'make Vocals warmer',
            read: { ...context, tracks: [{ ...vocals, frozen: true }] },
        },
        {
            label: 'unknown track role',
            prompt: 'make Vocals warmer',
            read: {
                ...context,
                tracks: [
                    { ...vocals, canonicalRole: { role: 'unknown', source: 'name-tags', evidence: 'name-tokens' } },
                ],
            },
        },
        {
            label: 'quoted absent reference beside a supported role',
            prompt: 'make "Missing" vocal warmer',
            read: context,
        },
        { label: 'incomplete quoted name', prompt: 'make warmer "Vocals', read: context },
        {
            label: 'frozen role target',
            prompt: 'make the vocal tracks warmer',
            read: { ...context, tracks: [{ ...vocals, name: 'Annie', frozen: true }] },
        },
        {
            label: 'frozen project scope',
            prompt: 'make the mix warmer',
            read: { ...context, tracks: [{ ...vocals, frozen: true }] },
        },
        { label: 'empty project', prompt: 'make the mix warmer', read: { ...context, tracks: [] } },
    ])('retains a genuine clarification for $label', async ({ prompt, read }) => {
        repeatClarifications();

        const result = await parsePromptToActions({ prompt, context: read, projectRevision: 'snapshot-1' });

        expect(result.planningOutcome?.kind).toBe('clarify');
        expect(result.actions).toEqual([]);
        expect(result.applicationToolReceipts).toBeUndefined();
        expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(1);
    });

    it.each([
        { label: 'receipt', limits: { maxTotalReceiptBytes: 128 }, turns: 1, reason: 'bounded context budget' },
        { label: 'call', limits: { maxTotalCalls: 1 }, turns: 2, reason: 'total application tool-call budget' },
    ])('charges refused declines to the existing $label budget', async ({ limits, turns, reason }) => {
        let count = 0;
        const requestTurn = vi.fn(async () => {
            count += 1;
            return { status: 'complete' as const, toolCalls: [{ ...decline, id: `decline-${String(count)}` }] };
        });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'bounded-decline',
            terminalToolNames: new Set(['command.batch.decline']),
            declineAdmission: () => ({ status: 'refused', reason: 'This is work to plan.' }),
            requestTurn,
            limits,
        });

        expect(result).toMatchObject({ status: 'rejected', turns, reason: expect.stringContaining(reason) });
        expect(requestTurn).toHaveBeenCalledTimes(turns);
    });
});
