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
export type WorkspaceObservation = {
    stage: WorkspaceStage;
    outcome: 'not-reached' | 'failed' | 'passed';
    rectangles: { host: Rectangle; dialog: Rectangle }[];
    values: Record<string, number>[];
    instanceIds: string[];
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

/** The rendered musical display quantizes position to 480 ticks per beat. */
export function pausePreservesProgress(advanced: number, paused: number): boolean {
    return Number.isFinite(advanced) && Number.isFinite(paused) && paused >= advanced - 1 / 480;
}
