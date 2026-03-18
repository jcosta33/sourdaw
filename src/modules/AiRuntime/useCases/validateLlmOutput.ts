import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { type AppAction } from '#/modules/Command/useCases/commandQueries';
import { type ToolCallResult } from '../transformers/toolCallParser';
import { validateSingleAction, extractJsonString } from '../transformers/actionValidator';

const logger = Container.getInstance().get(Logger);

// ─── Action name aliases ─────────────────────────────────────────────────
// The LLM may use natural-language action names. Map them to canonical types.

const ACTION_NAME_ALIASES: Record<string, string> = {
    // Delete → Remove (LLM strongly prefers "delete")
    deleteTrack: 'removeTrack',
    deleteTracks: 'removeTrack',
    deleteAllTracks: 'removeAllTracks',
    deleteClip: 'removeClip',
    deleteDevice: 'removeDevice',
    deleteMarker: 'removeMarker',
    deleteSection: 'removeSection',
    deleteSend: 'removeSend',
    deleteSidechainRoute: 'removeSidechainRoute',

    // Play/Stop variants
    play: 'togglePlayback',
    pause: 'togglePlayback',
    stop: 'stopPlayback',
    record: 'toggleRecording',

    // Mix operations
    volume: 'setTrackGain',
    setVolume: 'setTrackGain',
    pan: 'setTrackPan',
    mute: 'muteTrack',
    unmute: 'muteTrack',
    solo: 'soloTrack',
    unsolo: 'soloTrack',

    // Common verb variants
    duplicate: 'duplicateTrack',
    bounce: 'bounceInPlace',
    freeze: 'freezeTrack',
    unfreeze: 'unfreezeTrack',
    quantize: 'quantizeNotes',
    transpose: 'transposeNotes',
    humanize: 'humanizeNotes',
    reverse: 'reverseClip',
    normalize: 'normalizeClip',
    arpeggiate: 'arpeggiate',
    arp: 'arpeggiate',

    // Sidechain
    sidechain: 'addSidechainRoute',
    addSidechain: 'addSidechainRoute',
    setupSidechain: 'addSidechainRoute',

    // Workspace
    mixer: 'openMixer',
    showMixer: 'openMixer',
    hideMixer: 'closeMixer',
};

// ─── Argument key aliases ────────────────────────────────────────────────
// The LLM may use variant argument names. Map to canonical keys.

const ARG_KEY_ALIASES: Record<string, string> = {
    // ID aliases
    id: 'trackId',
    track: 'trackId',
    clip: 'clipId',
    device: 'deviceId',
    marker: 'markerId',
    section: 'sectionId',
    lane: 'laneId',
    bus: 'busId',
    source: 'sourceTrackId',
    target: 'targetTrackId',

    // Value aliases
    volume: 'gain',
    vol: 'gain',
    level: 'gain',
    bpm: 'bpm',
    tempo: 'bpm',
    position: 'beat',

    // Boolean state aliases
    isMuted: 'muted',
    isSoloed: 'soloed',
    isArmed: 'armed',
    enabled: 'bypassed', // Note: inverted semantics handled in validator
};

// ─── Plural key expansion ────────────────────────────────────────────────

const PLURAL_TO_SINGULAR: Record<string, string> = {
    trackIds: 'trackId',
    clipIds: 'clipId',
    deviceIds: 'deviceId',
    markerIds: 'markerId',
    sectionIds: 'sectionId',
    laneIds: 'laneId',
    busIds: 'busId',
};

// ─── Normalization ───────────────────────────────────────────────────────

/**
 * Normalize a single tool call into one or more raw action objects.
 *
 * Handles:
 * 1. Action name aliases (deleteTrack → removeTrack)
 * 2. Argument key aliases (volume → gain, id → trackId)
 * 3. Plural arrays → expanded into individual actions
 * 4. Special patterns (removeAll, implicit boolean values)
 */
function normalizeToolCall(tc: ToolCallResult): Array<{ type: string; payload: Record<string, unknown> }> {
    // 1. Resolve action name alias
    const canonicalName = ACTION_NAME_ALIASES[tc.name] ?? tc.name;
    const args = { ...tc.arguments };

    // 1b. Flatten nested `args` object (model sometimes wraps real args inside args:{})
    if (typeof args.args === 'object' && args.args !== null && !Array.isArray(args.args)) {
        const nested = args.args as Record<string, unknown>;
        delete args.args;
        for (const [k, v] of Object.entries(nested)) {
            if (!(k in args)) {
                args[k] = v;
            }
        }
    }

    // 1c. Remove tool name echoed as argument (model sometimes puts name: "addTrack" in arguments)
    if (args.name === tc.name) {
        delete args.name;
    }

    // 2. Handle special removeAll pattern
    if (args.removeAll === true && (canonicalName === 'removeTrack' || canonicalName === 'deleteTrack')) {
        return [{ type: 'removeAllTracks', payload: {} }];
    }

    // 3. Handle implicit boolean values for mute/solo/unmute/unsolo
    if (tc.name === 'mute' || tc.name === 'unmute') {
        args.muted = tc.name === 'mute';
    }
    if (tc.name === 'solo' || tc.name === 'unsolo') {
        args.soloed = tc.name === 'solo';
    }

    // 4. Expand plural array keys into individual actions
    for (const [pluralKey, singularKey] of Object.entries(PLURAL_TO_SINGULAR)) {
        if (Array.isArray(args[pluralKey])) {
            const ids = args[pluralKey] as unknown[];
            delete args[pluralKey];
            delete args.removeAll;

            return ids
                .filter((id): id is string => typeof id === 'string')
                .map((id) => ({
                    type: canonicalName,
                    payload: applyArgAliases({ ...args, [singularKey]: id }),
                }));
        }
    }

    // 5. Apply argument key aliases
    return [{ type: canonicalName, payload: applyArgAliases(args) }];
}

function applyArgAliases(args: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
        const canonicalKey = ARG_KEY_ALIASES[key] ?? key;
        // Don't overwrite if canonical key already exists
        if (!(canonicalKey in result)) {
            result[canonicalKey] = value;
        }
    }
    return result;
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Convert tool call results from function calling into validated AppActions.
 * Each tool call maps: name → type (with alias resolution), arguments → payload.
 * Plural/batched calls are expanded into individual actions first.
 */
export function parseToolCallsToActions(toolCalls: ToolCallResult[]): AppAction[] {
    const actions: AppAction[] = [];

    for (const tc of toolCalls) {
        const normalized = normalizeToolCall(tc);

        for (const raw of normalized) {
            const action = validateSingleAction(raw);
            if (action) {
                actions.push(action);
            } else {
                logger.warn(`[AI] Tool call rejected by validation: ${raw.type}(${JSON.stringify(raw.payload)})`);
            }
        }
    }

    logger.info(`[AI] Parsed ${String(toolCalls.length)} tool calls → ${String(actions.length)} validated actions`);
    return actions;
}

/**
 * Parse raw JSON text from LLM output into validated AppActions.
 * Kept as fallback for non-function-calling models.
 */
export function parseLlmJsonToActions(raw: string): AppAction[] {
    logger.info(`[AI] Raw LLM output (${String(raw.length)} chars): ${raw.slice(0, 500)}`);

    const jsonStr = extractJsonString(raw);
    if (!jsonStr) {
        logger.warn('[AI] Could not extract valid JSON from LLM output');
        return [];
    }

    try {
        const parsed = JSON.parse(jsonStr) as unknown;
        if (typeof parsed !== 'object' || parsed === null) {
            logger.warn('[AI] Parsed JSON is not an object or array');
            return [];
        }

        const obj = parsed as Record<string, unknown>;
        const actionsRaw = Array.isArray(obj.actions) ? obj.actions : Array.isArray(parsed) ? parsed : [];

        if (actionsRaw.length === 0) {
            logger.warn('[AI] LLM output parsed but contained no actions array');
            return [];
        }

        const validated: AppAction[] = [];
        for (const item of actionsRaw) {
            const action = validateSingleAction(item);
            if (action) {
                validated.push(action);
            } else {
                logger.warn(`[AI] Action rejected by validation: ${JSON.stringify(item)}`);
            }
        }

        logger.info(`[AI] Parsed ${String(actionsRaw.length)} raw actions → ${String(validated.length)} validated`);
        return validated;
    } catch (error) {
        logger.warn(`[AI] JSON parse failed after extraction: ${String(error)}`);
        return [];
    }
}
