export type LogicalTrack = {
    name: string;
    kind: string;
    muted: boolean;
    soloed: boolean;
    armed: boolean;
    gain: number;
    pan: number;
    color?: string;
    clip_ids: string[];
    device_ids: string[];
};

export type LogicalClip = {
    name: string;
    type: 'audio' | 'midi';
    track_id: string;
    start_beat: number;
    end_beat: number;
    gain?: number;
    note_count?: number;
};

export type LogicalDevice = {
    name?: string;
    type: string;
    track_id: string;
    bypassed: boolean;
};

export type LogicalState = {
    project_revision: number;
    transport: {
        tempo: number;
        time_signature: [number, number];
        playhead_beat: number;
    };
    tracks: Record<string, LogicalTrack>;
    track_order: string[];
    clips: Record<string, LogicalClip>;
    devices: Record<string, LogicalDevice>;
    selection: {
        track_ids: string[];
        clip_ids: string[];
    };
};

export type ProjectSummary = {
    project_revision: number;
    track_count: number;
    selected_tracks: string[];
    selected_clips: string[];
    tempo: number;
    routing_summary: string;
    recent_edits: string[];
};
