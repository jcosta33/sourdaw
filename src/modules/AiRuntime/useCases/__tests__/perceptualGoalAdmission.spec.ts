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

    it.each(
        (['local', 'anthropic', 'openai', 'openai-compatible'] as const).flatMap((route) =>
            (
                [
                    { label: 'unqualified edit', prompt: 'make Vocals warmer', outcome: 'proposal' },
                    {
                        label: 'resolved protected owner',
                        prompt: 'make Vocals warmer; leave the fader of Keys alone',
                        outcome: 'proposal',
                    },
                    {
                        label: 'resolved excluded owner',
                        prompt: 'make Vocals warmer except Keys',
                        outcome: 'proposal',
                    },
                    { label: 'read-only question', prompt: 'Is Vocals warmer?', outcome: 'clarify' },
                    {
                        label: 'missing protected owner',
                        prompt: 'make Vocals warmer; leave the fader of Ghost alone',
                        outcome: 'clarify',
                    },
                    {
                        label: 'ambiguous protected owner',
                        prompt: 'make Vocals warmer; leave the fader of Keys alone',
                        outcome: 'clarify',
                    },
                    {
                        label: 'missing excluded owner',
                        prompt: 'make the mix warmer except Missing',
                        outcome: 'clarify',
                    },
                    {
                        label: 'later missing target',
                        prompt: 'make Vocals warmer and Missing brighter',
                        outcome: 'clarify',
                    },
                    { label: 'unread suffix', prompt: 'make Vocals warmer 🚫', outcome: 'clarify' },
                ] as const
            ).map((scenario) => ({ route, ...scenario }))
        )
    )(
        'keeps explicit-preservation recipe planning bounded through $route for $label',
        async ({ route, prompt, outcome, label }) => {
            const tracks = [
                createTrack({ id: vocals.id, name: vocals.name }),
                createTrack({ id: 'track-keys', name: 'Keys' }),
            ];
            if (label === 'ambiguous protected owner') {
                tracks.push(createTrack({ id: 'track-other-keys', name: 'Keys' }));
            }
            trackStore.set({
                tracks,
                selectedTrackId: null,
                ghostClips: [],
            });
            const planningContext = getProjectContext();
            const liveBefore = trackStore.value;
            const revisionBefore = captureProjectRevision();
            const snapshotBefore = structuredClone(planningContext);
            const providerTurn = route === 'local' ? undefined : { provider: route, assistantItems: null };
            const catalog = prepareCreativeInterpretationCatalog({
                prompt,
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
                prompt,
                context: planningContext,
                projectRevision: 'snapshot-1',
            });

            expect(planningContext).toEqual(snapshotBefore);
            expect(trackStore.value).toBe(liveBefore);
            expect(captureProjectRevision()).toBe(revisionBefore);
            for (const call of vi.mocked(generateToolPlanningOutcome).mock.calls) {
                expect(call[4]).toBe(prompt);
            }
            if (outcome === 'clarify') {
                expect(result.planningOutcome?.kind).toBe('clarify');
                expect(result.actions).toEqual([]);
                expect(result.applicationToolReceipts).toBeUndefined();
                expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(1);
                return;
            }
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
        { label: 'polite delegated question', prompt: 'Can you make Vocals warmer?', read: context },
        {
            label: 'literal id containing a descriptor',
            prompt: 'make track-bright-vocals warmer',
            read: { ...context, tracks: [{ ...vocals, id: 'track-bright-vocals' }] },
        },
        { label: 'quoted name', prompt: 'make "Vocals" warmer', read: context },
        { label: 'selection', prompt: 'make this track warmer', read: { ...context, selectedTrackId: vocals.id } },
        {
            label: 'matching qualified selection',
            prompt: 'make the selected vocal track warmer',
            read: { ...context, selectedTrackId: vocals.id },
        },
        { label: 'coordinated descriptors', prompt: 'make Vocals warmer and brighter', read: context },
        {
            label: 'separate resolved goals',
            prompt: 'make Vocals warmer and Keys brighter',
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
        { label: 'repeated delegated goal', prompt: 'make Vocals warmer and make Vocals brighter', read: context },
        { label: 'greeting-prefixed target', prompt: 'hi, make Vocals warmer', read: context },
        { label: 'filler-prefixed target', prompt: 'please, make Vocals warmer', read: context },
        {
            label: 'actual courtesy-word name',
            prompt: 'make Hi warmer',
            read: { ...context, tracks: [{ ...vocals, name: 'Hi' }] },
        },
        {
            label: 'quoted courtesy-word name',
            prompt: 'make "Hi" warmer',
            read: { ...context, tracks: [{ ...vocals, name: 'Hi' }] },
        },
        {
            label: 'greeting-prefixed complete list',
            prompt: 'hi, make Vocals and Keys warmer',
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
            label: 'name containing and',
            prompt: 'make Rock and Roll warmer',
            read: { ...context, tracks: [{ ...vocals, name: 'Rock and Roll' }] },
        },
        {
            label: 'quoted name containing and',
            prompt: 'make "Rock and Roll" warmer',
            read: { ...context, tracks: [{ ...vocals, name: 'Rock and Roll' }] },
        },
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
        { label: 'read-only perceptual question', prompt: 'Is Vocals warmer?', read: context },
        {
            label: 'later unknown target with another descriptor',
            prompt: 'make Vocals warmer and Missing brighter',
            read: context,
        },
        {
            label: 'later unknown target with the same descriptor',
            prompt: 'make Vocals warmer and Missing warmer',
            read: context,
        },
        { label: 'unknown project carve-out', prompt: 'make the mix warmer except Missing', read: context },
        {
            label: 'unknown protected control owner',
            prompt: 'make Vocals warmer; leave the fader of Ghost alone',
            read: context,
        },
        {
            label: 'quoted unknown protected control owner',
            prompt: 'make Vocals warmer; leave the fader of "Ghost" alone',
            read: context,
        },
        { label: 'incomplete target expression', prompt: 'make Vocals Missing warmer', read: context },
        {
            label: 'unread descriptor continuation',
            prompt: 'make Vocals warmer and somehow brighter',
            read: context,
        },
        { label: 'unread symbol after the goal', prompt: 'make Vocals warmer 🚫', read: context },
        {
            label: 'unstated target in a later edit',
            prompt: 'make Vocals warmer and make warmer',
            read: context,
        },
        { label: 'unstated target', prompt: 'make it warmer', read: { ...context, selectedTrackId: vocals.id } },
        { label: 'absent selection', prompt: 'make the selected track warmer', read: context },
        {
            label: 'absent selection with a role qualifier',
            prompt: 'make the selected vocal track warmer',
            read: context,
        },
        { label: 'absent role', prompt: 'make the bass warmer', read: context },
        {
            label: 'actual courtesy-word target prefix',
            prompt: 'Hi, make Vocals warmer',
            read: { ...context, tracks: [vocals, { ...vocals, id: 'track-hi', name: 'Hi' }] },
        },
        {
            label: 'quoted courtesy-word target prefix',
            prompt: '"Hi", make Vocals warmer',
            read: { ...context, tracks: [vocals, { ...vocals, id: 'track-hi', name: 'Hi' }] },
        },
        {
            label: 'selected role mismatch',
            prompt: 'make the selected vocal track warmer',
            read: {
                ...context,
                selectedTrackId: 'track-keys',
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
        { label: 'absent named track', prompt: 'make Clarinet warmer', read: context },
        {
            label: 'tied names',
            prompt: 'make Vocals or Guitar warmer',
            read: { ...context, tracks: [vocals, { ...vocals, id: 'track-guitar', name: 'Guitar' }] },
        },
        { label: 'unresolved list member', prompt: 'make Vocals and "Missing" warmer', read: context },
        { label: 'unresolved unquoted list member', prompt: 'make Vocals and Missing warmer', read: context },
        { label: 'unresolved first unquoted list member', prompt: 'make Missing and Vocals warmer', read: context },
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
    ])('ends refused-decline loops at the existing $label budget', async ({ limits, turns, reason }) => {
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

    it('charges refused-decline payload bytes to the next turn receipt budget', async () => {
        type RequestTurnInput = Parameters<Parameters<typeof runApplicationOwnedToolLoop>[0]['requestTurn']>[0];
        const readNextTurnBudget = async (reason: string) => {
            const requestTurn = vi.fn(async (input: RequestTurnInput) => ({
                status: 'complete' as const,
                toolCalls: [{ ...decline, id: `decline-${String(input.turn)}` }],
            }));
            const result = await runApplicationOwnedToolLoop({
                loopId: 'decline-payload-charge',
                terminalToolNames: new Set(['command.batch.decline']),
                declineAdmission: () => ({ status: 'refused', reason }),
                requestTurn,
                limits: { maxTotalCalls: 1 },
            });

            expect(result).toMatchObject({
                status: 'rejected',
                turns: 2,
                reason: expect.stringContaining('total application tool-call budget'),
            });
            expect(requestTurn).toHaveBeenCalledTimes(2);
            const [first, next] = requestTurn.mock.calls;
            if (first === undefined || next === undefined) {
                throw new Error('Expected the admitted refusal receipt to reach the next request turn.');
            }
            return { initial: first[0].remaining.receiptBytes, next: next[0].remaining.receiptBytes };
        };

        const short = await readNextTurnBudget('Plan this goal.');
        const long = await readNextTurnBudget(
            'Plan this supported perceptual goal using the resolved target. Preserve every declared restriction and propose the recipe.'
        );

        expect(short.initial).toBe(long.initial);
        expect(short.next).toBeLessThan(short.initial);
        expect(long.next).toBeGreaterThan(0);
        expect(long.next).toBeLessThan(short.next);
    });
});
