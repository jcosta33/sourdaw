import { Container } from "#/helpers/DependencyInjector/Container";
import { Logger } from "#/helpers/Logger/Logger";
import type { AppAction } from "#/modules/Command/models/AppAction";
import type { IntentResult } from "../models/IntentResult";
import type { ProjectContext, ProjectContextTrack } from "../models/ProjectContext";
import { validateActions } from "./validateActions";
import { parseLlmJsonToActions } from "./validateLlmOutput";
import { isLlmAvailable, generateActions } from "../repositories/webLlmEngine";
import { buildSystemPrompt, ACTION_JSON_SCHEMA } from "../models/actionSchema";
import { getUserPresets } from "#/modules/Track/useCases/presetUseCases";
import { findPluginByName } from "#/modules/AudioEngine/useCases/pluginScanUseCases";

const logger = Container.getInstance().get(Logger);

/**
 * Two-tier prompt parsing:
 * 1. Fast-path: instant regex matching for simple, unambiguous commands
 * 2. LLM path: WebLLM for complex, compound, or ambiguous natural language
 *
 * The fast path handles ~80% of single-action commands with zero latency.
 * Everything else goes to the LLM which can handle arbitrary complexity.
 */
export const parsePromptToActions = async (
    prompt: string,
    context: ProjectContext,
    signal?: AbortSignal,
): Promise<IntentResult> => {
    const normalized = prompt.toLowerCase().trim();

    const fastResult = tryFastPath(normalized, context);
    if (fastResult.length > 0) {
        const validated = validateActions(fastResult);
        return {
            actions: validated,
            confidence: 0.95,
            rawText: prompt,
            requiresConfirmation: validated.some((a) =>
                a.type === "removeTrack" || a.type === "removeClip" || a.type === "removeDevice" || a.type === "bounceInPlace",
            ),
        };
    }

    if (signal?.aborted) {
        return { actions: [], confidence: 0, rawText: prompt, requiresConfirmation: false };
    }

    if (isLlmAvailable()) {
        try {
            return await parseLlmPath(prompt, context, signal);
        } catch (err) {
            if (signal?.aborted) {
                return { actions: [], confidence: 0, rawText: prompt, requiresConfirmation: false };
            }
            logger.warn(`LLM inference failed, no actions generated: ${err}`);
        }
    }

    return { actions: [], confidence: 0, rawText: prompt, requiresConfirmation: false };
};

const parseLlmPath = async (prompt: string, context: ProjectContext, signal?: AbortSignal): Promise<IntentResult> => {
    if (signal?.aborted) {
        return { actions: [], confidence: 0, rawText: prompt, requiresConfirmation: false };
    }

    const systemPrompt = buildSystemPrompt(context);
    const rawJson = await generateActions(systemPrompt, prompt, ACTION_JSON_SCHEMA);

    if (signal?.aborted) {
        return { actions: [], confidence: 0, rawText: prompt, requiresConfirmation: false };
    }

    const actions = parseLlmJsonToActions(rawJson);
    const validated = validateActions(actions);

    return {
        actions: validated,
        confidence: validated.length > 0 ? 0.85 : 0,
        rawText: prompt,
        requiresConfirmation: validated.some((a) =>
            a.type === "removeTrack" || a.type === "removeClip" || a.type === "removeDevice" || a.type === "bounceInPlace",
        ),
    };
};

/**
 * Returns true if this prompt is clearly a complex/compound instruction
 * that should skip the fast path and go directly to the LLM.
 */
export const isComplexPrompt = (normalized: string): boolean => {
    if (/\d+\s+tracks?/i.test(normalized)) return true;
    if (/\b(first|last|rest|remaining|each|every|all)\b/i.test(normalized) && /\b(track|clip)s?\b/i.test(normalized)) return true;
    if (/\bname\s+them\b/i.test(normalized)) return true;
    if (/\bthen\b/i.test(normalized)) return true;
    if ((normalized.match(/,/g) ?? []).length >= 2) return true;
    if (/\b(and|also|plus)\b.*\b(and|also|plus)\b/i.test(normalized)) return true;
    if (/\b(sound\s+like|make\s+it|give\s+it|effect|warm|crisp|lo-?fi|radio|distant|underwater|wider|thicker|brighter|darker|punchier|airy|muddy|tinny|vintage)\b/i.test(normalized)) return true;
    if (/\b(staccato|legato|filter|sweep|sidechain|ducking|pumping)\b/i.test(normalized)) return true;
    return false;
};

// ---------------------------------------------------------------------------
// Fast path: instant regex for simple single-action commands
// ---------------------------------------------------------------------------

const tryFastPath = (normalized: string, context: ProjectContext): AppAction[] => {
    if (isComplexPrompt(normalized)) return [];

    const selectedTrack = context.tracks.find((t) => t.id === context.selectedTrackId);
    const selectedClipId = context.selectedClipId;
    const actions: AppAction[] = [];

    // Mix analysis
    if (/^(analy[sz]e\s+mix|check\s+mix|mix\s+analysis)$/i.test(normalized)) return [{ type: "analyzeMix" }];
    if (/^(fix\s+mix|auto[- ]?fix\s+mix)$/i.test(normalized)) return [{ type: "autoFixMix" }];

    // Transport
    if (/^(play|start\s+playback)$/i.test(normalized)) return [{ type: "togglePlayback" }];
    if (/^(stop|pause)$/i.test(normalized)) return [{ type: "stopPlayback" }];
    if (/^(record|start\s+recording)$/i.test(normalized)) return [{ type: "toggleRecording" }];
    if (/^(loop|toggle\s+loop)$/i.test(normalized)) return [{ type: "toggleLoop" }];
    if (/^(metronome|toggle\s+metronome|click)$/i.test(normalized)) return [{ type: "toggleMetronome" }];

    // Tempo
    const tempoMatch = normalized.match(/^(?:set\s+)?tempo\s+(?:to\s+)?(\d+)$/i);
    if (tempoMatch) return [{ type: "setTempo", payload: { bpm: parseInt(tempoMatch[1]!, 10) } }];

    // Simple track creation
    const addTrackMatch = normalized.match(/^add\s+(audio|midi|bus)\s+track(?:\s+(?:named|called)\s+(.+))?$/i);
    if (addTrackMatch) {
        const kind = addTrackMatch[1]!.toLowerCase() as "audio" | "midi" | "bus";
        const name = addTrackMatch[2] ?? `${kind.charAt(0).toUpperCase() + kind.slice(1)} ${String(Date.now() % 1000)}`;
        return [{ type: "addTrack", payload: { name, kind } }];
    }
    if (/^(add|create|new)\s+track$/i.test(normalized)) {
        return [{ type: "addTrack", payload: { name: `Track ${String(Date.now() % 1000)}`, kind: "audio" } }];
    }

    // Mute/unmute
    if (/^unmute/i.test(normalized)) {
        const trackName = normalized.replace(/^unmute\s+(the\s+)?/i, "").replace(/\s+track$/i, "").trim();
        const track = trackName ? findTrack(context, trackName) : selectedTrack;
        if (track) actions.push({ type: "muteTrack", payload: { trackId: track.id, muted: false } });
        return actions;
    }
    if (/^mute/i.test(normalized)) {
        const trackName = normalized.replace(/^mute\s+(the\s+)?/i, "").replace(/\s+track$/i, "").trim();
        const track = trackName ? findTrack(context, trackName) : selectedTrack;
        if (track) actions.push({ type: "muteTrack", payload: { trackId: track.id, muted: true } });
        return actions;
    }

    // Solo/unsolo
    if (/^unsolo/i.test(normalized)) {
        const trackName = normalized.replace(/^unsolo\s+(the\s+)?/i, "").replace(/\s+track$/i, "").trim();
        const track = trackName ? findTrack(context, trackName) : selectedTrack;
        if (track) actions.push({ type: "soloTrack", payload: { trackId: track.id, soloed: false } });
        return actions;
    }
    if (/^solo/i.test(normalized)) {
        const trackName = normalized.replace(/^solo\s+(the\s+)?/i, "").replace(/\s+track$/i, "").trim();
        const track = trackName ? findTrack(context, trackName) : selectedTrack;
        if (track) actions.push({ type: "soloTrack", payload: { trackId: track.id, soloed: true } });
        return actions;
    }

    // Arm/disarm
    if (/^(arm|disarm)\s+/i.test(normalized)) {
        const isArm = /^arm/i.test(normalized);
        const trackName = normalized.replace(/^(arm|disarm)\s+(the\s+)?/i, "").replace(/\s+(track|for\s+recording)$/i, "").trim();
        const track = trackName ? findTrack(context, trackName) : selectedTrack;
        if (track) actions.push({ type: "armTrack", payload: { trackId: track.id, armed: isArm } });
        return actions;
    }

    // Delete track
    if (/^(delete|remove)\s+(the\s+)?(selected|this)\s+track$/i.test(normalized)) {
        if (selectedTrack) return [{ type: "removeTrack", payload: { trackId: selectedTrack.id } }];
    }
    if (/^(delete|remove)\s+(the\s+)?track\s+(.+)/i.test(normalized)) {
        const trackName = normalized.replace(/^(delete|remove)\s+(the\s+)?track\s+/i, "").trim();
        const track = findTrack(context, trackName);
        if (track) return [{ type: "removeTrack", payload: { trackId: track.id } }];
    }

    // Workspace
    if (/^(show|open)\s+mixer$/i.test(normalized)) return [{ type: "openMixer" }];
    if (/^(close|hide)\s+mixer$/i.test(normalized)) return [{ type: "closeMixer" }];
    if (/^(show|open|toggle)\s+(sidebar|browser)$/i.test(normalized)) return [{ type: "toggleSidebar" }];
    if (/^(close|hide)\s+(sidebar|browser)$/i.test(normalized)) return [{ type: "toggleSidebar" }];
    if (/^(show|open|toggle)\s+inspector$/i.test(normalized)) return [{ type: "toggleInspector" }];
    if (/^(close|hide)\s+inspector$/i.test(normalized)) return [{ type: "toggleInspector" }];
    const modeMatch = normalized.match(/^(?:switch|go)\s+to\s+(arrange|clip|mix)$/i) ?? normalized.match(/^(arrange|clip|mix)\s+(?:mode|view)$/i);
    if (modeMatch) return [{ type: "setWorkspaceMode", payload: { mode: modeMatch[1]!.toLowerCase() as "arrange" | "clip" | "mix" } }];

    // Clip operations
    if (/^(duplicate|copy)\s+(the\s+)?clip$/i.test(normalized) && selectedClipId) return [{ type: "duplicateClip", payload: { clipId: selectedClipId } }];
    if (/^(delete|remove)\s+(the\s+)?clip$/i.test(normalized) && selectedClipId) return [{ type: "removeClip", payload: { clipId: selectedClipId } }];
    if (/^copy\s+(the\s+)?clip$/i.test(normalized)) return [{ type: "copyClip" }];
    if (/^cut\s+(the\s+)?clip$/i.test(normalized)) return [{ type: "cutClip" }];
    if (/^paste/i.test(normalized)) return [{ type: "pasteClip" }];

    // Quantize note lengths / durations
    if (/^quantize\s+(note\s+)?lengths?|^quantize\s+durations?/i.test(normalized) && selectedClipId) {
        const gridMatch = normalized.match(/(?:to\s+)?(?:1\/)?(\d+)/i);
        const gridSize = gridMatch?.[1] ? 1 / parseInt(gridMatch[1], 10) : 0.25;
        return [{ type: "quantizeNoteLengths", payload: { clipId: selectedClipId, gridSize } }];
    }

    // Quantize (start times)
    if (/^quantize/i.test(normalized) && selectedClipId) {
        const gridMatch = normalized.match(/(?:to\s+)?(?:1\/)?(\d+)/i);
        const gridSize = gridMatch?.[1] ? 1 / parseInt(gridMatch[1], 10) : 0.25;
        return [{ type: "quantizeNotes", payload: { clipId: selectedClipId, gridSize } }];
    }

    // Velocity curve scaling
    const velocityCurveMatch = normalized.match(
        /^(compress|expand|scale)\s+velocit(?:y|ies)(?:\s+(?:with\s+)?(linear|exponential|logarithmic|s[- ]?curve|compress|expand)(?:\s+curve)?)?$/i,
    );
    if (velocityCurveMatch && selectedClipId) {
        const verb = velocityCurveMatch[1]!.toLowerCase();
        let curve: string;
        if (velocityCurveMatch[2]) {
            curve = velocityCurveMatch[2].toLowerCase().replace(/\s+/g, "-");
            if (curve === "s-curve") {
                curve = "s-curve";
            }
        } else if (verb === "compress") {
            curve = "compress";
        } else if (verb === "expand") {
            curve = "expand";
        } else {
            curve = "linear";
        }
        return [{ type: "scaleVelocities", payload: { clipId: selectedClipId, curve } }];
    }

    // Set all velocities to N
    const setVelocityMatch = normalized.match(/^set\s+(?:all\s+)?velocit(?:y|ies)\s+(?:to\s+)?(\d+)$/i);
    if (setVelocityMatch && selectedClipId) {
        return [{ type: "setAllVelocities", payload: { clipId: selectedClipId, velocity: parseInt(setVelocityMatch[1]!, 10) } }];
    }

    // Scale all velocities by factor
    const scaleVelocityFactorMatch = normalized.match(/^scale\s+(?:all\s+)?velocit(?:y|ies)\s+(?:by\s+)?(\d+(?:\.\d+)?)x?$/i);
    if (scaleVelocityFactorMatch && selectedClipId) {
        return [{ type: "scaleAllVelocities", payload: { clipId: selectedClipId, factor: parseFloat(scaleVelocityFactorMatch[1]!) } }];
    }

    // Bounce selection / consolidate to audio
    if (/^(bounce\s+selection|consolidate\s+to\s+audio)$/i.test(normalized) && selectedTrack) {
        return [{ type: "bounceSelection", payload: { trackId: selectedTrack.id, startBeat: 0, endBeat: 16 } }];
    }
    const bounceSelMatch = normalized.match(
        /^(?:bounce\s+selection|consolidate\s+to\s+audio)\s+(?:from\s+)?(\d+(?:\.\d+)?)\s+(?:to\s+)?(\d+(?:\.\d+)?)$/i,
    );
    if (bounceSelMatch && selectedTrack) {
        return [{ type: "bounceSelection", payload: { trackId: selectedTrack.id, startBeat: parseFloat(bounceSelMatch[1]!), endBeat: parseFloat(bounceSelMatch[2]!) } }];
    }

    // Transpose
    const transposeMatch = normalized.match(/^transpose\s+(up|down)\s+(\d+)\s*(?:semitone|st)?s?$/i);
    if (transposeMatch && selectedClipId) {
        const semitones = parseInt(transposeMatch[2]!, 10) * (transposeMatch[1]!.toLowerCase() === "down" ? -1 : 1);
        return [{ type: "transposeNotes", payload: { clipId: selectedClipId, semitones } }];
    }

    // Invert/retrograde
    if (/^invert\s+(the\s+)?notes?$/i.test(normalized) && selectedClipId) return [{ type: "invertNotes", payload: { clipId: selectedClipId } }];
    if (/^(retrograde|reverse)\s+(the\s+)?notes?$/i.test(normalized) && selectedClipId) return [{ type: "retrogradeNotes", payload: { clipId: selectedClipId } }];

    // Normalize / reverse clip (after notes check so "reverse notes" maps to retrogradeNotes)
    if (/^normalize(\s+(the\s+)?clip)?$/i.test(normalized) && selectedClipId) return [{ type: "normalizeClip", payload: { clipId: selectedClipId } }];
    if (/^reverse(\s+(the\s+)?clip)?$/i.test(normalized) && selectedClipId) return [{ type: "reverseClip", payload: { clipId: selectedClipId } }];

    // Nudge clip
    if ((/^nudge\s+left$/i.test(normalized) || /^nudge\s+(the\s+)?clip\s+left$/i.test(normalized)) && selectedClipId) return [{ type: "nudgeClip", payload: { clipId: selectedClipId, beats: -1 } }];
    if ((/^nudge\s+right$/i.test(normalized) || /^nudge\s+(the\s+)?clip\s+right$/i.test(normalized)) && selectedClipId) return [{ type: "nudgeClip", payload: { clipId: selectedClipId, beats: 1 } }];

    // Lock / unlock clip
    if ((/^lock\s+(the\s+)?clip$/i.test(normalized) || /^lock\s+clip$/i.test(normalized)) && selectedClipId) return [{ type: "lockClip", payload: { clipId: selectedClipId, locked: true } }];
    if ((/^unlock\s+(the\s+)?clip$/i.test(normalized) || /^unlock\s+clip$/i.test(normalized)) && selectedClipId) return [{ type: "lockClip", payload: { clipId: selectedClipId, locked: false } }];

    // Clip looping
    if (/^(loop\s+(the\s+)?clip|enable\s+(clip\s+)?loop)$/i.test(normalized) && selectedClipId) {
        return [{ type: "setClipLoop", payload: { clipId: selectedClipId, enabled: true } }];
    }
    if (/^(unloop\s+(the\s+)?clip|disable\s+(clip\s+)?loop)$/i.test(normalized) && selectedClipId) {
        return [{ type: "setClipLoop", payload: { clipId: selectedClipId, enabled: false } }];
    }
    const loopLengthMatch = normalized.match(/^set\s+loop\s+length\s+(?:to\s+)?(\d+(?:\.\d+)?)\s+beats?$/i);
    if (loopLengthMatch && selectedClipId) {
        return [{ type: "setClipLoopLength", payload: { clipId: selectedClipId, loopLength: parseFloat(loopLengthMatch[1]!) } }];
    }

    // Hide / show track
    if ((/^hide\s+(the\s+)?track$/i.test(normalized) || /^hide\s+track$/i.test(normalized)) && selectedTrack) return [{ type: "hideTrack", payload: { trackId: selectedTrack.id, hidden: true } }];
    if ((/^show\s+(the\s+)?track$/i.test(normalized) || /^show\s+track$/i.test(normalized)) && selectedTrack) return [{ type: "hideTrack", payload: { trackId: selectedTrack.id, hidden: false } }];

    // Humanize
    const humanizeMatch = normalized.match(/^humanize(?:\s+(\d+)%?)?$/i);
    if (humanizeMatch && selectedClipId) {
        const amount = humanizeMatch[1] ? parseInt(humanizeMatch[1], 10) / 100 : 0.3;
        return [{ type: "humanizeNotes", payload: { clipId: selectedClipId, amount } }];
    }

    // Undo/redo (dispatched as events, not actions)
    if (/^undo$/i.test(normalized)) { document.dispatchEvent(new CustomEvent("webdaw:undo")); return []; }
    if (/^redo$/i.test(normalized)) { document.dispatchEvent(new CustomEvent("webdaw:redo")); return []; }

    // Save/export/import/zoom
    if (/^save(\s+(the\s+)?project)?$/i.test(normalized)) return [{ type: "saveProject" }];
    if (/^(new\s+project)$/i.test(normalized)) return [{ type: "newProject" }];
    if (/^(export|export\s+project|bounce|render|mixdown)$/i.test(normalized)) return [{ type: "exportProject" }];
    if (/^import\s+audio$/i.test(normalized)) return [{ type: "importAudioFile" }];
    if (/^(zoom\s+to\s+fit|zoom\s+fit)$/i.test(normalized)) return [{ type: "zoomToFit" }];

    // Preferences (dispatched as event)
    if (/^(preferences|settings)$/i.test(normalized)) { document.dispatchEvent(new CustomEvent("webdaw:open-preferences")); return []; }
    if (/^import\s+midi$/i.test(normalized)) return [{ type: "importMidiFile" }];

    // Presets — load / use / apply
    const loadPresetMatch = normalized.match(/^(?:load|use|apply)\s+preset\s+(.+)$/i);
    if (loadPresetMatch) {
        const presetName = loadPresetMatch[1]!.trim();
        const preset = getUserPresets().find((p) => p.name.toLowerCase() === presetName);
        if (preset) {
            const trackId = selectedTrack?.id;
            return [{ type: "loadPreset", payload: { presetId: preset.id, trackId } }];
        }
    }

    // Presets — save
    const savePresetMatch = normalized.match(/^save\s+(?:as\s+)?preset\s+(.+)$/i);
    if (savePresetMatch && selectedTrack) {
        const presetName = savePresetMatch[1]!.trim();
        return [{ type: "savePreset", payload: { trackId: selectedTrack.id, name: presetName, category: "synth" } }];
    }

    // Groove templates
    if (/^extract\s+groove(\s+from\s+(the\s+)?clip)?$/i.test(normalized) && selectedClipId) {
        return [{ type: "extractGroove", payload: { clipId: selectedClipId } }];
    }
    const grooveMatch = normalized.match(
        /^apply\s+(?:the\s+)?(straight|light\s+swing|heavy\s+swing|mpc\s*60|sp[\s-]*1200|live\s+drummer|swing)\s+groove(?:\s+(?:at\s+)?(\d+)%?)?$/i,
    );
    if (grooveMatch && selectedClipId) {
        const grooveNameMap: Record<string, string> = {
            "straight": "straight",
            "light swing": "swing-light",
            "heavy swing": "swing-heavy",
            "swing": "swing-light",
            "mpc60": "mpc-60",
            "mpc 60": "mpc-60",
            "sp1200": "sp-1200",
            "sp 1200": "sp-1200",
            "sp-1200": "sp-1200",
            "live drummer": "live-drummer",
        };
        const rawName = grooveMatch[1]!.toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ");
        const grooveId = grooveNameMap[rawName] ?? "swing-light";
        const amount = grooveMatch[2] ? parseInt(grooveMatch[2], 10) / 100 : undefined;
        return [{ type: "applyGroove", payload: { clipId: selectedClipId, grooveId, amount } }];
    }
    if (/^apply\s+(?:the\s+)?(?:mpc|mpc[\s-]*60)\s+(?:feel|groove)$/i.test(normalized) && selectedClipId) {
        return [{ type: "applyGroove", payload: { clipId: selectedClipId, grooveId: "mpc-60" } }];
    }

    // Drum pattern generation
    const drumMatch = normalized.match(
        /^(?:generate|create|make)\s+(?:a\s+)?(?:(four-on-floor|breakbeat|trap|jazz|latin|rock|dnb|half-time)\s+)?(?:drum\s+(?:pattern|beat)|beat)$/i,
    );
    if (drumMatch) {
        const style = drumMatch[1] ?? "rock";
        const trackId = selectedTrack?.kind === "midi" ? selectedTrack.id : undefined;
        return [{ type: "generateDrumPattern", payload: { style, trackId } }];
    }

    // Melody generation
    const melodyMatch = normalized.match(
        /^(?:generate|create|make)\s+(?:a\s+)?(?:(simple|arpeggiated|stepwise|rhythmic|ambient)\s+)?melody(?:\s+in\s+([a-g]#?)\s+(major|minor|pentatonic|minor-pentatonic|blues|dorian|mixolydian))?$/i,
    );
    if (melodyMatch) {
        const style = melodyMatch[1] ?? "simple";
        const keyMap: Record<string, number> = { c: 0, "c#": 1, d: 2, "d#": 3, e: 4, f: 5, "f#": 6, g: 7, "g#": 8, a: 9, "a#": 10, b: 11 };
        const key = melodyMatch[2] ? (keyMap[melodyMatch[2].toLowerCase()] ?? 0) : 0;
        const scale = melodyMatch[3] ?? "major";
        const trackId = selectedTrack?.kind === "midi" ? selectedTrack.id : undefined;
        return [{ type: "generateMelody", payload: { style, key, scale, trackId } }];
    }

    // Chord progression generation
    const chordMatch = normalized.match(
        /^(?:generate|create|make)\s+(?:a\s+)?(?:(pop|jazz|classical|edm|blues|rnb|folk|cinematic)\s+)?(?:chord\s+progression|chords)(?:\s+in\s+([a-g]#?)\s+(major|minor))?$/i,
    );
    if (chordMatch) {
        const chordKeyMap: Record<string, number> = { c: 0, "c#": 1, d: 2, "d#": 3, e: 4, f: 5, "f#": 6, g: 7, "g#": 8, a: 9, "a#": 10, b: 11 };
        const style = chordMatch[1] ?? "pop";
        const key = chordMatch[2] ? (chordKeyMap[chordMatch[2].toLowerCase()] ?? 0) : 0;
        const scale = chordMatch[3] ?? "major";
        const trackId = selectedTrack?.kind === "midi" ? selectedTrack.id : undefined;
        return [{ type: "generateChordProgression", payload: { style, key, scale, trackId } }];
    }

    // Stretch clip to N beats
    const fitBeatsMatch = normalized.match(/^stretch\s+(?:the\s+)?clip\s+to\s+(\d+(?:\.\d+)?)\s+beats?$/i);
    if (fitBeatsMatch && selectedClipId) {
        return [{ type: "fitClipToBeats", payload: { clipId: selectedClipId, targetBeats: parseFloat(fitBeatsMatch[1]!) } }];
    }

    // Set stretch ratio
    const stretchRatioMatch = normalized.match(/^set\s+stretch\s+ratio\s+(?:to\s+)?(\d+(?:\.\d+)?)$/i);
    if (stretchRatioMatch && selectedClipId) {
        return [{ type: "setClipStretchRatio", payload: { clipId: selectedClipId, ratio: parseFloat(stretchRatioMatch[1]!) } }];
    }

    // Enable repitch / timestretch / disable stretch
    if (/^enable\s+repitch$/i.test(normalized) && selectedClipId) {
        return [{ type: "setClipStretchMode", payload: { clipId: selectedClipId, mode: "repitch" } }];
    }
    if (/^enable\s+timestretch$/i.test(normalized) && selectedClipId) {
        return [{ type: "setClipStretchMode", payload: { clipId: selectedClipId, mode: "timestretch" } }];
    }
    if (/^disable\s+stretch(?:ing)?$/i.test(normalized) && selectedClipId) {
        return [{ type: "setClipStretchMode", payload: { clipId: selectedClipId, mode: "off" } }];
    }

    // Collaboration
    if (/^(start\s+collaboration|create\s+session|create\s+collab\s+session)$/i.test(normalized)) {
        return [{ type: "createCollabSession" }];
    }
    const joinMatch = normalized.match(/^join\s+session\s+(.+)$/i);
    if (joinMatch) {
        return [{ type: "joinCollabSession", payload: { sessionId: joinMatch[1]!.trim(), peerName: "Peer" } }];
    }
    if (/^(leave\s+session|stop\s+collaboration|leave\s+collab)$/i.test(normalized)) {
        return [{ type: "leaveCollabSession" }];
    }

    // Plugin scanning
    if (/^(scan|rescan)\s+plugins?$/i.test(normalized)) {
        return [{ type: "scanPlugins" }];
    }

    // Load external plugin by name
    const loadPluginMatch = normalized.match(/^(?:load|add|use)\s+plugin\s+(.+)$/i);
    if (loadPluginMatch) {
        const pluginName = loadPluginMatch[1]!.trim();
        const plugin = findPluginByName(pluginName);
        if (plugin) {
            const trackId = selectedTrack?.id;
            return [{ type: "loadExternalPlugin", payload: { pluginId: plugin.id, trackId } }];
        }
    }

    // Audio to MIDI
    if (/^(convert\s+audio\s+to\s+midi|audio\s+to\s+midi|detect\s+rhythm|extract\s+rhythm|onset\s+detection)$/i.test(normalized) && selectedClipId) {
        return [{ type: "audioToMidi", payload: { clipId: selectedClipId, trackId: selectedTrack?.id } }];
    }
    const audioToMidiMatch = normalized.match(/^(?:convert\s+audio\s+to\s+midi|audio\s+to\s+midi)\s+(?:with\s+)?(pitched|rhythm)(?:\s+mode)?$/i);
    if (audioToMidiMatch && selectedClipId) {
        return [{ type: "audioToMidi", payload: { clipId: selectedClipId, trackId: selectedTrack?.id, mode: audioToMidiMatch[1]!.toLowerCase() } }];
    }

    // No fast-path match — return empty to trigger LLM
    return [];
};

const findTrack = (context: ProjectContext, name: string): ProjectContextTrack | undefined => {
    const lower = name.toLowerCase().replace(/\s+track$/i, "").trim();
    return context.tracks.find((t) => t.name.toLowerCase() === lower)
        ?? context.tracks.find((t) => t.name.toLowerCase().includes(lower));
};
