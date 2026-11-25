export const WORKSPACE_STAGES = [
    'workspace-ready',
    'initial-placement',
    'pointer-resize',
    'keyboard-resize',
    'title-drag',
    'scale-refit',
    'timeline-transport',
    'nested-escape',
    'remove-instance',
] as const;

export type WorkspaceStage = (typeof WORKSPACE_STAGES)[number];
export type Rectangle = { x: number; y: number; width: number; height: number };
export type ScaleStep =
    | 'title-click'
    | 'close-click'
    | 'detachment'
    | 'original-reopen-click'
    | 'original-reopen-visible'
    | 'preferences-open'
    | 'preferences-appearance'
    | 'preferences-scale'
    | 'preferences-dismiss'
    | 'restore-viewport'
    | 'restore-geometry';
export type WorkspaceObservation = {
    stage: WorkspaceStage;
    outcome: 'not-reached' | 'failed' | 'passed';
    rectangles: { host: Rectangle; dialog: Rectangle }[];
    values: Record<string, number>[];
    instanceIds: string[];
    scaleSteps: {
        name: ScaleStep;
        outcome: 'failed' | 'passed';
        hit?: boolean | null;
        received?: boolean | null;
        x?: number;
        y?: number;
    }[];
};
export type WorkspaceObservations = { stages: WorkspaceObservation[]; appQuit: boolean };
export type EditorWorkspaceDrive = (binary: string, observations: WorkspaceObservations) => Promise<void>;

export function freshWorkspaceObservations(): WorkspaceObservations {
    return {
        stages: WORKSPACE_STAGES.map((stage) => ({
            stage,
            outcome: 'not-reached',
            rectangles: [],
            values: [],
            instanceIds: [],
            scaleSteps: [],
        })),
        appQuit: false,
    };
}

export function workspaceFailure(
    observations: WorkspaceObservations
): 'workspace-observations-incomplete' | 'quit-failed' | null {
    if (
        observations.stages.length !== WORKSPACE_STAGES.length ||
        !WORKSPACE_STAGES.every((stage, index) => {
            const row = observations.stages[index];
            return row?.stage === stage && row.outcome === 'passed';
        })
    ) {
        return 'workspace-observations-incomplete';
    }
    return observations.appQuit ? null : 'quit-failed';
}

/** The shipped readout splits each musical segment into a separate element. */
export function renderedPlayheadBeat(text: string): number | null {
    const match = /^bars\s*(\d+)\s*\.\s*(\d+)\s*\.\s*(\d+)$/iu.exec(text.trim());
    if (match === null) {
        return null;
    }
    const bar = Number(match[1]);
    const beat = Number(match[2]);
    const tick = Number(match[3]);
    if (bar < 1 || beat < 1 || beat > 4 || tick >= 480) {
        return null;
    }
    return (bar - 1) * 4 + beat - 1 + tick / 480;
}

/** Fresh 120 BPM fixture: 120 displayed ticks (a quarter beat) allow 125ms of readout/callback cadence. */
export function pausePreservesProgress(advanced: number, clickReadout: unknown, paused: number): boolean {
    if (!Number.isFinite(advanced) || !Number.isFinite(paused) || typeof clickReadout !== 'string') {
        return false;
    }
    const clicked = renderedPlayheadBeat(clickReadout);
    if (clicked === null) {
        return false;
    }
    const advancedTick = Math.round(advanced * 480);
    const clickedTick = Math.round(clicked * 480);
    const pausedTick = Math.round(paused * 480);
    const parkedDelta = pausedTick - clickedTick;
    return clickedTick >= advancedTick - 1 && pausedTick >= advancedTick - 1 && parkedDelta >= -1 && parkedDelta <= 120;
}
