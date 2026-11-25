import { parse } from 'superjson';
import { beforeEach, describe, expect, it } from 'vitest';

import { MAX_COLLECTION_LENGTH } from '../../models/AgentRunPlanBounds';
import { type ProjectContext, type ProjectContextTrack } from '../../models/ProjectContext';
import { sanitizeAgentRunState } from '../../stores/agentRunStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { buildAgentContext } from '../buildAgentContext';

const RUN_ID = 'context-evidence-run';
const BOUND = MAX_COLLECTION_LENGTH;
const OVERFULL = BOUND + 44;

function track(index: number): ProjectContextTrack {
    return {
        id: `track-${String(index)}`,
        name: `Track ${String(index)}`,
        kind: 'audio',
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        gain: 1,
        pan: 0,
        automationMode: 'read',
        clipCount: 0,
        deviceCount: 0,
        clips: [],
        devices: [],
    };
}

function projectWith(counts: { tracks: number; lanes: number; sections: number; selectedClips: number }) {
    const context: ProjectContext = {
        tempo: 120,
        timeSignature: [4, 4],
        isPlaying: false,
        isRecording: false,
        isLooping: false,
        loopStart: 0,
        loopEnd: 16,
        punchInEnabled: false,
        punchInBeat: 0,
        punchOutBeat: 16,
        metronomeEnabled: false,
        metronomeVolume: 0.5,
        masterGain: 1,
        activeView: 'arrange',
        playheadPosition: 0,
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: Array.from({ length: counts.selectedClips }, (_, index) => `clip-${String(index)}`),
        tracks: Array.from({ length: counts.tracks }, (_, index) => track(index)),
        automationLanes: Array.from({ length: counts.lanes }, (_, index) => ({
            id: `lane-${String(index)}`,
            trackId: 'track-0',
            parameterId: 'gain',
            name: `Gain ${String(index)}`,
            enabled: true,
            minValue: 0,
            maxValue: 1,
            minValueDb: -60,
            maxValueDb: 0,
            points: [],
        })),
        sections: Array.from({ length: counts.sections }, (_, index) => ({
            id: `section-${String(index)}`,
            name: `Section ${String(index)}`,
            startBeat: index,
            endBeat: index + 1,
        })),
    };
    return buildAgentContext({ fixedPolicy: 'policy', prompt: 'inspect', context, projectRevision: 'revision-1' });
}

function storedRun() {
    const raw = window.localStorage.getItem('sourdaw-agent-runs');
    const run = sanitizeAgentRunState(parse<unknown>(raw ?? '')).runs.find((candidate) => candidate.runId === RUN_ID);
    if (run === undefined) {
        throw new Error('The run did not survive the reload.');
    }
    return run;
}

describe('agent context evidence recorded on a run', () => {
    beforeEach(() => {
        agentRunLifecycle.clear();
        agentRunLifecycle.create({ runId: RUN_ID, request: 'Inspect.', mode: 'plan', createdRevision: 'revision-1' });
    });

    it('never holds more project snapshot entries than a run reads back, however large the project', () => {
        const { evidence } = projectWith({ tracks: OVERFULL, lanes: OVERFULL, sections: OVERFULL, selectedClips: 0 });

        expect(evidence.snapshot.selectableTargets.length).toBeGreaterThan(0);
        expect(evidence.snapshot.selectableTargets.length).toBeLessThanOrEqual(BOUND);
        expect(evidence.snapshot.automationLanes.length).toBeGreaterThan(0);
        expect(evidence.snapshot.automationLanes.length).toBeLessThanOrEqual(BOUND);
        expect(evidence.snapshot.sections?.length).toBeGreaterThan(0);
        expect(evidence.snapshot.sections?.length).toBeLessThanOrEqual(BOUND);

        agentRunLifecycle.recordContextEvidence({ runId: RUN_ID, evidence });
        expect(storedRun().contextEvidence).toEqual(evidence);
    });

    it('refuses a selection of more clips than a run reads back and keeps one at the bound', () => {
        const atBound = projectWith({ tracks: 1, lanes: 0, sections: 0, selectedClips: BOUND }).evidence;
        const overfull = projectWith({ tracks: 1, lanes: 0, sections: 0, selectedClips: BOUND + 1 }).evidence;

        expect(() => agentRunLifecycle.recordContextEvidence({ runId: RUN_ID, evidence: overfull })).toThrow(
            `the run cannot hold more than ${String(BOUND)} entries in run.contextEvidence.selection.clipIds`
        );
        expect(storedRun().contextEvidence).toBeNull();

        agentRunLifecycle.recordContextEvidence({ runId: RUN_ID, evidence: atBound });
        expect(storedRun().contextEvidence?.selection.clipIds).toHaveLength(BOUND);
    });
});
