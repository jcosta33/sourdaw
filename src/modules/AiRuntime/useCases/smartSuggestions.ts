import type { ProjectContext, ProjectContextTrack } from "../models/ProjectContext";

/**
 * Rule-based contextual suggestions for the PromptBar.
 * Returns 3-5 prompt strings relevant to the current project state.
 */
export const generateSuggestions = (context: ProjectContext): string[] => {
    const suggestions: string[] = [];

    const { tracks, selectedTrackId, selectedClipId, activeView } = context;
    const selectedTrack = tracks.find((t) => t.id === selectedTrackId);
    const selectedClip = selectedTrack?.clips.find((c) => c.id === selectedClipId)
        ?? tracks.flatMap((t) => t.clips).find((c) => c.id === selectedClipId);

    if (tracks.length === 0) {
        return [
            "Add a drum track",
            "Create a new MIDI track",
            "Import an audio file",
        ];
    }

    const totalClips = tracks.reduce((sum, t) => sum + t.clipCount, 0);
    if (totalClips === 0) {
        const firstName = tracks[0]?.name ?? "Track 1";
        suggestions.push(
            `Add a clip to ${firstName}`,
            "Record audio",
            "Import an audio file",
        );
        return cap(suggestions);
    }

    if (selectedClip) {
        if (selectedClip.type === "midi") {
            suggestions.push(
                "Transpose up an octave",
                "Humanize notes",
                "Quantize notes",
            );
            if (selectedTrack) {
                suggestions.push(`Add reverb to ${selectedTrack.name}`);
            }
            if (selectedTrack && hasMelodyButNoChords(selectedTrack)) {
                suggestions.push("Generate chord progression");
            }
        } else {
            suggestions.push(
                "Normalize clip",
                "Reverse clip",
                "Add compression",
            );
        }
        suggestions.push("Duplicate clip", "Split clip at playhead");
        return cap(suggestions);
    }

    if (selectedTrack) {
        if (selectedTrack.deviceCount === 0) {
            suggestions.push(
                `Add EQ to ${selectedTrack.name}`,
                `Add compressor to ${selectedTrack.name}`,
            );
        }

        const automationLanes = selectedTrack.devices.filter((d) => !d.bypassed);
        if (automationLanes.length > 0) {
            suggestions.push(`Draw automation for ${selectedTrack.name}`);
        }
    }

    if (activeView === "mix") {
        const unsoloedTrack = tracks.find((t) => !t.soloed);
        if (unsoloedTrack) {
            suggestions.push(`Solo ${unsoloedTrack.name}`);
        }
        suggestions.push("Add send to bus");
    }

    if (suggestions.length < 3) {
        const fallbacks = [
            `Set tempo to ${context.tempo === 120 ? 140 : 120}`,
            "Export as WAV",
            "Add a bus track",
        ];
        for (const fb of fallbacks) {
            if (suggestions.length >= 5) {
                break;
            }
            if (!suggestions.includes(fb)) {
                suggestions.push(fb);
            }
        }
    }

    return cap(suggestions);
};

const hasMelodyButNoChords = (track: ProjectContextTrack): boolean => {
    if (track.kind !== "midi") {
        return false;
    }
    const midiClips = track.clips.filter((c) => c.type === "midi");
    const hasNotes = midiClips.some((c) => c.noteCount > 0);
    const hasChordClip = midiClips.some((c) => /chord/i.test(c.name));
    return hasNotes && !hasChordClip;
};

const cap = (items: string[]): string[] => items.slice(0, 5);
