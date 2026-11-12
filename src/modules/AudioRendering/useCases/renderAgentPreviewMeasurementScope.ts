import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { resolveAgentMeasurementTargets } from '#/modules/Arrangement/useCases';
import {
    captureOfflineRenderProjectSource,
    findUnloadedHostedPluginDevices,
    getOfflineYeastRackReader,
    isExportActive,
} from '#/modules/AudioEngine/useCases';
import {
    DOC_PREFIX_ROOT,
    getCrdtDoc,
    projectRevisionMatchesLiveIgnoringSaveWrites,
} from '#/modules/CrdtDocument/useCases';
import { readSecondsAtBeat } from '#/modules/Transport/stores';
import { canonicalJson } from '#/utils/canonicalDigest';

import {
    readAgentMeasurementSpan,
    readAgentMeasurementTimeline,
    type AgentMeasurementTimeline,
    type AgentMeasurementWindow,
} from './cutAgentMeasurementWindow';
import { renderAgentMeasurementTargets, type AgentMeasurementRenderStart } from './renderAgentMeasurementTargets';

type MeasurementScope = Parameters<typeof resolveAgentMeasurementTargets>[0];
type TargetResolution = ReturnType<typeof resolveAgentMeasurementTargets>;
type ResolvedTargets = Extract<TargetResolution, { status: 'resolved' }>;
type TargetsRender = Awaited<ReturnType<typeof renderAgentMeasurementTargets>>;
type WindowedMeasurementTarget = Extract<TargetsRender, { status: 'rendered' }>['targets'][number];
type RenderedMeasurementTarget = Omit<WindowedMeasurementTarget, 'windows'> &
    WindowedMeasurementTarget['windows'][number];
type ProjectSource = ReturnType<typeof captureOfflineRenderProjectSource>;
type RootDocument = Readonly<Record<string, unknown>>;

/** An isolated command preview, as `createCommandPreviewWorkspace` hands one out. */
type PreviewWorkspace = {
    /** Runs `read` synchronously with the CRDT-backed stores answering for the preview document. */
    scope: <Result>(read: () => Result) => Result;
    /** The preview's root document as plain data; reading it decodes nothing. */
    getProjectDocument: () => RootDocument;
    release: () => void;
};

type RangeSeconds = {
    /** Seconds from the range's start to its end. */
    measuredSeconds: number;
    /** Seconds from the timeline start to the range's end: what a render processes, history included. */
    renderedSeconds: number;
};

type RenderAgentPreviewMeasurementWindowsInput = {
    scope: MeasurementScope;
    /** Every range read out of each target's one render in each document. */
    windows: readonly AgentMeasurementWindow[];
    /**
     * The revision every preview workspace was created at. The baseline is the
     * live project at it, and every render refuses once the live project leaves it.
     */
    sourceRevision: string;
    /** Ceilings each document's rendered span must keep, read through that document's own tempo map. */
    rangeCeilings: RangeSeconds;
    /** Each released by this call on every outcome, before anything renders. */
    previews: readonly PreviewWorkspace[];
    signal?: AbortSignal;
    /** Called as each target's render begins, in any document; `previewIndex` is null for the live project. */
    onRenderStart?: (render: AgentMeasurementRenderStart & { previewIndex: number | null }) => void;
};

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

type Subject = 'baseline' | 'preview';

type SubjectCapture = {
    resolution: TargetResolution;
    /** The seconds the rendered span covers, which the ceilings bound. */
    spanSeconds: RangeSeconds;
    /** Each window's own seconds, in window order. */
    windowSeconds: RangeSeconds[];
    timeline: AgentMeasurementTimeline;
};

type PreviewCapture = {
    subject: SubjectCapture;
    project: ProjectSource;
    /** Yeast devices whose rack this preview document stores differently from the live document. */
    divergentYeastDeviceIds: ReadonlySet<string>;
};

type ComparisonCapture = {
    status: 'captured';
    baseline: SubjectCapture;
    previews: PreviewCapture[];
    /** Every device the live project holds; any other device in a preview is one its proposal created. */
    liveDeviceIds: ReadonlySet<string>;
};

type PreviewRefusalCode =
    | Extract<TargetResolution, { status: 'refused' }>['code']
    | Extract<TargetsRender, { status: 'refused' }>['code']
    | 'render-busy'
    | 'range-exceeds-ceiling'
    | 'unprojectable-device-state'
    | 'unrenderable-preview-device';

type PreviewRefusal = {
    status: 'refused';
    code: PreviewRefusalCode;
    /** The document whose render refused; null when the comparison refuses as a whole. */
    subject: Subject | null;
    targetId: string | null;
    contributorId: string | null;
    /** The preview device the render cannot carry faithfully, for a device refusal. */
    deviceId: string | null;
};

type WindowedSubject = {
    soloActive: boolean;
    /** Each window's own seconds, in window order. */
    windowSeconds: RangeSeconds[];
    targets: WindowedMeasurementTarget[];
    /** Renderer warnings. */
    warnings: string[];
};

type RenderedSubject = {
    soloActive: boolean;
    rangeSeconds: RangeSeconds;
    targets: RenderedMeasurementTarget[];
    /** Renderer warnings. */
    warnings: string[];
};

type RenderAgentPreviewMeasurementWindowsResult =
    | { status: 'rendered'; baseline: WindowedSubject; previews: WindowedSubject[] }
    | PreviewRefusal
    | { status: 'cancelled' };

type RenderAgentPreviewMeasurementScopeResult =
    | { status: 'rendered'; baseline: RenderedSubject; preview: RenderedSubject }
    | PreviewRefusal
    | { status: 'cancelled' };

function refused(
    code: PreviewRefusalCode,
    subject: Subject | null,
    { targetId = null, deviceId = null }: { targetId?: string | null; deviceId?: string | null } = {}
): PreviewRefusal {
    return { status: 'refused', code, subject, targetId, contributorId: null, deviceId };
}

function readRangeSeconds(startBeat: number, endBeat: number): RangeSeconds {
    const endSeconds = readSecondsAtBeat({ beat: endBeat });
    return {
        measuredSeconds: endSeconds - readSecondsAtBeat({ beat: startBeat }),
        renderedSeconds: endSeconds - readSecondsAtBeat({ beat: 0 }),
    };
}

function readLiveDocument<Result>(read: () => Result): Result {
    return read();
}

/** One document's targets, seconds and timeline, each read with that document's stores answering. */
function captureSubject(
    input: RenderAgentPreviewMeasurementWindowsInput,
    readDocument: PreviewWorkspace['scope']
): SubjectCapture {
    const span = readAgentMeasurementSpan(input.windows);
    return {
        resolution: readDocument(() => resolveAgentMeasurementTargets(input.scope)),
        spanSeconds: readDocument(() => readRangeSeconds(span.startBeat, span.endBeat)),
        windowSeconds: input.windows.map((window) =>
            readDocument(() => readRangeSeconds(window.startBeat, window.endBeat))
        ),
        timeline: readDocument(readAgentMeasurementTimeline),
    };
}

function readLiveDeviceIds(): Set<string> {
    const tracks = trackStore.value?.tracks ?? [];
    return new Set(tracks.flatMap((track) => track.devices.map((device) => device.id)));
}

type YeastRackReader = NonNullable<ReturnType<typeof getOfflineYeastRackReader>>;

/**
 * The preview's Yeast racks are read live (see `captureOfflineRenderProjectSource`),
 * which is faithful only for a rack the preview stores exactly as the live
 * project does. Both documents' racks are compared undecoded, so the check runs
 * no Yeast adapter state for either. Without the owner's rack reads the capture
 * holds no rack at all, so every Yeast device counts as divergent.
 */
function findDivergentYeastRacks(
    project: ProjectSource,
    previewDocument: RootDocument,
    legacyRackOwners: LegacyRackOwners | null
): Set<string> {
    const deviceIds = Object.keys(project.yeastProcessorsByDevice);
    const racks = getOfflineYeastRackReader();
    if (racks === null || legacyRackOwners === null) {
        return new Set(deviceIds);
    }
    const liveDocument: RootDocument = getCrdtDoc(DOC_PREFIX_ROOT) ?? {};
    const divergent = new Set<string>(findMovedLegacyRackOwners(racks, liveDocument, legacyRackOwners));
    for (const deviceId of deviceIds) {
        const previewRack = canonicalJson(racks.readStoredRack(previewDocument, deviceId));
        if (previewRack !== canonicalJson(racks.readStoredRack(liveDocument, deviceId))) {
            divergent.add(deviceId);
        }
    }
    return divergent;
}

/** The first Yeast device in each document's project order: the owner a legacy rack is adopted by. */
type LegacyRackOwners = { live: string | null; preview: string | null };

function readLegacyRackOwners(previewScope: PreviewWorkspace['scope']): LegacyRackOwners | null {
    const racks = getOfflineYeastRackReader();
    if (racks === null) {
        return null;
    }
    return { live: racks.firstDeviceInProjectOrder(), preview: previewScope(racks.firstDeviceInProjectOrder) };
}

/**
 * A legacy single-rack slot is keyed by no device: whichever Yeast device comes first in project
 * order adopts it, unless that device stores a rack keyed by its own id, which it reads first. The
 * racks are read live, so they follow the live first device; once the preview puts another device
 * first, each of the two that would adopt or lose the legacy rack — any with no keyed rack of its
 * own — renders a rack the applied edit would not give it, and counts as divergent.
 */
function findMovedLegacyRackOwners(
    racks: YeastRackReader,
    liveDocument: RootDocument,
    owners: LegacyRackOwners
): string[] {
    if (owners.live === owners.preview || !racks.holdsLegacyRack(liveDocument)) {
        return [];
    }
    return [owners.live, owners.preview].filter(
        (deviceId): deviceId is string => deviceId !== null && !racks.holdsKeyedRack(liveDocument, deviceId)
    );
}

function capturePreview(input: RenderAgentPreviewMeasurementWindowsInput, preview: PreviewWorkspace): PreviewCapture {
    const project = captureOfflineRenderProjectSource(preview.scope);
    return {
        subject: captureSubject(input, preview.scope),
        project,
        divergentYeastDeviceIds: findDivergentYeastRacks(
            project,
            preview.getProjectDocument(),
            readLegacyRackOwners(preview.scope)
        ),
    };
}

/**
 * Everything every render reads from its document, taken synchronously; each
 * workspace is released before this returns or throws, so no preview outlives
 * the capture and none is active while anything renders.
 */
function captureComparison(
    input: RenderAgentPreviewMeasurementWindowsInput
): ComparisonCapture | PreviewRefusal | { status: 'cancelled' } {
    try {
        if (input.signal?.aborted) {
            return { status: 'cancelled' };
        }
        if (!projectRevisionMatchesLiveIgnoringSaveWrites(input.sourceRevision)) {
            return refused('stale-revision', null);
        }
        return {
            status: 'captured',
            baseline: captureSubject(input, readLiveDocument),
            previews: input.previews.map((preview) => capturePreview(input, preview)),
            liveDeviceIds: readLiveDeviceIds(),
        };
    } finally {
        for (const preview of input.previews) {
            preview.release();
        }
    }
}

function exceedsCeilings(range: RangeSeconds, ceilings: RangeSeconds): boolean {
    return range.measuredSeconds > ceilings.measuredSeconds || range.renderedSeconds > ceilings.renderedSeconds;
}

/** The first reason a subject cannot render, decided before anything renders. */
function refuseSubject(
    subject: Subject,
    capture: SubjectCapture,
    ceilings: RangeSeconds
): PreviewRefusal | ResolvedTargets {
    if (capture.resolution.status === 'refused') {
        return { ...capture.resolution, subject, deviceId: null };
    }
    if (exceedsCeilings(capture.spanSeconds, ceilings)) {
        return refused('range-exceeds-ceiling', subject);
    }
    return capture.resolution;
}

/** Every track the preview's targets render: the whole document for a mixdown, each subgraph otherwise. */
function previewRenderedTracks(targets: ResolvedTargets, project: ProjectSource): readonly Track[] {
    if (targets.targets.some((target) => target.subgraph === null)) {
        return project.tracks?.tracks ?? [];
    }
    return targets.targets.flatMap((target) => target.subgraph?.renderTracks ?? []);
}

/**
 * A preview device whose render would not be the preview's own: a Yeast rack
 * the preview stores differently from the one the render reads, or a hosted
 * plugin the proposal created, which no loaded instance backs and the render
 * would carry as silence. Either way the delta would describe a document
 * nobody rendered, so the preview refuses instead.
 */
function refusePreviewDevices(
    targets: ResolvedTargets,
    preview: PreviewCapture,
    liveDeviceIds: ReadonlySet<string>
): PreviewRefusal | null {
    const devices = previewRenderedTracks(targets, preview.project).flatMap((track) => track.devices);
    const unprojectable = devices.find((device) => preview.divergentYeastDeviceIds.has(device.id));
    if (unprojectable !== undefined) {
        return refused('unprojectable-device-state', 'preview', { deviceId: unprojectable.id });
    }
    const created = devices.filter((device) => !liveDeviceIds.has(device.id));
    const [unrenderable] = findUnloadedHostedPluginDevices(created);
    if (unrenderable !== undefined) {
        return refused('unrenderable-preview-device', 'preview', { deviceId: unrenderable.id });
    }
    return null;
}

/** Stale revision is the comparison's refusal, not one document's: both renders describe the revision it left. */
function subjectRefusal(
    outcome: Exclude<TargetsRender, { status: 'rendered' }>,
    subject: Subject
): PreviewRefusal | { status: 'cancelled' } {
    if (outcome.status === 'cancelled') {
        return outcome;
    }
    return { ...outcome, subject: outcome.code === 'stale-revision' ? null : subject, deviceId: null };
}

async function renderSubject(
    input: RenderAgentPreviewMeasurementWindowsInput,
    capture: SubjectCapture,
    resolution: ResolvedTargets,
    source: { project: ProjectSource; previewIndex: number } | null
): Promise<{ status: 'rendered'; subject: WindowedSubject } | Exclude<TargetsRender, { status: 'rendered' }>> {
    const warnings: string[] = [];
    const previewIndex = source?.previewIndex ?? null;
    const rendered = await renderAgentMeasurementTargets({
        targets: resolution.targets,
        windows: input.windows,
        timeline: capture.timeline,
        sourceRevision: input.sourceRevision,
        signal: input.signal,
        project: source?.project,
        onRenderStart: (render) => input.onRenderStart?.({ ...render, previewIndex }),
        onWarning: (message) => warnings.push(message),
    });
    if (rendered.status !== 'rendered') {
        return rendered;
    }
    return {
        status: 'rendered',
        subject: {
            soloActive: resolution.soloActive,
            windowSeconds: capture.windowSeconds,
            targets: rendered.targets,
            warnings,
        },
    };
}

/** Every preview's targets, after its own refusals, decided before anything renders. */
function refusePreviews(
    input: RenderAgentPreviewMeasurementWindowsInput,
    captured: ComparisonCapture
): PreviewRefusal | ResolvedTargets[] {
    const resolved: ResolvedTargets[] = [];
    for (const preview of captured.previews) {
        const targets = refuseSubject('preview', preview.subject, input.rangeCeilings);
        if (targets.status === 'refused') {
            return targets;
        }
        const deviceRefusal = refusePreviewDevices(targets, preview, captured.liveDeviceIds);
        if (deviceRefusal !== null) {
            return deviceRefusal;
        }
        resolved.push(targets);
    }
    return resolved;
}

/**
 * Render one agent measurement scope once in the live project at the previews'
 * base revision, then once in each isolated preview of a proposal, each render
 * covering the span of every window and handing back each window's own
 * samples. One live render therefore serves the comparison with every preview.
 * Nothing is retained here: the caller retains the renders once it has
 * reported on them (`retainAgentMeasurementRenders`).
 *
 * Every store read any render needs is taken before anything renders, each
 * preview's through its workspace, which is released before the first render
 * starts. Each preview therefore renders from a detached copy of its document:
 * nothing it does can reach the live document or stores, and no preview stays
 * active across the asynchronous renders. Ranges are converted to seconds and
 * frames through each document's own tempo map. A preview device the render
 * cannot carry from that preview's own data refuses the comparison rather than
 * rendering something else. Every render is bound to the base revision: once
 * the live project leaves it, the comparison refuses as a whole and retains
 * nothing.
 */
export async function renderAgentPreviewMeasurementWindows(
    input: RenderAgentPreviewMeasurementWindowsInput
): Promise<RenderAgentPreviewMeasurementWindowsResult> {
    const captured = captureComparison(input);
    if (captured.status !== 'captured') {
        return captured;
    }
    const baselineTargets = refuseSubject('baseline', captured.baseline, input.rangeCeilings);
    if (baselineTargets.status === 'refused') {
        return baselineTargets;
    }
    const previewTargets = refusePreviews(input, captured);
    if (!Array.isArray(previewTargets)) {
        return previewTargets;
    }
    if (input.scope.kind === 'master' && isExportActive()) {
        return refused('render-busy', null);
    }
    const baseline = await renderSubject(input, captured.baseline, baselineTargets, null);
    if (baseline.status !== 'rendered') {
        return subjectRefusal(baseline, 'baseline');
    }
    const previews: WindowedSubject[] = [];
    for (const [previewIndex, preview] of captured.previews.entries()) {
        const rendered = await renderSubject(input, preview.subject, previewTargets[previewIndex]!, {
            project: preview.project,
            previewIndex,
        });
        if (rendered.status !== 'rendered') {
            return subjectRefusal(rendered, 'preview');
        }
        previews.push(rendered.subject);
    }
    return { status: 'rendered', baseline: baseline.subject, previews };
}

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
