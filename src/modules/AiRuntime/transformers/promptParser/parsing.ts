/**
 * Transformer: pure prompt parsing and pattern matching.
 * No I/O — converts normalized user text into AppAction arrays using
 * regex patterns, preset matching, and recipe lookups.
 */

import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { type PresetContext } from '../../models/PresetActions/Registry';
import { type ProjectContext } from '../../models/ProjectContext';
import { type RuntimeAction } from '../../models/RuntimeAction';
import { findBestMatch } from '../../services/fuzzySearch';

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
    if (
        /\b(blues|jazz|rock|pop|hip.?hop|trap|edm|classical|folk|country|r&b|rnb|funk|reggae|metal|punk|ambient|lo.?fi)\b/i.test(
            normalized
        )
    ) {
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
    if (isComplexPrompt(normalized)) {
        return [];
    }

    const match = findBestMatch(normalized, context);
    if (!match) {
        return [];
    }

    const result = match.buildAction(context);
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

export function tryParameterizedPath(normalized: string, context: ProjectContext): RuntimeAction[] {
    const selectedTrack = context.tracks.find((time) => time.id === context.selectedTrackId);
    const selectedClipId = context.selectedClipId;

    const tempoMatch = normalized.match(/^(?:set\s+)?tempo\s+(?:to\s+)?(\d+)$/i);
    if (tempoMatch) {
        return [{ type: 'setTempo', payload: { bpm: parseInt(tempoMatch[1]!, 10) } }];
    }

    const gainMatch = normalized.match(/^(?:set\s+)?(?:track\s+)?(?:gain|volume)\s+(?:to\s+)?(\d+)%?$/i);
    if (gainMatch && selectedTrack) {
        const rawVal = parseInt(gainMatch[1]!, 10);
        const gain = rawVal > 1 ? rawVal / 100 : rawVal;
        return [
            {
                type: 'setTrackGain',
                payload: { trackId: selectedTrack.id, gain: Math.max(0, Math.min(FADER_MAX_GAIN, gain)) },
            },
        ];
    }

    const panMatch = normalized.match(/^(?:set\s+)?pan\s+(?:to\s+)?(-?\d+)$/i);
    if (panMatch && selectedTrack) {
        return [
            {
                type: 'setTrackPan',
                payload: { trackId: selectedTrack.id, pan: Math.max(-50, Math.min(50, parseInt(panMatch[1]!, 10))) },
            },
        ];
    }

    const renameClipMatch = normalized.match(/^rename\s+(?:the\s+)?clip\s+(?:to\s+)?(.+)$/i);
    if (renameClipMatch && selectedClipId) {
        return [{ type: 'renameClip', payload: { clipId: selectedClipId, name: renameClipMatch[1]!.trim() } }];
    }

    const humanizeMatch = normalized.match(/^humanize(?:\s+(\d+)%?)?$/i);
    if (humanizeMatch && selectedClipId) {
        const amount = humanizeMatch[1] ? parseInt(humanizeMatch[1], 10) / 100 : 0.3;
        return [{ type: 'humanizeNotes', payload: { clipId: selectedClipId, amount } }];
    }

    const fitBeatsMatch = normalized.match(/^stretch\s+(?:the\s+)?clip\s+to\s+(\d+(?:\.\d+)?)\s+beats?$/i);
    if (fitBeatsMatch && selectedClipId) {
        return [
            { type: 'fitClipToBeats', payload: { clipId: selectedClipId, targetBeats: parseFloat(fitBeatsMatch[1]!) } },
        ];
    }

    const stretchRatioMatch = normalized.match(/^set\s+stretch\s+ratio\s+(?:to\s+)?(\d+(?:\.\d+)?)$/i);
    if (stretchRatioMatch && selectedClipId) {
        return [
            {
                type: 'setClipStretchRatio',
                payload: { clipId: selectedClipId, ratio: parseFloat(stretchRatioMatch[1]!) },
            },
        ];
    }

    const joinMatch = normalized.match(/^join\s+session\s+(.+)$/i);
    if (joinMatch) {
        return [{ type: 'joinCollabSession', payload: { inviteString: joinMatch[1]!.trim(), peerName: 'Peer' } }];
    }

    const muteTrackMatch = normalized.match(/^(mute|unmute)\s+(?:the\s+)?(.+?)(?:\s+track)?$/i);
    if (muteTrackMatch) {
        const track = findTrack(context, muteTrackMatch[2]!.trim());
        if (track) {
            return [
                {
                    type: 'muteTrack',
                    payload: { trackId: track.id, muted: muteTrackMatch[1]!.toLowerCase() === 'mute' },
                },
            ];
        }
    }
    const soloTrackMatch = normalized.match(/^(solo|unsolo)\s+(?:the\s+)?(.+?)(?:\s+track)?$/i);
    if (soloTrackMatch) {
        const track = findTrack(context, soloTrackMatch[2]!.trim());
        if (track) {
            return [
                {
                    type: 'soloTrack',
                    payload: { trackId: track.id, soloed: soloTrackMatch[1]!.toLowerCase() === 'solo' },
                },
            ];
        }
    }

    const addDeviceToTrack = normalized.match(
        /^add\s+(?:a\s+)?(eq|compressor|reverb|delay|gain|chorus|flanger|phaser|distortion|limiter|gate)\s+to\s+(?:the\s+)?(.+?)(?:\s+track)?$/i
    );
    if (addDeviceToTrack) {
        const deviceMap: Record<string, string> = {
            eq: 'EQ',
            compressor: 'Compressor',
            reverb: 'Reverb',
            delay: 'Delay',
            gain: 'Gain',
            chorus: 'Chorus',
            flanger: 'Flanger',
            phaser: 'Phaser',
            distortion: 'Distortion',
            limiter: 'Limiter',
            gate: 'Gate',
        };
        const track = findTrack(context, addDeviceToTrack[2]!.trim());
        if (track) {
            const deviceType = deviceMap[addDeviceToTrack[1]!.toLowerCase()] ?? 'EQ';
            return [{ type: 'addDevice', payload: { trackId: track.id, deviceType } }];
        }
    }

    const deleteTrackMatch = normalized.match(/^(?:delete|remove)\s+(?:the\s+)?(?:track\s+)?(.+?)(?:\s+track)?$/i);
    if (deleteTrackMatch) {
        const track = findExactTrackForDeletion(context, deleteTrackMatch[1]!.trim());
        if (track && track.kind !== 'master') {
            return [{ type: 'removeTrack', payload: { trackId: track.id } }];
        }
    }

    return [];
}

// ── Compound fast path ──────────────────────────────────────────────────

export function tryCompoundFastPath(normalized: string, context: ProjectContext): RuntimeAction[] | null {
    const selectedTrack = context.tracks.find((time) => time.id === context.selectedTrackId);

    const multiTrackMatch = normalized.match(
        /^(?:create|add|make)\s+(\d+)\s+(audio\s+|midi\s+|bus\s+)?tracks?(?:\s+(?:named|called)\s+(.+))?$/i
    );
    if (multiTrackMatch) {
        const count = Math.min(parseInt(multiTrackMatch[1]!, 10), 32);
        const kind = (multiTrackMatch[2]?.trim().toLowerCase() ?? 'audio') as 'audio' | 'midi' | 'bus';
        const namesStr = multiTrackMatch[3];
        const names = namesStr
            ? namesStr
                  .split(/,\s*|\s+and\s+/i)
                  .map((node) => node.trim())
                  .filter(Boolean)
            : [];
        const actions: RuntimeAction[] = [];
        for (let index = 0; index < count; index++) {
            const name = names[index] ?? `${kind.charAt(0).toUpperCase() + kind.slice(1)} ${index + 1}`;
            actions.push({ type: 'addTrack', payload: { name, kind } });
        }
        return actions;
    }

    if (/^mute\s+all\s+tracks$/i.test(normalized)) {
        return context.tracks.map((time) => ({
            type: 'muteTrack' as const,
            payload: { trackId: time.id, muted: true },
        }));
    }
    if (/^unmute\s+all\s+tracks$/i.test(normalized)) {
        return context.tracks.map((time) => ({
            type: 'muteTrack' as const,
            payload: { trackId: time.id, muted: false },
        }));
    }
    if (/^solo\s+all\s+tracks$/i.test(normalized)) {
        return context.tracks.map((time) => ({
            type: 'soloTrack' as const,
            payload: { trackId: time.id, soloed: true },
        }));
    }
    if (/^unsolo\s+all\s+tracks$/i.test(normalized)) {
        return context.tracks.map((time) => ({
            type: 'soloTrack' as const,
            payload: { trackId: time.id, soloed: false },
        }));
    }

    const multiDeviceMatch = normalized.match(
        /^add\s+(?:a\s+)?((?:(?:eq|compressor|reverb|delay|gain|chorus|flanger|phaser|distortion|limiter|gate)(?:\s*(?:,|and)\s*)?)+)\s*(?:to\s+(?:the\s+)?(?:(selected|this|tagged)\s+)?(?:track)?)?$/i
    );
    if (multiDeviceMatch && selectedTrack) {
        const deviceMap: Record<string, string> = {
            eq: 'EQ',
            compressor: 'Compressor',
            reverb: 'Reverb',
            delay: 'Delay',
            gain: 'Gain',
            chorus: 'Chorus',
            flanger: 'Flanger',
            phaser: 'Phaser',
            distortion: 'Distortion',
            limiter: 'Limiter',
            gate: 'Gate',
        };
        const devices = multiDeviceMatch[1]!
            .split(/\s*(?:,|and)\s*/i)
            .map((data) => data.trim().toLowerCase())
            .filter(Boolean);
        const actions: RuntimeAction[] = [];
        for (const data of devices) {
            const deviceType = deviceMap[data];
            if (deviceType) {
                actions.push({ type: 'addDevice', payload: { trackId: selectedTrack.id, deviceType } });
            }
        }
        if (actions.length > 0) {
            return actions;
        }
    }

    if (selectedTrack && /\b(make\s+it|give\s+it|sound\s+like)\b/i.test(normalized)) {
        const recipe = matchSoundDesignRecipe(normalized, selectedTrack.id);
        if (recipe) {
            return recipe;
        }
    }

    return null;
}

// ── Sound design recipes ────────────────────────────────────────────────

export function matchSoundDesignRecipe(normalized: string, trackId: string): RuntimeAction[] | null {
    if (/\b(warm|warmth|warmer)\b/i.test(normalized)) {
        return [
            { type: 'addDevice', payload: { trackId, deviceType: 'EQ' } },
            { type: 'addDevice', payload: { trackId, deviceType: 'Compressor' } },
        ];
    }
    if (/\b(pop\s+out|pop|punch|punchier)\b/i.test(normalized)) {
        return [
            { type: 'addDevice', payload: { trackId, deviceType: 'Compressor' } },
            { type: 'addDevice', payload: { trackId, deviceType: 'EQ' } },
        ];
    }
    if (/\b(radio|telephone|phone|walkie.?talkie)\b/i.test(normalized)) {
        return [
            { type: 'addDevice', payload: { trackId, deviceType: 'EQ' } },
            { type: 'addDevice', payload: { trackId, deviceType: 'Compressor' } },
        ];
    }
    if (/\b(lo-?fi|lofi)\b/i.test(normalized)) {
        return [
            { type: 'addDevice', payload: { trackId, deviceType: 'EQ' } },
            { type: 'addDevice', payload: { trackId, deviceType: 'BitCrusher' } },
            { type: 'addDevice', payload: { trackId, deviceType: 'Compressor' } },
        ];
    }
    if (/\b(underwater|submerged)\b/i.test(normalized)) {
        return [
            { type: 'addDevice', payload: { trackId, deviceType: 'EQ' } },
            { type: 'addDevice', payload: { trackId, deviceType: 'Reverb' } },
            { type: 'addDevice', payload: { trackId, deviceType: 'Delay' } },
        ];
    }
    if (/\b(wider|stereo|spread)\b/i.test(normalized)) {
        return [
            { type: 'addDevice', payload: { trackId, deviceType: 'Chorus' } },
            { type: 'addDevice', payload: { trackId, deviceType: 'Delay' } },
        ];
    }
    if (/\b(bright|crisp|sparkle|air|airy)\b/i.test(normalized)) {
        return [
            { type: 'addDevice', payload: { trackId, deviceType: 'EQ' } },
            { type: 'addDevice', payload: { trackId, deviceType: 'Compressor' } },
        ];
    }
    if (/\b(dark|darker|muddy|dull|muffled)\b/i.test(normalized)) {
        return [{ type: 'addDevice', payload: { trackId, deviceType: 'EQ' } }];
    }
    if (/\b(spacious|space|echo|ambient|ethereal|dreamy|hall)\b/i.test(normalized)) {
        return [
            { type: 'addDevice', payload: { trackId, deviceType: 'Reverb' } },
            { type: 'addDevice', payload: { trackId, deviceType: 'Delay' } },
        ];
    }
    if (/\b(vintage|retro|analog|analogue|tape|old.?school)\b/i.test(normalized)) {
        return [
            { type: 'addDevice', payload: { trackId, deviceType: 'EQ' } },
            { type: 'addDevice', payload: { trackId, deviceType: 'Compressor' } },
            { type: 'addDevice', payload: { trackId, deviceType: 'BitCrusher' } },
        ];
    }
    return null;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function findExactTrackForDeletion(
    context: ProjectContext,
    reference: string
): ProjectContext['tracks'][number] | undefined {
    const literalIdMatches = context.tracks.filter((track) => track.id === reference.trim());
    if (literalIdMatches.length === 1) {
        return literalIdMatches[0];
    }

    const normalizedName = reference
        .toLocaleLowerCase()
        .replace(/\s+track$/iu, '')
        .trim();
    const exactNameMatches = context.tracks.filter((track) => track.name.toLocaleLowerCase() === normalizedName);
    if (exactNameMatches.length === 1) {
        return exactNameMatches[0];
    }
    return undefined;
}

export function findTrack(context: ProjectContext, name: string): ProjectContext['tracks'][number] | undefined {
    const lower = name
        .toLowerCase()
        .replace(/\s+track$/i, '')
        .trim();
    return (
        context.tracks.find((time) => time.name.toLowerCase() === lower) ??
        context.tracks.find((time) => time.name.toLowerCase().includes(lower))
    );
}
