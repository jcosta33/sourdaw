import type { AppAction } from "./AppAction";

export type CommandEntry = {
    id: string;
    label: string;
    description: string;
    category: string;
    shortcut?: string;
    action: AppAction | (() => void);
};

export const commandRegistry: CommandEntry[] = [
    { id: "add-audio-track", label: "Add Audio Track", description: "Create a new audio track", category: "Track", action: { type: "addTrack", payload: { name: "Audio", kind: "audio" } } },
    { id: "add-midi-track", label: "Add MIDI Track", description: "Create a new MIDI track", category: "Track", action: { type: "addTrack", payload: { name: "MIDI", kind: "midi" } } },
    { id: "add-bus", label: "Create Bus", description: "Create a new bus track", category: "Track", action: { type: "createBus", payload: { name: "Bus" } } },
    { id: "add-folder", label: "Create Folder", description: "Create a track folder", category: "Track", action: { type: "createFolder", payload: { name: "Folder" } } },
    { id: "toggle-playback", label: "Play / Pause", description: "Toggle transport playback", category: "Transport", shortcut: "Space", action: { type: "togglePlayback" } },
    { id: "stop", label: "Stop", description: "Stop and return to start", category: "Transport", shortcut: "Esc", action: { type: "stopPlayback" } },
    { id: "toggle-recording", label: "Toggle Recording", description: "Start or stop recording", category: "Transport", shortcut: "R", action: { type: "toggleRecording" } },
    { id: "toggle-loop", label: "Toggle Loop", description: "Enable or disable loop", category: "Transport", shortcut: "L", action: { type: "toggleLoop" } },
    { id: "toggle-metronome", label: "Toggle Metronome", description: "Enable or disable metronome", category: "Transport", shortcut: "M", action: { type: "toggleMetronome" } },
    { id: "arrange-mode", label: "Arrange Mode", description: "Switch to arrangement view", category: "View", action: { type: "setWorkspaceMode", payload: { mode: "arrange" } } },
    { id: "clip-mode", label: "Clip Mode", description: "Switch to clip editing view", category: "View", action: { type: "setWorkspaceMode", payload: { mode: "clip" } } },
    { id: "mix-mode", label: "Mix Mode", description: "Switch to mixer view", category: "View", action: { type: "setWorkspaceMode", payload: { mode: "mix" } } },
    { id: "open-mixer", label: "Open Mixer", description: "Show the mixer panel", category: "View", action: { type: "openMixer" } },
    { id: "close-mixer", label: "Close Mixer", description: "Hide the mixer panel", category: "View", action: { type: "closeMixer" } },
    { id: "add-marker", label: "Add Marker", description: "Add a marker at the playhead", category: "Timeline", action: { type: "addMarker", payload: { beat: 0, name: "Marker" } } },
];

export const fuzzyMatch = (query: string, text: string): boolean => {
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    let qi = 0;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
        if (t[ti] === q[qi]) qi++;
    }
    return qi === q.length;
};

export const searchCommands = (query: string): CommandEntry[] => {
    if (!query.trim()) return commandRegistry;
    return commandRegistry.filter(
        (cmd) => fuzzyMatch(query, cmd.label) || fuzzyMatch(query, cmd.description) || fuzzyMatch(query, cmd.category),
    );
};
