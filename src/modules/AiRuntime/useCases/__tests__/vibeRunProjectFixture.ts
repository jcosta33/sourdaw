import { vi } from 'vitest';

import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { type markerStore, type trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import {
    audioEngine,
    initEngineDeviceCollaborators,
    removeTrackStrip,
    type renderTrackSubgraphOffline,
} from '#/modules/AudioEngine/useCases';
import { setActionHistoryMetadataPort } from '#/modules/Command/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { type ToolCallResult } from '../../models/ToolCallResult';
import { type ToolSchema } from '../../models/ToolDefinitions';
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import { pendingActionConfirmationStore } from '../../stores/pendingActionConfirmationStore';
import { getBriefMixIntentCatalog } from '../getBriefMixIntentCatalog';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';

import { readCreativeInterpretationCatalog, selectCreativeInterpretationCall } from './highLevelIntentWorkflowFixture';
import { landProjectEdit } from './landProjectEdit';
import { metricGoalAudioBuffer } from './metricGoalWorkflowFixture';

/**
 * A whole-project vibe-run harness over the real planner, compiler, CRDT and measurement path: only
 * the provider turns and the offline renderer are scripted. Each spec still declares its own
 * `vi.mock` of the provider routing and of `#/modules/AudioEngine/useCases`, which hoisting needs.
 */
export type VibeRenderInput = Parameters<typeof renderTrackSubgraphOffline>[0];
type ProviderRequest = { userMessage: string; schemas: readonly ToolSchema[] };
type ScriptedPlanningTurn = (request: ProviderRequest) => ToolCallResult[];
type Track = NonNullable<typeof trackStore.value>['tracks'][number];
type Section = NonNullable<typeof markerStore.value>['sections'][number];
export type VibeConfirmation = NonNullable<typeof pendingActionConfirmationStore.value>['confirmations'][number];

export const VIBE_BRIEF_REVISION = 4;
/**
 * The vibe-run projects play fast and render at a low rate so two dozen tracks of whole-song renders
 * stay cheap to synthesize and reduce: at the transport's top tempo of 300 BPM a beat lasts a fifth of
 * a second, which every scripted render reads its timeline through, and 8 kHz still holds the
 * fixture's 3 kHz top below Nyquist. Every measurement reads the rate and length off its buffer.
 */
export const VIBE_TEMPO = 300;
export const SECONDS_PER_BEAT = 60 / VIBE_TEMPO;
const VIBE_RENDER_SAMPLE_RATE = 8_000;

export type VibeTrackSpec = { id: string; name: string; role: string };

export function vibeTrack(spec: VibeTrackSpec, endBeat: number): Track {
    return {
        ...createTrack({ id: spec.id, name: spec.name, kind: 'audio' }),
        clips: [
            {
                id: `${spec.id}-clip`,
                trackId: spec.id,
                name: 'Take',
                type: 'audio' as const,
                audioBufferId: `${spec.id}-buffer`,
                startBeat: 0,
                endBeat,
                fadeInBeats: 0,
                fadeOutBeats: 0,
                gain: 1,
                color: '#ffffff',
                locked: false,
                muted: false,
            },
        ],
    };
}

/** Consecutive sections of equal length, named in order, covering `count × beats` from beat 0. */
export function vibeSections(names: readonly string[], beats: number): Section[] {
    return names.map((name, index) => ({
        id: name.toLowerCase().replaceAll(' ', '-'),
        name,
        startBeat: index * beats,
        endBeat: (index + 1) * beats,
        color: '#ffffff',
    }));
}

/** Seeds the brief at its starting revision, stating each listed track's role as the user had. */
export function seedVibeBrief(roles: readonly VibeTrackSpec[] = []): void {
    landProjectEdit(() => {
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            productionBrief: {
                ...structuredClone(defaultProjectStoreState.productionBrief),
                revision: VIBE_BRIEF_REVISION,
                createdAt: 100,
                updatedAt: 100,
                trackRoles: roles.map((track) => ({
                    id: `role-${track.id}`,
                    trackId: track.id,
                    role: track.role,
                    createdAt: 100,
                })),
            },
        });
    });
}

const briefIntake: ScriptedPlanningTurn = ({ userMessage, schemas }) => {
    const catalog = readCreativeInterpretationCatalog(userMessage, schemas);
    const base = selectCreativeInterpretationCall({ catalog, modeId: 'brief' });
    return [
        {
            ...base,
            id: 'brief-intake',
            arguments: {
                ...base.arguments,
                answer: null,
                metricIntent: { kind: 'non-acoustic', uncertainty: 'none', objectives: [] },
            },
        },
    ];
};

const proposeBrief: ScriptedPlanningTurn = () => [
    {
        id: 'brief-proposal',
        name: 'command.batch.propose',
        arguments: {
            commands: [],
            compiledCallIds: ['brief-compile'],
            plan: {
                semantic: { classification: 'simple', uncertainty: [] },
                objective: 'Record the project intent the request describes.',
                constraints: [],
                scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
                capabilityIds: [],
                assetIds: [],
                alternatives: [],
                validationStrategy: ['Compare the brief revision before writing.'],
                stoppingConditions: ['Stop if the brief changes before Confirm.'],
            },
        },
    },
];

/** The provider admits a brief, compiles it with these characters, and proposes it. */
export function scriptVibeBriefRoute(input: { descriptors: readonly string[] }): void {
    const compile: ScriptedPlanningTurn = () => [
        {
            id: 'brief-compile',
            name: 'brief.compile',
            arguments: {
                vision: 'A chosen sound',
                mixIntent: {
                    catalogId: getBriefMixIntentCatalog().catalogId,
                    requestedDescriptors: [...input.descriptors],
                },
            },
        },
    ];
    const turns = [briefIntake, compile, proposeBrief];
    let calls = 0;
    vi.mocked(generateToolPlanningOutcome).mockImplementation(async (_system, userMessage, schemas) => {
        const turn = turns[calls];
        calls += 1;
        if (turn === undefined) {
            throw new Error(`Expected at most ${String(turns.length)} provider turns`);
        }
        return { status: 'complete', toolCalls: turn({ userMessage, schemas }) };
    });
}

/**
 * One rendered track as a timeline: a 100 Hz body beside a 3 kHz top, each scaled by the shelf
 * gains of the EQs the track carries and by `level` at each absolute second of the song. A render
 * starts at its own beat, so its first frame is the song at that beat, never at zero.
 */
export function renderVibeTimeline(input: VibeRenderInput, level: (songSeconds: number) => number): AudioBuffer {
    const track = input.renderTracks.find((candidate) => candidate.id === input.targetTrackId);
    if (track === undefined) {
        throw new Error('The render target is absent.');
    }
    const parameter = (id: string) =>
        track.devices.reduce((total, device) => total + (device.parameterValues[id] ?? 0), 0);
    const low = 10 ** (parameter('eq-low-gain') / 20);
    const high = 10 ** (parameter('eq-high-gain') / 20);
    const startSeconds = input.startBeat * SECONDS_PER_BEAT;
    return metricGoalAudioBuffer(
        (time) => {
            const song = startSeconds + time;
            return (
                level(song) *
                (0.4 * low * Math.sin(2 * Math.PI * 100 * song) + 0.2 * high * Math.sin(2 * Math.PI * 3000 * song))
            );
        },
        (input.endBeat - input.startBeat) * SECONDS_PER_BEAT,
        VIBE_RENDER_SAMPLE_RATE
    );
}

export async function sendVibeMessage(prompt: string, send: (prompt: string) => Promise<unknown>): Promise<void> {
    flushAutomergeStorageWrites();
    await send(prompt);
}

export function proposedVibeCards(): VibeConfirmation[] {
    return (pendingActionConfirmationStore.value?.confirmations ?? []).filter((card) => card.status === 'proposed');
}

export function requireOnlyProposedVibeCard(): VibeConfirmation {
    const cards = proposedVibeCards();
    if (cards.length !== 1 || cards[0] === undefined) {
        const last = chatStore.value?.messages.at(-1);
        throw new TypeError(
            `Expected one proposed card, found ${String(cards.length)}: ${last?.error ?? last?.content ?? 'no reply'}`
        );
    }
    return cards[0];
}

export function vibeCardContent(card: VibeConfirmation): string {
    return chatStore.value?.messages.find((message) => message.id === card.assistantMessageId)?.content ?? '';
}

const SECTION_BEATS = 8;
/** An ordinary song: eight sections of eight beats. */
export const ORDINARY_SONG_SECTIONS = vibeSections(
    ['Intro', 'Verse 1', 'Pre Chorus', 'Chorus 1', 'Verse 2', 'Chorus 2', 'Bridge', 'Outro'],
    SECTION_BEATS
);
export const ORDINARY_SONG_BEATS = ORDINARY_SONG_SECTIONS.length * SECTION_BEATS;

const FAMILY_TRACKS: Readonly<Record<string, readonly (readonly [name: string, role: string])[]>> = {
    drums: [
        ['Kick', 'kick'],
        ['Snare', 'snare'],
        ['Hats', 'hi-hat'],
        ['Toms', 'tom'],
        ['Overheads', 'overhead'],
        ['Room', 'room'],
        ['Shaker', 'percussion'],
    ],
    vocal: [
        ['Lead Vox', 'lead vocal'],
        ['Double', 'lead vocal'],
        ['Harmony High', 'backing vocal'],
        ['Harmony Low', 'backing vocal'],
        ['Ad Libs', 'backing vocal'],
    ],
    bass: [
        ['Bass DI', 'bass'],
        ['Bass Amp', 'bass'],
    ],
    guitar: [
        ['Rhythm L', 'guitar'],
        ['Rhythm R', 'guitar'],
        ['Lead Gtr', 'guitar'],
        ['Acoustic', 'guitar'],
    ],
    keys: [
        ['Piano', 'keys'],
        ['Rhodes', 'keys'],
        ['Organ', 'keys'],
        ['Synth Lead', 'synth'],
        ['Pad', 'pad'],
        ['Strings', 'strings'],
    ],
};

/** Two dozen tracks across five role families of unequal size, one larger than a batch holds. */
export const ORDINARY_SONG_TRACKS: VibeTrackSpec[] = Object.values(FAMILY_TRACKS).flatMap((tracks) =>
    tracks.map(([name, role]) => ({ id: `track-${name.toLowerCase().replaceAll(' ', '-')}`, name, role }))
);

/** The engine collaborators and history port a confirmed batch needs to land its devices. */
export function prepareVibeRunEngine(): void {
    initEngineDeviceCollaborators();
    setActionHistoryMetadataPort({
        record: () => [],
        markReverted: () => ({ status: 'unavailable' as const }),
        clear: () => undefined,
    });
    clearAiHistory();
    setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
}

export function releaseVibeRunEngine(tracks: readonly VibeTrackSpec[]): void {
    for (const track of tracks) {
        removeTrackStrip(track.id);
    }
    audioEngine.setUseCaseDeviceCollaborators(null);
    clearAiHistory();
}
