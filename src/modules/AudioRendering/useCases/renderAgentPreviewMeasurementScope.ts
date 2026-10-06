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
    projectRevisionMatchesLiveIgnoringCommandCheckpoint,
} from '#/modules/CrdtDocument/useCases';
import { readSecondsAtBeat } from '#/modules/Transport/stores';
import { canonicalJson } from '#/utils/canonicalDigest';

import { renderAgentMeasurementTargets } from './renderAgentMeasurementTargets';
import { retainAgentMeasurementArtifacts } from './retainAgentMeasurementArtifacts';

type MeasurementScope = Parameters<typeof resolveAgentMeasurementTargets>[0];
type TargetResolution = ReturnType<typeof resolveAgentMeasurementTargets>;
type ResolvedTargets = Extract<TargetResolution, { status: 'resolved' }>;
type TargetsRender = Awaited<ReturnType<typeof renderAgentMeasurementTargets>>;
type RenderedMeasurementTarget = Extract<TargetsRender, { status: 'rendered' }>['targets'][number];
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

type RenderAgentPreviewMeasurementScopeInput = {
    scope: MeasurementScope;
    startBeat: number;
    endBeat: number;
    /**
     * The revision the preview workspace was created at. The baseline is the
     * live project at it, and both renders refuse once the live project leaves it.
     */
    sourceRevision: string;
    /** Ceilings each document's range must keep, read through that document's own tempo map. */
    rangeCeilings: RangeSeconds;
    /** Released by this call on every outcome, before anything renders. */
    preview: PreviewWorkspace;
    signal?: AbortSignal;
    /** Called as each target's render begins, in either document. */
    onRenderStart?: () => void;
};

type Subject = 'baseline' | 'preview';

type SubjectCapture = { resolution: TargetResolution; rangeSeconds: RangeSeconds };

type ComparisonCapture = {
    status: 'captured';
    baseline: SubjectCapture;
    preview: SubjectCapture;
    project: ProjectSource;
    /** Every device the live project holds; any other device in the preview is one the proposal created. */
    liveDeviceIds: ReadonlySet<string>;
    /** Yeast devices whose rack the preview document stores differently from the live document. */
    divergentYeastDeviceIds: ReadonlySet<string>;
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

type RenderedSubject = {
    soloActive: boolean;
    rangeSeconds: RangeSeconds;
    targets: RenderedMeasurementTarget[];
    /** Renderer warnings, then one line per render too large to retain. */
    warnings: string[];
};

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

/** One document's targets and range seconds, each read with that document's stores answering. */
function captureSubject(
    input: RenderAgentPreviewMeasurementScopeInput,
    readDocument: PreviewWorkspace['scope']
): SubjectCapture {
    return {
        resolution: readDocument(() => resolveAgentMeasurementTargets(input.scope)),
        rangeSeconds: readDocument(() => readRangeSeconds(input.startBeat, input.endBeat)),
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

/**
 * Everything both renders read from their documents, taken synchronously; the
 * workspace is released before this returns or throws, so no preview outlives
 * the capture and none is active while anything renders.
 */
function captureComparison(
    input: RenderAgentPreviewMeasurementScopeInput
): ComparisonCapture | PreviewRefusal | { status: 'cancelled' } {
    try {
        if (input.signal?.aborted) {
            return { status: 'cancelled' };
        }
        if (!projectRevisionMatchesLiveIgnoringCommandCheckpoint(input.sourceRevision)) {
            return refused('stale-revision', null);
        }
        const project = captureOfflineRenderProjectSource(input.preview.scope);
        return {
            status: 'captured',
            baseline: captureSubject(input, readLiveDocument),
            preview: captureSubject(input, input.preview.scope),
            project,
            liveDeviceIds: readLiveDeviceIds(),
            divergentYeastDeviceIds: findDivergentYeastRacks(
                project,
                input.preview.getProjectDocument(),
                readLegacyRackOwners(input.preview.scope)
            ),
        };
    } finally {
        input.preview.release();
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
    if (exceedsCeilings(capture.rangeSeconds, ceilings)) {
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
function refusePreviewDevices(targets: ResolvedTargets, captured: ComparisonCapture): PreviewRefusal | null {
    const devices = previewRenderedTracks(targets, captured.project).flatMap((track) => track.devices);
    const unprojectable = devices.find((device) => captured.divergentYeastDeviceIds.has(device.id));
    if (unprojectable !== undefined) {
        return refused('unprojectable-device-state', 'preview', { deviceId: unprojectable.id });
    }
    const created = devices.filter((device) => !captured.liveDeviceIds.has(device.id));
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
    input: RenderAgentPreviewMeasurementScopeInput,
    capture: SubjectCapture,
    resolution: ResolvedTargets,
    project: ProjectSource | undefined
): Promise<{ status: 'rendered'; subject: RenderedSubject } | Exclude<TargetsRender, { status: 'rendered' }>> {
    const warnings: string[] = [];
    const rendered = await renderAgentMeasurementTargets({
        targets: resolution.targets,
        startBeat: input.startBeat,
        endBeat: input.endBeat,
        sourceRevision: input.sourceRevision,
        signal: input.signal,
        project,
        onRenderStart: input.onRenderStart,
        onWarning: (message) => warnings.push(message),
    });
    if (rendered.status !== 'rendered') {
        return rendered;
    }
    return {
        status: 'rendered',
        subject: {
            soloActive: resolution.soloActive,
            rangeSeconds: capture.rangeSeconds,
            targets: rendered.targets,
            warnings,
        },
    };
}

/** Retain every render of both documents; a render too large to retain is reported by each subject holding it. */
function retainRenders(input: RenderAgentPreviewMeasurementScopeInput, subjects: readonly RenderedSubject[]): void {
    const renders = subjects.flatMap((subject) =>
        subject.targets.map((target) => ({ contentAddress: target.artifact.contentAddress, buffer: target.buffer }))
    );
    const oversized = new Set(retainAgentMeasurementArtifacts({ renders, sourceRevision: input.sourceRevision }));
    for (const subject of subjects) {
        for (const target of subject.targets) {
            if (oversized.has(target.artifact.contentAddress)) {
                subject.warnings.push(
                    `Render ${target.artifact.contentAddress} exceeds the measurement retention limit and was not retained.`
                );
            }
        }
    }
}

/**
 * Render one agent measurement scope twice over the same beat range — the
 * live project at the preview's base revision, then the isolated preview of a
 * proposal — and retain both as content-addressed artifacts.
 *
 * Every store read either render needs is taken before anything renders, the
 * preview's through its workspace, which is released before the first render
 * starts. The preview therefore renders from a detached copy of its document:
 * nothing it does can reach the live document or stores, and no preview stays
 * active across the asynchronous renders. Ranges are converted to seconds
 * through each document's own tempo map. A preview device the render cannot
 * carry from the preview's own data refuses the comparison rather than
 * rendering something else. Both renders are bound to the base revision: once
 * the live project leaves it, the comparison refuses as a whole and retains
 * nothing.
 */
export async function renderAgentPreviewMeasurementScope(
    input: RenderAgentPreviewMeasurementScopeInput
): Promise<RenderAgentPreviewMeasurementScopeResult> {
    const captured = captureComparison(input);
    if (captured.status !== 'captured') {
        return captured;
    }
    const baselineTargets = refuseSubject('baseline', captured.baseline, input.rangeCeilings);
    if (baselineTargets.status === 'refused') {
        return baselineTargets;
    }
    const previewTargets = refuseSubject('preview', captured.preview, input.rangeCeilings);
    if (previewTargets.status === 'refused') {
        return previewTargets;
    }
    const deviceRefusal = refusePreviewDevices(previewTargets, captured);
    if (deviceRefusal !== null) {
        return deviceRefusal;
    }
    if (input.scope.kind === 'master' && isExportActive()) {
        return refused('render-busy', null);
    }
    const baseline = await renderSubject(input, captured.baseline, baselineTargets, undefined);
    if (baseline.status !== 'rendered') {
        return subjectRefusal(baseline, 'baseline');
    }
    const preview = await renderSubject(input, captured.preview, previewTargets, captured.project);
    if (preview.status !== 'rendered') {
        return subjectRefusal(preview, 'preview');
    }
    retainRenders(input, [baseline.subject, preview.subject]);
    return { status: 'rendered', baseline: baseline.subject, preview: preview.subject };
}
