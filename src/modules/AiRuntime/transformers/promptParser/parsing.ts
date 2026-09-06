/**
 * Transformer: pure prompt parsing and pattern matching.
 * No I/O — converts normalized user text into AppAction arrays using
 * bounded grammars and exact preset-command matching.
 */

import { PRESET_ACTIONS, type PresetContext } from '../../models/PresetActions/Registry';
import { type ProjectContext } from '../../models/ProjectContext';
import { type RuntimeAction } from '../../models/RuntimeAction';
import { getAvailablePresets } from '../../services/fuzzySearch';

import { MUSICAL_GENRE_PATTERN } from './musicalGenreVocabulary';

// ── Complexity detection ────────────────────────────────────────────────

/**
 * Returns true if this prompt is clearly a complex/compound instruction
 * that should skip the fast path and go directly to the LLM.
 */
export function isComplexPrompt(normalized: string): boolean {
    if (/\d+\s+tracks?/i.test(normalized)) {
        return true;
    }
    if (/\b(first|last|rest|remaining|each|every|all)\b/i.test(normalized) && /\b(track|clip)s?\b/i.test(normalized)) {
        return true;
    }
    if (/\bname\s+them\b/i.test(normalized)) {
        return true;
    }
    if (/\bthen\b/i.test(normalized)) {
        return true;
    }
    if ((normalized.match(/,/g) ?? []).length >= 2) {
        return true;
    }
    if (/\b(and|also|plus)\b.*\b(and|also|plus)\b/i.test(normalized)) {
        return true;
    }
    if (
        /\b(sound\s+like|make\s+it|give\s+it|effect|warm|crisp|lo-?fi|radio|distant|underwater|wider|thicker|brighter|darker|punchier|airy|muddy|tinny|vintage)\b/i.test(
            normalized
        )
    ) {
        return true;
    }
    if (/\b(staccato|legato|filter|sweep|sidechain|ducking|pumping)\b/i.test(normalized)) {
        return true;
    }
    // Session/song setup prompts — need LLM for creative decisions
    if (/\b(start|setup|create|build)\b.*\b(session|song|project|beat)\b/i.test(normalized)) {
        return true;
    }
    // Genre/style references that need creative interpretation
    if (MUSICAL_GENRE_PATTERN.test(normalized)) {
        return true;
    }
    // "add tracks" without a number — needs LLM to decide how many and what kind
    if (/\badd\s+tracks?\b/i.test(normalized) && !/\d+\s+tracks?/i.test(normalized)) {
        return true;
    }
    return false;
}

// ── Preset matching ─────────────────────────────────────────────────────

export function tryPresetMatch(normalized: string, context: PresetContext): RuntimeAction[] {
    const command = normalizeCommandText(normalized);
    const matches = PRESET_ACTIONS.filter((preset) =>
        [preset.label, ...(preset.commandAliases ?? [])].some(
            (candidate) => normalizeCommandText(candidate) === command
        )
    );
    if (matches.length !== 1) {
        return [];
    }

    const preset = matches[0]!;
    if (!getAvailablePresets(context).includes(preset)) {
        return [];
    }
    const result = preset.buildAction(context);
    if (result === null) {
        return [];
    }
    const actions = Array.isArray(result) ? result : [result];
    if (
        actions.some(
            (action) =>
                action.type === 'quantizeNotes' ||
                action.type === 'transposeNotes' ||
                action.type === 'invertNotes' ||
                action.type === 'retrogradeNotes' ||
                action.type === 'quantizeNoteLengths' ||
                action.type === 'scaleAllVelocities' ||
                action.type === 'setAllVelocities' ||
                action.type === 'setPunchEnabled'
        )
    ) {
        return [];
    }
    return actions;
}

export function buildPresetContext(context: ProjectContext): PresetContext {
    const selectedTrack = context.tracks.find((time) => time.id === context.selectedTrackId);
    const selectedClip =
        selectedTrack?.clips.find((context1) => context1.id === context.selectedClipId) ??
        context.tracks.flatMap((time) => time.clips).find((context1) => context1.id === context.selectedClipId);

    return {
        selectedTrackId: context.selectedTrackId ?? undefined,
        selectedTrackKind: selectedTrack?.kind,
        selectedClipId: context.selectedClipId ?? undefined,
        selectedClipType: selectedClip?.type,
        trackCount: context.tracks.length,
    };
}

// ── Parameterized patterns ──────────────────────────────────────────────

export function tryParameterizedPath(text: string, context: ProjectContext): RuntimeAction[] {
    const selectedTrack = context.tracks.find((time) => time.id === context.selectedTrackId);
    const selectedClipId = context.selectedClipId;

    const bulkTrackActions = tryBulkTrackCommand(text, context);
    if (bulkTrackActions !== null) {
        return bulkTrackActions;
    }

    const tempoMatch = text.match(/^(?:set\s+)?tempo\s+(?:to\s+)?(\d+)$/i);
    if (tempoMatch) {
        return [{ type: 'setTempo', payload: { bpm: parseInt(tempoMatch[1]!, 10) } }];
    }

    const gainMatch = text.match(/^(?:set\s+)?(?:track\s+)?(?:gain|volume)\s+(?:to\s+)?(\d+)(%)?$/i);
    if (gainMatch && selectedTrack) {
        const rawVal = parseInt(gainMatch[1]!, 10);
        const hasPercent = Boolean(gainMatch[2]);
        const gain = hasPercent || rawVal > 1 ? rawVal / 100 : rawVal;
        return [
            {
                type: 'setTrackGain',
                payload: { trackId: selectedTrack.id, gain },
            },
        ];
    }

    const panMatch = text.match(/^(?:set\s+)?pan\s+(?:to\s+)?(-?\d+)$/i);
    if (panMatch && selectedTrack) {
        return [
            {
                type: 'setTrackPan',
                payload: { trackId: selectedTrack.id, pan: parseInt(panMatch[1]!, 10) },
            },
        ];
    }

    const renameClipMatch = text.match(/^rename\s+(?:the\s+)?clip(?:\s+(.+))?$/i);
    if (renameClipMatch && selectedClipId) {
        const renameValue = consumeOptionalLeadingWord(renameClipMatch[1], 'to');
        const name = renameValue === null ? null : parseOpaqueValue(renameValue);
        if (name !== null) {
            return [{ type: 'renameClip', payload: { clipId: selectedClipId, name } }];
        }
    }

    const humanizeMatch = text.match(/^humanize(?:\s+(\d+)%?)?$/i);
    if (humanizeMatch && selectedClipId) {
        const amount = humanizeMatch[1] ? parseInt(humanizeMatch[1], 10) / 100 : 0.3;
        return [{ type: 'humanizeNotes', payload: { clipId: selectedClipId, amount } }];
    }

    const fitBeatsMatch = text.match(/^stretch\s+(?:the\s+)?clip\s+to\s+(\d+(?:\.\d+)?)\s+beats?$/i);
    if (fitBeatsMatch && selectedClipId) {
        return [
            { type: 'fitClipToBeats', payload: { clipId: selectedClipId, targetBeats: parseFloat(fitBeatsMatch[1]!) } },
        ];
    }

    const stretchRatioMatch = text.match(/^set\s+stretch\s+ratio\s+(?:to\s+)?(\d+(?:\.\d+)?)$/i);
    if (stretchRatioMatch && selectedClipId) {
        return [
            {
                type: 'setClipStretchRatio',
                payload: { clipId: selectedClipId, ratio: parseFloat(stretchRatioMatch[1]!) },
            },
        ];
    }

    const joinMatch = text.match(/^join\s+session\s+(.+)$/i);
    if (joinMatch) {
        const inviteString = parseOpaqueValue(joinMatch[1]!);
        if (inviteString !== null) {
            return [{ type: 'joinCollabSession', payload: { inviteString, peerName: 'Peer' } }];
        }
    }

    const muteTrackMatch = text.match(/^(mute|unmute)(?:\s+(.+))?$/i);
    if (muteTrackMatch) {
        const reference = consumeOptionalLeadingWord(muteTrackMatch[2], 'the');
        const track = reference === null ? undefined : resolveTrackReference(context, reference);
        if (track) {
            return [
                {
                    type: 'muteTrack',
                    payload: { trackId: track.id, muted: muteTrackMatch[1]!.toLowerCase() === 'mute' },
                },
            ];
        }
    }
    const soloTrackMatch = text.match(/^(solo|unsolo)(?:\s+(.+))?$/i);
    if (soloTrackMatch) {
        const reference = consumeOptionalLeadingWord(soloTrackMatch[2], 'the');
        const track = reference === null ? undefined : resolveTrackReference(context, reference);
        if (track) {
            return [
                {
                    type: 'soloTrack',
                    payload: { trackId: track.id, soloed: soloTrackMatch[1]!.toLowerCase() === 'solo' },
                },
            ];
        }
    }

    const deviceActions = tryDeviceCommand(text, context);
    if (deviceActions !== null) {
        return deviceActions;
    }

    const deleteTrackMatch = text.match(/^(?:delete|remove)(?:\s+(.+))?$/i);
    if (deleteTrackMatch) {
        const withoutArticle = consumeOptionalLeadingWord(deleteTrackMatch[1], 'the');
        const reference = withoutArticle === null ? null : consumeOptionalLeadingWord(withoutArticle, 'track');
        const track = reference === null ? undefined : resolveTrackReference(context, reference);
        if (track && track.kind !== 'master') {
            return [{ type: 'removeTrack', payload: { trackId: track.id } }];
        }
    }

    return [];
}

// ── Compound fast path ──────────────────────────────────────────────────

export function tryCompoundFastPath(text: string, context: ProjectContext): RuntimeAction[] | null {
    const bulkTrackActions = tryBulkTrackCommand(text, context);
    if (bulkTrackActions !== null) {
        return bulkTrackActions;
    }

    const multiTrackMatch = text.match(
        /^(?:create|add|make)\s+(\d+)\s+(audio\s+|midi\s+|bus\s+)?tracks?(?:\s+(?:named|called)\s+(.+))?$/i
    );
    if (multiTrackMatch) {
        const count = Number(multiTrackMatch[1]);
        if (!Number.isSafeInteger(count) || count < 1 || count > MAX_DETERMINISTIC_TRACK_CREATIONS) {
            return null;
        }
        const kind = (multiTrackMatch[2]?.trim().toLowerCase() ?? 'audio') as 'audio' | 'midi' | 'bus';
        const namesStr = multiTrackMatch[3];
        const names = namesStr === undefined ? [] : parseTrackNameList(namesStr);
        if (names === null || (namesStr !== undefined && names.length !== count)) {
            return null;
        }
        const actions: RuntimeAction[] = [];
        for (let index = 0; index < count; index++) {
            const name = names[index] ?? `${kind.charAt(0).toUpperCase() + kind.slice(1)} ${index + 1}`;
            actions.push({ type: 'addTrack', payload: { name, kind } });
        }
        return actions;
    }

    const deviceActions = tryDeviceCommand(text, context);
    if (deviceActions !== null) {
        return deviceActions;
    }

    return null;
}

// ── Helpers ─────────────────────────────────────────────────────────────

export const MAX_DETERMINISTIC_TRACK_CREATIONS = 32;

const DEVICE_TYPES: ReadonlyMap<string, string> = new Map([
    ['eq', 'EQ'],
    ['compressor', 'Compressor'],
    ['reverb', 'Reverb'],
    ['delay', 'Delay'],
    ['gain', 'Gain'],
    ['chorus', 'Chorus'],
    ['flanger', 'Flanger'],
    ['phaser', 'Phaser'],
    ['distortion', 'Distortion'],
    ['limiter', 'Limiter'],
    ['gate', 'Gate'],
]);

const CLAUSE_CONNECTOR_PATTERN = /(?:[,;]|\b(?:and|or|then|also|plus|without|except|but|while|before|after)\b)/iu;
const UNQUOTED_TRACK_NAME_PATTERN = /^[\p{L}\p{N}](?:[\p{L}\p{N}'’._/-]*[\p{L}\p{N}])?$/u;
const SENTENCE_CONTINUATION_PATTERN = /(?:[.!?]|:)\s+\S/u;
const SELECTED_TRACK_REFERENCES = new Set(['selected track', 'this track', 'tagged track']);

function normalizeCommandText(value: string): string {
    return value.trim().toLocaleLowerCase().replaceAll(/\s+/gu, ' ');
}

function consumeOptionalLeadingWord(value: string | undefined, word: string): string | null {
    const trimmed = value?.trim();
    if (!trimmed) {
        return null;
    }
    const firstWord = trimmed.match(/^\S+/u)?.[0];
    if (firstWord?.toLocaleLowerCase() !== word) {
        return trimmed;
    }
    const remainder = trimmed.slice(firstWord.length).trim();
    return remainder.length > 0 ? remainder : null;
}

function parseQuotedValue(value: string): string | null {
    const quote = value[0];
    if ((quote !== '"' && quote !== "'") || value.at(-1) !== quote || value.length < 3) {
        return null;
    }
    const content = value.slice(1, -1).trim();
    return content.length > 0 && !content.includes(quote) ? content : null;
}

function parseOpaqueValue(value: string): string | null {
    const trimmed = value.trim();
    if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
        return parseQuotedValue(trimmed);
    }
    if (
        trimmed.length === 0 ||
        /"/u.test(trimmed) ||
        CLAUSE_CONNECTOR_PATTERN.test(trimmed) ||
        SENTENCE_CONTINUATION_PATTERN.test(trimmed)
    ) {
        return null;
    }
    return trimmed;
}

function splitTrackNameList(value: string): string[] | null {
    const parts: string[] = [];
    let part = '';
    let quote: '"' | "'" | null = null;
    let index = 0;

    while (index < value.length) {
        const character = value[index]!;
        if (quote !== null) {
            part += character;
            if (character === quote) {
                quote = null;
            }
            index++;
            continue;
        }
        if (character === '"' || (character === "'" && part.trim().length === 0)) {
            quote = character;
            part += character;
            index++;
            continue;
        }

        const separator = value.slice(index).match(/^(?:,\s*(?:and\s+)?|\s+and\s+)/i)?.[0];
        if (separator !== undefined) {
            parts.push(part.trim());
            part = '';
            index += separator.length;
            continue;
        }
        part += character;
        index++;
    }

    if (quote !== null) {
        return null;
    }
    parts.push(part.trim());
    return parts.some((item) => item.length === 0) ? null : parts;
}

function parseTrackNameList(value: string): string[] | null {
    const parts = splitTrackNameList(value);
    if (parts === null) {
        return null;
    }

    const names: string[] = [];
    for (const part of parts) {
        if (part.startsWith('"') || part.startsWith("'")) {
            const quotedName = parseQuotedValue(part);
            if (quotedName === null) {
                return null;
            }
            names.push(quotedName);
            continue;
        }
        if (
            /"/u.test(part) ||
            SENTENCE_CONTINUATION_PATTERN.test(part) ||
            isExactRegisteredCommand(part) ||
            !UNQUOTED_TRACK_NAME_PATTERN.test(part)
        ) {
            return null;
        }
        names.push(part);
    }
    return names;
}

function isExactRegisteredCommand(value: string): boolean {
    const command = normalizeCommandText(value);
    return PRESET_ACTIONS.some((preset) =>
        [preset.label, ...(preset.commandAliases ?? [])].some(
            (candidate) => normalizeCommandText(candidate) === command
        )
    );
}

function tryBulkTrackCommand(text: string, context: ProjectContext): RuntimeAction[] | null {
    const match = text.match(/^(mute|unmute|solo|unsolo)\s+all\s+tracks$/iu);
    if (match === null) {
        return null;
    }
    const verb = match[1]!.toLocaleLowerCase();
    if (verb === 'mute' || verb === 'unmute') {
        return context.tracks.map((track) => ({
            type: 'muteTrack' as const,
            payload: { trackId: track.id, muted: verb === 'mute' },
        }));
    }
    return context.tracks.map((track) => ({
        type: 'soloTrack' as const,
        payload: { trackId: track.id, soloed: verb === 'solo' },
    }));
}

function parseDeviceList(value: string): string[] | null {
    if (!/(?:,|\s+and\s+)/iu.test(value)) {
        return null;
    }
    const tokens = value.split(/\s*,\s*(?:and\s+)?|\s+and\s+/iu).map((token) => token.trim().toLocaleLowerCase());
    if (tokens.length < 2 || tokens.some((token) => token.length === 0)) {
        return null;
    }
    const deviceTypes: string[] = [];
    for (const token of tokens) {
        const deviceType = DEVICE_TYPES.get(token);
        if (deviceType === undefined) {
            return null;
        }
        deviceTypes.push(deviceType);
    }
    return deviceTypes;
}

function parseDeviceTypes(value: string): string[] | null {
    const normalized = normalizeCommandText(value);
    const singleDeviceType = DEVICE_TYPES.get(normalized);
    return singleDeviceType === undefined ? parseDeviceList(value) : [singleDeviceType];
}

function parseDeviceTarget(value: string): string | null {
    const target = consumeOptionalLeadingWord(value, 'the');
    if (target === null) {
        return null;
    }
    if (!target.startsWith('"') && !target.startsWith("'") && /^track$/iu.test(target)) {
        return 'selected track';
    }
    return target;
}

function tryDeviceCommand(text: string, context: ProjectContext): RuntimeAction[] | null {
    const targetedMatch = text.match(/^add\s+(?:an?\s+)?(.+?)\s+to\s+(.+)$/iu);
    const untargetedMatch = targetedMatch === null ? text.match(/^add\s+(?:an?\s+)?(.+)$/iu) : null;
    const deviceTypes = parseDeviceTypes(targetedMatch?.[1] ?? untargetedMatch?.[1] ?? '');
    if (deviceTypes === null || (untargetedMatch !== null && deviceTypes.length === 1)) {
        return null;
    }

    const reference = targetedMatch === null ? 'selected track' : parseDeviceTarget(targetedMatch[2]!);
    if (reference === null) {
        return null;
    }
    const track = resolveTrackReference(context, reference);
    if (track === undefined) {
        return null;
    }
    return deviceTypes.map((deviceType) => ({
        type: 'addDevice' as const,
        payload: { trackId: track.id, deviceType },
    }));
}

export function resolveTrackReference(
    context: ProjectContext,
    reference: string
): ProjectContext['tracks'][number] | undefined {
    const trimmedReference = reference.trim();
    const isQuoted = trimmedReference.startsWith('"') || trimmedReference.startsWith("'");
    const parsedReference = isQuoted ? parseQuotedValue(trimmedReference) : parseOpaqueValue(trimmedReference);
    if (parsedReference === null) {
        return undefined;
    }

    if (!isQuoted && SELECTED_TRACK_REFERENCES.has(normalizeCommandText(parsedReference))) {
        return context.tracks.find((track) => track.id === context.selectedTrackId);
    }

    const literalIdMatches = context.tracks.filter((track) => track.id === parsedReference);
    if (literalIdMatches.length === 1) {
        return literalIdMatches[0];
    }

    const normalizedNames = new Set([normalizeCommandText(parsedReference)]);
    if (!isQuoted && /\s+track$/iu.test(parsedReference)) {
        normalizedNames.add(normalizeCommandText(parsedReference.replace(/\s+track$/iu, '')));
    }
    const exactNameMatches = context.tracks.filter((track) => normalizedNames.has(normalizeCommandText(track.name)));
    if (exactNameMatches.length === 1) {
        return exactNameMatches[0];
    }
    return undefined;
}
