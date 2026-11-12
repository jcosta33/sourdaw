import {
    SIDEBAR_WIDTH_BOUNDS,
    INSPECTOR_WIDTH_BOUNDS,
    TRACK_LIST_WIDTH_BOUNDS,
    SESSION_VIEW_WIDTH_BOUNDS,
    VIRTUAL_KEYBOARD_HEIGHT_BOUNDS,
} from '#/utils/Layout/panelDimensionBounds';
import { clamp } from '#/utils/Math/clamp';

import { defaultWorkspaceState, type WorkspaceMode, type WorkspaceState } from './WorkspaceState';

const PROJECT_WORKING_VIEW_VERSION = 1;
const DEFAULT_PIXELS_PER_BEAT = 12;

const PROJECT_WORKING_WORKSPACE_KEYS = [
    'mode',
    'sidebarOpen',
    'inspectorOpen',
    'mixerOpen',
    'automationPanelOpen',
    'trackListOpen',
    'dualViewOpen',
    'scratchPadOpen',
    'virtualKeyboardOpen',
    'sidebarWidth',
    'inspectorWidth',
    'mixerHeight',
    'editorHeight',
    'automationPanelWidth',
    'trackListWidth',
    'sessionViewWidth',
    'scratchPadHeight',
    'virtualKeyboardHeight',
] as const;

export type ProjectWorkingTimeline = {
    scrollX: number;
    scrollY: number;
    pixelsPerBeat: number;
};

export type ProjectWorkingView = {
    version: typeof PROJECT_WORKING_VIEW_VERSION;
    timeline: ProjectWorkingTimeline;
    workspace: Pick<WorkspaceState, (typeof PROJECT_WORKING_WORKSPACE_KEYS)[number]>;
};

type CaptureProjectWorkingViewInput = {
    workspace: WorkspaceState;
    timeline: ProjectWorkingTimeline;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function readDimension(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function readPanelDimension(value: unknown, fallback: number, bounds: { min: number; max: number }): number {
    return clamp(readDimension(value, fallback), bounds.min, bounds.max);
}

function readMode(value: unknown): WorkspaceMode {
    return value === 'arrange' || value === 'automation' || value === 'clip' ? value : defaultWorkspaceState.mode;
}

export function createDefaultProjectWorkingView(): ProjectWorkingView {
    return captureProjectWorkingView({
        workspace: defaultWorkspaceState,
        timeline: { scrollX: 0, scrollY: 0, pixelsPerBeat: DEFAULT_PIXELS_PER_BEAT },
    });
}

export function captureProjectWorkingView(input: CaptureProjectWorkingViewInput): ProjectWorkingView {
    const { workspace, timeline } = input;
    return {
        version: PROJECT_WORKING_VIEW_VERSION,
        timeline: {
            scrollX: timeline.scrollX,
            scrollY: timeline.scrollY,
            pixelsPerBeat: timeline.pixelsPerBeat,
        },
        workspace: {
            mode: workspace.mode,
            sidebarOpen: workspace.sidebarOpen,
            inspectorOpen: workspace.inspectorOpen,
            mixerOpen: workspace.mixerOpen,
            automationPanelOpen: workspace.automationPanelOpen,
            trackListOpen: workspace.trackListOpen,
            dualViewOpen: workspace.dualViewOpen,
            scratchPadOpen: workspace.scratchPadOpen,
            virtualKeyboardOpen: workspace.virtualKeyboardOpen,
            sidebarWidth: workspace.sidebarWidth,
            inspectorWidth: workspace.inspectorWidth,
            mixerHeight: workspace.mixerHeight,
            editorHeight: workspace.editorHeight,
            automationPanelWidth: workspace.automationPanelWidth,
            trackListWidth: workspace.trackListWidth,
            sessionViewWidth: workspace.sessionViewWidth,
            scratchPadHeight: workspace.scratchPadHeight,
            virtualKeyboardHeight: workspace.virtualKeyboardHeight,
        },
    };
}

export function decodeProjectWorkingView(value: unknown): ProjectWorkingView | null {
    if (!isRecord(value) || value.version !== PROJECT_WORKING_VIEW_VERSION) {
        return null;
    }

    const defaults = createDefaultProjectWorkingView();
    const timeline = isRecord(value.timeline) ? value.timeline : {};
    const workspace = isRecord(value.workspace) ? value.workspace : {};
    return {
        version: PROJECT_WORKING_VIEW_VERSION,
        timeline: {
            scrollX: readDimension(timeline.scrollX, defaults.timeline.scrollX),
            scrollY: readDimension(timeline.scrollY, defaults.timeline.scrollY),
            pixelsPerBeat:
                typeof timeline.pixelsPerBeat === 'number' &&
                Number.isFinite(timeline.pixelsPerBeat) &&
                timeline.pixelsPerBeat > 0
                    ? timeline.pixelsPerBeat
                    : defaults.timeline.pixelsPerBeat,
        },
        workspace: {
            mode: readMode(workspace.mode),
            sidebarOpen: readBoolean(workspace.sidebarOpen, defaults.workspace.sidebarOpen),
            inspectorOpen: readBoolean(workspace.inspectorOpen, defaults.workspace.inspectorOpen),
            mixerOpen: readBoolean(workspace.mixerOpen, defaults.workspace.mixerOpen),
            automationPanelOpen: readBoolean(workspace.automationPanelOpen, defaults.workspace.automationPanelOpen),
            trackListOpen: readBoolean(workspace.trackListOpen, defaults.workspace.trackListOpen),
            dualViewOpen: readBoolean(workspace.dualViewOpen, defaults.workspace.dualViewOpen),
            scratchPadOpen: readBoolean(workspace.scratchPadOpen, defaults.workspace.scratchPadOpen),
            virtualKeyboardOpen: readBoolean(workspace.virtualKeyboardOpen, defaults.workspace.virtualKeyboardOpen),
            sidebarWidth: readPanelDimension(
                workspace.sidebarWidth,
                defaults.workspace.sidebarWidth,
                SIDEBAR_WIDTH_BOUNDS
            ),
            inspectorWidth: readPanelDimension(
                workspace.inspectorWidth,
                defaults.workspace.inspectorWidth,
                INSPECTOR_WIDTH_BOUNDS
            ),
            mixerHeight: readDimension(workspace.mixerHeight, defaults.workspace.mixerHeight),
            editorHeight: readDimension(workspace.editorHeight, defaults.workspace.editorHeight),
            automationPanelWidth: readDimension(
                workspace.automationPanelWidth,
                defaults.workspace.automationPanelWidth
            ),
            trackListWidth: readPanelDimension(
                workspace.trackListWidth,
                defaults.workspace.trackListWidth,
                TRACK_LIST_WIDTH_BOUNDS
            ),
            sessionViewWidth: readPanelDimension(
                workspace.sessionViewWidth,
                defaults.workspace.sessionViewWidth,
                SESSION_VIEW_WIDTH_BOUNDS
            ),
            scratchPadHeight: readDimension(workspace.scratchPadHeight, defaults.workspace.scratchPadHeight),
            virtualKeyboardHeight: readPanelDimension(
                workspace.virtualKeyboardHeight,
                defaults.workspace.virtualKeyboardHeight,
                VIRTUAL_KEYBOARD_HEIGHT_BOUNDS
            ),
        },
    };
}

export function projectWorkingViewEquals(left: ProjectWorkingView, right: ProjectWorkingView): boolean {
    return (
        left.timeline.scrollX === right.timeline.scrollX &&
        left.timeline.scrollY === right.timeline.scrollY &&
        left.timeline.pixelsPerBeat === right.timeline.pixelsPerBeat &&
        PROJECT_WORKING_WORKSPACE_KEYS.every((key) => left.workspace[key] === right.workspace[key])
    );
}
