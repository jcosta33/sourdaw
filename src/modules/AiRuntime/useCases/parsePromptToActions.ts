import type { AppAction } from "#/modules/Command/models/AppAction";
import type { IntentResult } from "../models/IntentResult";
import type { ProjectContext } from "../models/ProjectContext";
import { validateActions } from "./validateActions";

export const parsePromptToActions = async (
    prompt: string,
    context: ProjectContext,
): Promise<IntentResult> => {
    const normalized = prompt.toLowerCase().trim();
    const actions: AppAction[] = [];

    if (/^add\s+(audio|midi|bus)\s+track/i.test(normalized)) {
        const match = normalized.match(/^add\s+(audio|midi|bus)\s+track(?:\s+(?:named|called)\s+(.+))?/i);
        const kind = (match?.[1] ?? "audio") as "audio" | "midi" | "bus";
        const name = match?.[2] ?? `${kind.charAt(0).toUpperCase() + kind.slice(1)} ${String(Date.now() % 1000)}`;
        actions.push({ type: "addTrack", payload: { name, kind } });
    } else if (/^(add|create)\s+track/i.test(normalized)) {
        actions.push({ type: "addTrack", payload: { name: `Track ${String(Date.now() % 1000)}`, kind: "audio" } });
    } else if (/^(delete|remove)\s+track\s+(.+)/i.test(normalized)) {
        const trackName = normalized.replace(/^(delete|remove)\s+track\s+/i, "").trim();
        const track = findTrack(context, trackName);
        if (track) actions.push({ type: "removeTrack", payload: { trackId: track.id } });
    } else if (/^set\s+tempo\s+(?:to\s+)?(\d+)/i.test(normalized)) {
        const match = normalized.match(/(\d+)/);
        const bpm = match?.[1] ? parseInt(match[1], 10) : 120;
        actions.push({ type: "setTempo", payload: { bpm } });
    } else if (/^(bump|increase|raise)\s+(up\s+)?the\s+tempo/i.test(normalized)) {
        actions.push({ type: "setTempo", payload: { bpm: Math.min(300, context.tempo + 10) } });
    } else if (/^(lower|decrease|slow)\s+(down\s+)?the\s+tempo/i.test(normalized)) {
        actions.push({ type: "setTempo", payload: { bpm: Math.max(20, context.tempo - 10) } });
    } else if (/^(play|start)/i.test(normalized)) {
        actions.push({ type: "togglePlayback" });
    } else if (/^stop/i.test(normalized)) {
        actions.push({ type: "stopPlayback" });
    } else if (/^mute\s+(.+)/i.test(normalized)) {
        const trackName = normalized.replace(/^mute\s+(the\s+)?/i, "").trim();
        const track = findTrack(context, trackName);
        if (track) actions.push({ type: "muteTrack", payload: { trackId: track.id, muted: !track.muted } });
    } else if (/^(unmute)\s+(.+)/i.test(normalized)) {
        const trackName = normalized.replace(/^unmute\s+(the\s+)?/i, "").trim();
        const track = findTrack(context, trackName);
        if (track) actions.push({ type: "muteTrack", payload: { trackId: track.id, muted: false } });
    } else if (/^solo\s+(.+)/i.test(normalized)) {
        const trackName = normalized.replace(/^solo\s+(the\s+)?/i, "").trim();
        const track = findTrack(context, trackName);
        if (track) actions.push({ type: "soloTrack", payload: { trackId: track.id, soloed: !track.soloed } });
    } else if (/^(open|show)\s+mixer/i.test(normalized)) {
        actions.push({ type: "openMixer" });
    } else if (/^(close|hide)\s+mixer/i.test(normalized)) {
        actions.push({ type: "closeMixer" });
    } else if (/^rename\s+track\s+(.+)\s+to\s+(.+)/i.test(normalized)) {
        const match = normalized.match(/^rename\s+track\s+(.+)\s+to\s+(.+)/i);
        if (match?.[1] && match[2]) {
            const track = findTrack(context, match[1].trim());
            if (track) actions.push({ type: "renameTrack", payload: { trackId: track.id, name: match[2].trim() } });
        }
    } else if (/^(add|create)\s+(a\s+)?clip/i.test(normalized)) {
        const trackId = context.selectedTrackId ?? context.tracks[0]?.id;
        if (trackId) {
            const barMatch = normalized.match(/(?:from\s+)?bar\s+(\d+)\s+(?:to\s+)?(?:bar\s+)?(\d+)/i);
            const startBar = barMatch?.[1] ? parseInt(barMatch[1], 10) - 1 : 0;
            const endBar = barMatch?.[2] ? parseInt(barMatch[2], 10) - 1 : startBar + 4;
            actions.push({ type: "addClip", payload: { trackId, startBeat: startBar * 4, endBeat: endBar * 4, name: `Clip ${String(Date.now() % 1000)}` } });
        }
    } else if (/^(duplicate|copy)\s+clip/i.test(normalized)) {
        if (context.selectedClipId) {
            actions.push({ type: "duplicateClip", payload: { clipId: context.selectedClipId } });
        }
    } else if (/^(delete|remove)\s+clip/i.test(normalized)) {
        if (context.selectedClipId) {
            actions.push({ type: "removeClip", payload: { clipId: context.selectedClipId } });
        }
    } else if (/^(create|add)\s+bus/i.test(normalized)) {
        const nameMatch = normalized.match(/(?:named|called)\s+(.+)/i);
        const name = nameMatch?.[1] ?? `Bus ${String(Date.now() % 1000)}`;
        actions.push({ type: "createBus", payload: { name } });
    } else if (/^set\s+(?:master\s+)?(?:gain|volume)\s+(?:to\s+)?(\d+)/i.test(normalized)) {
        const match = normalized.match(/(\d+)/);
        const pct = match?.[1] ? parseInt(match[1], 10) : 80;
        actions.push({ type: "setMasterGain", payload: { gain: Math.min(1, pct / 100) } });
    } else if (/^(loop|toggle\s+loop)/i.test(normalized)) {
        actions.push({ type: "toggleLoop" });
    } else if (/^(switch|go)\s+to\s+(arrange|clip|mix)/i.test(normalized)) {
        const match = normalized.match(/(arrange|clip|mix)/i);
        if (match?.[1]) {
            actions.push({ type: "setWorkspaceMode", payload: { mode: match[1] as "arrange" | "clip" | "mix" } });
        }
    } else if (/^(select)\s+(.+)/i.test(normalized)) {
        const trackName = normalized.replace(/^select\s+(the\s+)?/i, "").trim();
        const track = findTrack(context, trackName);
        if (track) actions.push({ type: "selectTrack", payload: { trackId: track.id } });
    }

    const validated = validateActions(actions);

    return {
        actions: validated,
        confidence: validated.length > 0 ? 0.8 : 0,
        rawText: prompt,
        requiresConfirmation: validated.some((a) =>
            a.type === "removeTrack" || a.type === "removeClip",
        ),
    };
};

const findTrack = (context: ProjectContext, name: string) => {
    const lower = name.toLowerCase();
    return context.tracks.find((t) => t.name.toLowerCase() === lower)
        ?? context.tracks.find((t) => t.name.toLowerCase().includes(lower));
};
