import { expandMidiTransform } from '#/modules/Command/useCases';
import { LEGACY_MIDI_PROBABILITY_SEED, type MidiStoreState } from '#/modules/MIDI/stores';

/** A MIDI store holding nothing. The store barrel publishes the seed, not the whole default state. */
export function emptyMidiState(): MidiStoreState {
    return {
        probabilitySeed: LEGACY_MIDI_PROBABILITY_SEED,
        notesByClipId: {},
        ccByClipId: {},
        pitchBendByClipId: {},
    };
}

/**
 * A request that names no track, no clip and no beat. Everything the batch touches is an object the
 * plan invents, which is what makes it a high-level intent rather than an instruction to edit.
 */
export const BLUES_PROMPT = 'create a blues song with this chord progression';

export const BLUES_CLIP_START_BEAT = 0;
export const BLUES_CLIP_END_BEAT = 16;
export const BLUES_TRANSFORM_BARS = 4;
export const BLUES_TRANSFORM_SEED = 7;

export const GENERATED_TRACK_ID = /^track-ai-/u;
export const GENERATED_CLIP_ID = /^clip-ai-/u;

export type ProviderCall = { name: string; arguments: Record<string, unknown> };

export type MaterializedNote = { pitch: number; startBeat: number; duration: number; velocity: number };

/**
 * The intents the run searches for. Each one has to surface the command the proposal then names, so
 * the discovery turn can only ask for schemas the index actually returned.
 */
export const SEARCH_INTENTS = ['create a midi track', 'add a clip', 'chord progression'] as const;

export const TEMPO_SEARCH_INTENT = 'change the project tempo';

export const PROPOSED_COMMAND_NAMES = ['addTrack', 'addClip', 'chordProgression'] as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getProviderSection(userMessage: string, section: string): Record<string, unknown> {
    const match = new RegExp(String.raw`^${section}:\n(?<payload>.+)$`, 'mu').exec(userMessage);
    const payload = match?.groups?.payload;
    if (!payload) {
        throw new TypeError(`Expected ${section} in provider request`);
    }
    const parsed: unknown = JSON.parse(payload);
    if (!isRecord(parsed)) {
        throw new TypeError(`Expected object-shaped ${section}`);
    }
    return parsed;
}

/** The application tool receipts the previous turn produced, as the provider is shown them. */
export function getApplicationToolReceipts(userMessage: string): unknown[] {
    const evidence = getProviderSection(userMessage, 'relevant_evidence');
    if (!Array.isArray(evidence.receipts)) {
        throw new TypeError('Expected serialized application tool receipts in provider request');
    }
    const receiptSummary = evidence.receipts.find(
        (receipt) =>
            isRecord(receipt) &&
            receipt.id === 'application-tool-loop' &&
            isRecord(receipt.summary) &&
            receipt.summary.truncated === false &&
            typeof receipt.summary.value === 'string'
    );
    if (!isRecord(receiptSummary) || !isRecord(receiptSummary.summary)) {
        throw new TypeError('Expected application tool receipt context in provider request');
    }
    const lines = String(receiptSummary.summary.value).split('\n');
    const parsed: unknown = JSON.parse(lines.at(-1) ?? '');
    if (!isRecord(parsed) || !Array.isArray(parsed.receipts)) {
        throw new TypeError('Expected serialized application tool receipt list');
    }
    return parsed.receipts;
}

/** Every command name the command-index search receipts returned, across all searched intents. */
export function getSearchedCommandNames(userMessage: string): Set<string> {
    const names = new Set<string>();
    for (const receipt of getApplicationToolReceipts(userMessage)) {
        if (
            !isRecord(receipt) ||
            receipt.toolName !== 'agent.command-index.search' ||
            receipt.status !== 'success' ||
            !isRecord(receipt.data) ||
            !Array.isArray(receipt.data.items)
        ) {
            continue;
        }
        for (const item of receipt.data.items) {
            if (isRecord(item) && typeof item.name === 'string') {
                names.add(item.name);
            }
        }
    }
    return names;
}

export function getDiscoveryReceipt(userMessage: string): Record<string, unknown> {
    const discovery = getApplicationToolReceipts(userMessage).find(
        (receipt) => isRecord(receipt) && receipt.toolName === 'agent.catalog.discover'
    );
    if (!isRecord(discovery)) {
        throw new TypeError('Expected a command catalog discovery receipt');
    }
    return discovery;
}

export function assertDiscoveredCommandSchemas(userMessage: string, names: readonly string[]): void {
    const discovery = getDiscoveryReceipt(userMessage);
    if (
        discovery.status !== 'success' ||
        !isRecord(discovery.data) ||
        discovery.data.schema !== 'sourdaw.agent-tool-catalog' ||
        discovery.data.schemaVersion !== 1 ||
        discovery.data.category !== 'command' ||
        discovery.data.truncated !== false ||
        !Array.isArray(discovery.data.items)
    ) {
        throw new TypeError('Expected a successful complete command catalog discovery receipt');
    }
    const disclosedNames = new Set(
        discovery.data.items.flatMap((item) =>
            isRecord(item) && isRecord(item.function) && typeof item.function.name === 'string'
                ? [item.function.name]
                : []
        )
    );
    for (const name of names) {
        if (!disclosedNames.has(name)) {
            throw new TypeError(`Expected disclosed command schema for ${name}`);
        }
    }
}

function bluesPlan() {
    return {
        semantic: { classification: 'complex', uncertainty: [] },
        objective: 'Lay out a blues chord progression on a MIDI track this batch creates.',
        constraints: ['Leave every object the project already holds unchanged.'],
        scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
        // A transform is a list item the compiler expands, never a capability the run holds, so the
        // plan claims none: the application derives the capabilities from what the batch compiles to.
        capabilityIds: [],
        assetIds: [],
        alternatives: [],
        validationStrategy: ['Validate that the notes land inside the clip the batch creates.'],
        stoppingConditions: ['Stop if the created clip cannot hold the progression.'],
    };
}

/**
 * The proposal a high-level blues request compiles to: a MIDI track, a clip on it, and a transform
 * that writes into that clip. No item names an object the project already holds.
 */
export function bluesProposalItems(): Array<Record<string, unknown>> {
    return [
        { id: 'make-track', name: 'addTrack', arguments: { name: 'Blues Comp', kind: 'midi', binding: 'band' } },
        {
            id: 'make-clip',
            name: 'addClip',
            arguments: {
                trackId: '$band',
                startBeat: BLUES_CLIP_START_BEAT,
                endBeat: BLUES_CLIP_END_BEAT,
                name: 'Verse',
                binding: 'verse',
            },
            dependsOn: ['make-track'],
        },
        {
            id: 'write-chords',
            name: 'chordProgression',
            arguments: {
                clipId: '$verse',
                style: 'blues',
                bars: BLUES_TRANSFORM_BARS,
                seed: BLUES_TRANSFORM_SEED,
            },
            dependsOn: ['make-clip'],
        },
    ];
}

export function proposeCall(items: ReadonlyArray<Record<string, unknown>>): ProviderCall {
    return {
        name: 'command.batch.propose',
        arguments: { plan: bluesPlan(), list: { schemaVersion: 1, items: [...items] } },
    };
}

export function declineCall(args: Record<string, unknown>): ProviderCall {
    return { name: 'command.batch.decline', arguments: args };
}

/**
 * The notes the run must end up with, taken from the one route production uses to turn a requested
 * transform into `addNotes`. The oracle comes from the same generator the run does, so it proves the
 * wiring — request reaches `expandMidiTransform`, its output reaches the clip — and not the content
 * that generator produces. Generator content is pinned where the generator lives.
 */
export function deriveBluesTransformCommands(): Array<{ clipId: string; notes: readonly MaterializedNote[] }> {
    const expansion = expandMidiTransform({
        name: 'chordProgression',
        arguments: {
            clipId: '$verse',
            style: 'blues',
            bars: BLUES_TRANSFORM_BARS,
            seed: BLUES_TRANSFORM_SEED,
        },
        clipSpanBeats: BLUES_CLIP_END_BEAT - BLUES_CLIP_START_BEAT,
    });
    if (!('commands' in expansion)) {
        throw new TypeError(`Expected the blues transform to expand: ${expansion.rejectionReason}`);
    }
    return expansion.commands.map((command) => ({ clipId: command.clipId, notes: command.notes }));
}

export function deriveBluesNotes(): MaterializedNote[] {
    return deriveBluesTransformCommands().flatMap((command) => [...command.notes]);
}

type ProviderCompletionMock = {
    mockImplementation: (fn: (systemPrompt: string, userMessage: string) => Promise<string>) => unknown;
};

export type ScriptedTurn = (userMessage: string) => ProviderCall[];

/**
 * Drives the provider through an exact list of turns. Each turn sees the real user message, so a turn
 * can read the application receipts the previous one produced instead of assuming what they said.
 * A turn past the end of the script is a script defect, not a provider behaviour: it throws.
 */
export function scriptProviderTurns(completion: ProviderCompletionMock, turns: readonly ScriptedTurn[]): string[] {
    const seenMessages: string[] = [];
    completion.mockImplementation((_systemPrompt, userMessage) => {
        seenMessages.push(userMessage);
        const turn = turns[seenMessages.length - 1];
        if (!turn) {
            throw new Error(`Expected exactly ${String(turns.length)} provider turns`);
        }
        return Promise.resolve(JSON.stringify(turn(userMessage)));
    });
    return seenMessages;
}

/**
 * Repeats one attempt for as long as the run keeps asking. A rejected proposal earns a bounded
 * correction attempt, and how many the run spends is production's business: a script that pinned the
 * count would fail on a budget change rather than on the behaviour it is named for.
 */
export function cycleProviderAttempt(completion: ProviderCompletionMock, turns: readonly ScriptedTurn[]): string[] {
    const seenMessages: string[] = [];
    completion.mockImplementation((_systemPrompt, userMessage) => {
        seenMessages.push(userMessage);
        const turn = turns[(seenMessages.length - 1) % turns.length];
        if (!turn) {
            throw new Error('Expected at least one scripted provider turn');
        }
        return Promise.resolve(JSON.stringify(turn(userMessage)));
    });
    return seenMessages;
}

/**
 * One page entry per intent. The evidence the next turn is shown is bounded, and a full index page
 * for three intents plus the discovered schemas overruns it — which reaches the script as a missing
 * receipt rather than as a message about size.
 */
export function searchCalls(intents: readonly string[] = SEARCH_INTENTS): ProviderCall[] {
    return intents.map((intent) => ({
        name: 'agent.command-index.search',
        arguments: { intent, page: { limit: 1 } },
    }));
}

/**
 * Discovers only names the search receipts actually returned. Asking for anything else is what a
 * collapsed index would force, so the turn refuses instead of inventing the name.
 */
export function discoverSearchedCalls(names: readonly string[] = PROPOSED_COMMAND_NAMES): ScriptedTurn {
    return (userMessage) => {
        const searched = getSearchedCommandNames(userMessage);
        const missing = names.filter((name) => !searched.has(name));
        if (missing.length > 0) {
            throw new TypeError(`Command index search never returned: ${missing.join(', ')}`);
        }
        return [{ name: 'agent.catalog.discover', arguments: { category: 'command', names: [...names] } }];
    };
}

export function proposeDiscoveredCalls(
    items: ReadonlyArray<Record<string, unknown>>,
    names: readonly string[] = PROPOSED_COMMAND_NAMES
): ScriptedTurn {
    return (userMessage) => {
        assertDiscoveredCommandSchemas(userMessage, names);
        return [proposeCall(items)];
    };
}

/** Search, discover what the search returned, then propose the blues song. */
export function scriptHighLevelIntentProvider(
    completion: ProviderCompletionMock,
    items: ReadonlyArray<Record<string, unknown>> = bluesProposalItems()
): string[] {
    return scriptProviderTurns(completion, [
        () => searchCalls(),
        discoverSearchedCalls(),
        proposeDiscoveredCalls(items),
    ]);
}
