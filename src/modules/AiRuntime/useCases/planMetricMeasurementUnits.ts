import { readOfflineAdjustmentRenderClass } from '#/modules/AudioEngine/useCases';
import { DEFAULT_TEMPO_BPM, readSecondsAtBeat, tempoMapStore, transportStore } from '#/modules/Transport/stores';

import { readAgentResourceLimits } from '../stores/agentResourceLimitsStore';

import {
    type MeasurementRange as Range,
    type MeasurementRenderGroup,
    type MeasurementRequest as Request,
    type MeasurementScope as Scope,
    type MeasurementUnit,
    type MeasurementUnitRead,
} from './planMetricMeasurementRequests';

function rangeKey(range: Range): string {
    return JSON.stringify([range.startBeat, range.endBeat, range.sectionId]);
}

function measuredSeconds(startBeat: number, endBeat: number): number {
    return readSecondsAtBeat({ beat: endBeat }) - readSecondsAtBeat({ beat: startBeat });
}

type DocumentTimeline = Parameters<typeof readOfflineAdjustmentRenderClass>[0]['timeline'];

/** The tempo and tempo map of the live project, which every unit renders. */
function readLiveTimeline(): DocumentTimeline {
    return { tempo: transportStore.value?.tempo ?? DEFAULT_TEMPO_BPM, changes: tempoMapStore.value?.changes ?? [] };
}

/**
 * Ranges grouped greedily by start, each group one render from beat 0 to its last end in every
 * document the unit reads. Two ranges share a render only when it keeps for each what a render of
 * that range alone would:
 *
 * - the group's span stays within the measured-seconds ceiling. A range that alone passes the
 *   ceiling keeps a group of its own, which the render refuses as it would refuse that range;
 * - in every document the unit renders, every range ends where the render takes the same
 *   adjustment-layer decisions as at the group's end (`readOfflineAdjustmentRenderClass`). A layer
 *   the render classifies over its whole span is constant over a short render and moving over a
 *   long one, and an offline render skips a moving DSP layer, so a render ending past that
 *   threshold would drop a layer a render of the shorter range alone applies. The mixdown walks
 *   that span through the document's own tempo map, so a preview document whose tempo differs
 *   from the live project's can cross a threshold where the live project does not.
 */
function groupRanges(
    reads: readonly MeasurementUnitRead[],
    scope: Scope,
    timelines: readonly DocumentTimeline[]
): MeasurementRenderGroup[] {
    const ceiling = readAgentResourceLimits().measurementMeasuredSeconds;
    const route = scope.kind === 'master' ? 'mixdown' : 'subgraph';
    const renderClass = (endBeat: number) =>
        JSON.stringify(timelines.map((timeline) => readOfflineAdjustmentRenderClass({ endBeat, route, timeline })));
    const ranges = [...new Map(reads.map((read) => [rangeKey(read.range), read.range])).values()].sort(
        (left, right) => left.startBeat - right.startBeat || left.endBeat - right.endBeat
    );
    const groups: (MeasurementRenderGroup & { renderClass: string })[] = [];
    for (const range of ranges) {
        const current = groups.at(-1);
        const rangeClass = renderClass(range.endBeat);
        const endBeat = Math.max(current?.endBeat ?? range.endBeat, range.endBeat);
        if (
            current !== undefined &&
            measuredSeconds(current.startBeat, endBeat) <= ceiling &&
            rangeClass === current.renderClass &&
            renderClass(endBeat) === current.renderClass
        ) {
            current.endBeat = endBeat;
            current.ranges.push(range);
            continue;
        }
        groups.push({ startBeat: range.startBeat, endBeat: range.endBeat, ranges: [range], renderClass: rangeClass });
    }
    return groups.map(({ startBeat, endBeat, ranges: members }) => ({ startBeat, endBeat, ranges: members }));
}

/**
 * The timelines of every document a unit renders: the live project, and for a preview unit each
 * prefix document it reads. Only the mixdown walks its span through a tempo map, so a subgraph
 * unit reads the live project's alone and opens no prefix document to read one.
 */
function unitTimelines(
    scope: Scope,
    prefixes: readonly string[],
    readPrefixTimeline: (prefix: string) => DocumentTimeline
): DocumentTimeline[] {
    if (scope.kind !== 'master') {
        return [readLiveTimeline()];
    }
    return [readLiveTimeline(), ...prefixes.map(readPrefixTimeline)];
}

function scopeTargets(scope: Scope): string[] {
    return scope.kind === 'master' ? ['master'] : scope.ids;
}

function unitScope(kind: Scope['kind'], ids: string[]): Scope {
    return kind === 'master' ? { kind: 'master' } : { kind, ids };
}

/**
 * The units the requests render as. A `project` subject reads the live project: requests whose
 * scope holds the same targets join one unit over all their ranges. A `preview` subject reads the
 * prefix each request names beside the live project: one unit per target, over every prefix and
 * range any request reads it at. Measurement execution and whole-run admission both plan through
 * this, so what is admitted is what renders.
 */
export function planMetricMeasurementUnits(
    input:
        | { requests: readonly Request[]; subject: 'project' }
        | {
              requests: readonly Request[];
              subject: 'preview';
              /** The tempo and tempo map of the document a prefix names, as its preview renders it. */
              readPrefixTimeline: (prefix: string) => DocumentTimeline;
          }
): MeasurementUnit[] {
    const units = new Map<string, { kind: Scope['kind']; ids: string[]; reads: MeasurementUnitRead[] }>();
    const join = (key: string, kind: Scope['kind'], ids: string[], read: MeasurementUnitRead) => {
        const unit = units.get(key) ?? { kind, ids, reads: [] };
        unit.reads.push(read);
        units.set(key, unit);
    };
    for (const [requestIndex, request] of input.requests.entries()) {
        const { scope, range, metrics } = request;
        if (input.subject === 'project') {
            const ids = scope.kind === 'master' ? [] : scope.ids;
            join(JSON.stringify([scope.kind, ids]), scope.kind, ids, { prefix: null, range, metrics, requestIndex });
            continue;
        }
        for (const targetId of scopeTargets(scope)) {
            const ids = scope.kind === 'master' ? [] : [targetId];
            join(JSON.stringify([scope.kind, targetId]), scope.kind, ids, {
                prefix: request.prefix,
                range,
                metrics,
                requestIndex,
            });
        }
    }
    return Array.from(units.values(), ({ kind, ids, reads }) => {
        const scope = unitScope(kind, ids);
        const prefixes = input.subject === 'preview' ? [...new Set(reads.flatMap((read) => read.prefix ?? []))] : [];
        const readPrefixTimeline = input.subject === 'preview' ? input.readPrefixTimeline : readLiveTimeline;
        return {
            subject: input.subject,
            scope,
            prefixes,
            groups: groupRanges(reads, scope, unitTimelines(scope, prefixes, readPrefixTimeline)),
            reads,
        };
    });
}
