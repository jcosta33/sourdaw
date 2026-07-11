import { describe, it, expect } from 'vitest';

import { type LogicalState, type ProjectSummary } from '../../../models/DsoLogicalState';
import { buildDsoPrompt } from '../dsoPrompt';

describe('buildDsoPrompt', () => {
    const mockSummary: ProjectSummary = {
        project_revision: 1,
        track_count: 2,
        selected_tracks: ['t1'],
        selected_clips: [],
        tempo: 120,
        routing_summary: 'Track 1, Track 2 → Master',
        recent_edits: ['Added Track 2'],
    };

    const mockState: LogicalState = {
        project_revision: 1,
        transport: { tempo: 120, time_signature: [4, 4], playhead_beat: 0 },
        track_order: ['t1', 't2'],
        tracks: {
            t1: {
                name: 'Track 1',
                kind: 'audio',
                muted: false,
                soloed: true,
                armed: false,
                gain: 0.8,
                pan: 0,
                clip_ids: ['c1'],
                device_ids: ['d1'],
            },
            t2: {
                name: 'Track 2',
                kind: 'midi',
                muted: true,
                soloed: false,
                armed: true,
                gain: 0.5,
                pan: -10,
                clip_ids: [],
                device_ids: [],
            },
        },
        clips: {
            c1: { name: 'Audio Clip', type: 'audio', track_id: 't1', start_beat: 0, end_beat: 4 },
        },
        devices: {
            d1: { type: 'EQ', track_id: 't1', bypassed: false },
        },
        selection: {
            track_ids: ['t1'],
            clip_ids: [],
        },
    };

    it('builds a system prompt and a formatted user prompt with state context', () => {
        const { system, user } = buildDsoPrompt(mockState, 'make it louder', mockSummary);

        expect(system).toContain('You are a deterministic DAW edit planner');
        expect(system).toContain('## Output format');
        expect(system).toContain('## DSO operations');

        expect(user).toContain('Project: 2 tracks, 120 BPM');
        expect(user).toContain('Currently selected track: "Track 1"');
        expect(user).toContain('Recent edits: Added Track 2');

        expect(user).toContain('- "Track 1" (audio, gain:0.8, pan:0) [soloed]');
        expect(user).toContain('clip: "Audio Clip" (audio, beat 0–4)');
        expect(user).toContain('device: EQ');

        expect(user).toContain('- "Track 2" (midi, gain:0.5, pan:-10) [muted, armed]');

        expect(user).toContain('User request: make it louder');
    });

    it('handles empty states gracefully', () => {
        const emptySummary: ProjectSummary = {
            project_revision: 1,
            track_count: 0,
            selected_tracks: [],
            selected_clips: [],
            tempo: 120,
            routing_summary: 'Empty project',
            recent_edits: [],
        };
        const emptyState: LogicalState = {
            project_revision: 1,
            transport: { tempo: 120, time_signature: [4, 4], playhead_beat: 0 },
            track_order: [],
            tracks: {},
            clips: {},
            devices: {},
            selection: { track_ids: [], clip_ids: [] },
        };

        const { user } = buildDsoPrompt(emptyState, 'hello', emptySummary);

        expect(user).toContain('Project: 0 tracks, 120 BPM');
        expect(user).not.toContain('Currently selected track');
        expect(user).not.toContain('Recent edits');
        expect(user).toContain('User request: hello');
    });
});
