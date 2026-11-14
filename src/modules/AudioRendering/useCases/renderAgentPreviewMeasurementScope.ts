import {
    renderAgentPreviewMeasurementWindows,
    type PreviewRefusal,
    type PreviewWorkspace,
    type RangeSeconds,
    type RenderAgentPreviewMeasurementWindowsInput,
    type WindowedMeasurementTarget,
    type WindowedSubject,
} from './renderAgentPreviewMeasurementWindows';

type RenderedMeasurementTarget = Omit<WindowedMeasurementTarget, 'windows'> &
    WindowedMeasurementTarget['windows'][number];

type RenderAgentPreviewMeasurementScopeInput = Omit<
    RenderAgentPreviewMeasurementWindowsInput,
    'windows' | 'previews' | 'onRenderStart'
> & {
    startBeat: number;
    endBeat: number;
    /** Released by this call on every outcome, before anything renders. */
    preview: PreviewWorkspace;
    /** Called as each target's render begins, in either document. */
    onRenderStart?: () => void;
};

type RenderedSubject = {
    soloActive: boolean;
    rangeSeconds: RangeSeconds;
    targets: RenderedMeasurementTarget[];
    /** Renderer warnings. */
    warnings: string[];
};

type RenderAgentPreviewMeasurementScopeResult =
    | { status: 'rendered'; baseline: RenderedSubject; preview: RenderedSubject }
    | PreviewRefusal
    | { status: 'cancelled' };

function singleWindowSubject(subject: WindowedSubject): RenderedSubject {
    return {
        soloActive: subject.soloActive,
        rangeSeconds: subject.windowSeconds[0]!,
        targets: subject.targets.map(({ windows, ...target }) => ({ ...target, ...windows[0]! })),
        warnings: subject.warnings,
    };
}

/**
 * Render one agent measurement scope twice over the same beat range — the
 * live project at the preview's base revision, then the isolated preview of a
 * proposal: the windowed comparison with one preview and that range as its
 * only window.
 */
export async function renderAgentPreviewMeasurementScope(
    input: RenderAgentPreviewMeasurementScopeInput
): Promise<RenderAgentPreviewMeasurementScopeResult> {
    const { startBeat, endBeat, preview, onRenderStart, ...rest } = input;
    const rendered = await renderAgentPreviewMeasurementWindows({
        ...rest,
        windows: [{ startBeat, endBeat }],
        previews: [preview],
        onRenderStart: onRenderStart === undefined ? undefined : () => onRenderStart(),
    });
    if (rendered.status !== 'rendered') {
        return rendered;
    }
    return {
        status: 'rendered',
        baseline: singleWindowSubject(rendered.baseline),
        preview: singleWindowSubject(rendered.previews[0]!),
    };
}
