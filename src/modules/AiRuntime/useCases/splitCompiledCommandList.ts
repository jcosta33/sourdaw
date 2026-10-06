import { getExecutableAppActionGroundingRules } from '#/modules/Command/useCases';

import {
    type ArbitraryCommandListEvidence,
    type ArbitraryCommandListSelectorEvidence,
    type ArbitraryCommandListSetSelector,
} from './compileArbitraryCommandList';

type CompiledItem = ArbitraryCommandListEvidence['items'][number];

/** The smallest run of one item's commands a batch boundary may fall around. */
type SplitUnit = {
    itemIndex: number;
    commandIndexes: number[];
    /** Positions in the item's declared commands, deduplicated repetitions included, this unit carries. */
    declaredPositions: number[];
    /** The set members this unit carries; empty for a unit that carries its whole item. */
    targetIds: string[];
};

/** Consecutive units no batch boundary may fall inside, because a binding links the first to the last. */
type SplitSegment = { units: SplitUnit[]; commandCount: number; binding: string | null };

type SplitCompiledCommandListResult =
    { status: 'accepted'; slices: ArbitraryCommandListEvidence[] } | { status: 'rejected'; reason: string };

function rangeOf(item: CompiledItem): number[] {
    return Array.from({ length: item.commandCount }, (_unused, offset) => item.commandStart + offset);
}

function sharesCommandsAcrossItems(item: CompiledItem): boolean {
    return item.representativeCommandIndexes.some(
        (index) => index < item.commandStart || index >= item.commandStart + item.commandCount
    );
}

function refuseUnsplittable(evidence: ArbitraryCommandListEvidence): string | null {
    if (evidence.creativeAuthorityId !== null) {
        return 'A creative interpretation cannot run as successive batches.';
    }
    if (evidence.expandedMidiTransforms.length > 0) {
        return 'A MIDI transform cannot run as successive batches.';
    }
    if (evidence.items.some(sharesCommandsAcrossItems)) {
        return 'Commands shared between list items cannot run as successive batches.';
    }
    return null;
}

/**
 * A one-cardinality selector item compiles one command run per set member, so each member is its own
 * unit. A `many` item writes its whole set in one command, and an item without a selector has no set,
 * so either stays whole.
 */
function buildItemUnits(item: CompiledItem, itemIndex: number, hasSelector: boolean): SplitUnit[] {
    const commandIndexes = rangeOf(item);
    if (!hasSelector || item.targetCardinality === 'many') {
        return [
            {
                itemIndex,
                commandIndexes,
                declaredPositions: item.representativeCommandIndexes.map((_index, position) => position),
                targetIds: [],
            },
        ];
    }
    return item.stableIds.map((targetId) => {
        const unitCommands = commandIndexes.filter(
            (commandIndex) => item.canonicalStableIds[commandIndex - item.commandStart] === targetId
        );
        return {
            itemIndex,
            commandIndexes: unitCommands,
            declaredPositions: item.representativeCommandIndexes.flatMap((index, position) =>
                unitCommands.includes(index) ? [position] : []
            ),
            targetIds: [targetId],
        };
    });
}

function collectBindingReferences(value: unknown, bindings: ReadonlySet<string>, found: Set<string>): void {
    if (typeof value === 'string') {
        if (value.startsWith('$') && bindings.has(value.slice(1))) {
            found.add(value.slice(1));
        }
        return;
    }
    for (const entry of childValues(value)) {
        collectBindingReferences(entry, bindings, found);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The nested values an argument holds: an array's entries or an object's property values. */
function childValues(value: unknown): readonly unknown[] {
    if (Array.isArray(value)) {
        return value;
    }
    if (isRecord(value)) {
        return Object.values(value);
    }
    return [];
}

/** Each binding's producing unit, keyed by binding name. */
function findBindingProducers(
    evidence: ArbitraryCommandListEvidence,
    units: readonly SplitUnit[]
): Map<string, number> {
    const producers = new Map<string, number>();
    for (const [unitIndex, unit] of units.entries()) {
        for (const commandIndex of unit.commandIndexes) {
            const binding = evidence.commands[commandIndex]?.arguments.binding;
            if (typeof binding === 'string') {
                producers.set(binding, unitIndex);
            }
        }
    }
    return producers;
}

/** How far each binding producer's span reaches: the last unit naming the binding it declares. */
function measureBindingSpans(evidence: ArbitraryCommandListEvidence, units: readonly SplitUnit[]) {
    const producers = findBindingProducers(evidence, units);
    const bindingNames = new Set(producers.keys());
    const spanEnd = units.map((_unit, unitIndex) => unitIndex);
    const spanBinding: Array<string | null> = units.map(() => null);
    for (const [unitIndex, unit] of units.entries()) {
        const referenced = new Set<string>();
        for (const commandIndex of unit.commandIndexes) {
            collectBindingReferences(evidence.commands[commandIndex]?.arguments, bindingNames, referenced);
        }
        for (const binding of referenced) {
            const producerIndex = producers.get(binding) ?? unitIndex;
            if (producerIndex < unitIndex && spanEnd[producerIndex]! < unitIndex) {
                spanEnd[producerIndex] = unitIndex;
                spanBinding[producerIndex] ??= binding;
            }
        }
    }
    return { spanEnd, spanBinding };
}

/**
 * A binding names an object its producer creates in the same batch, so the producer, every command
 * that names the binding, and everything ordered between them must land in one batch.
 */
function buildSegments(evidence: ArbitraryCommandListEvidence, units: readonly SplitUnit[]): SplitSegment[] {
    const { spanEnd, spanBinding } = measureBindingSpans(evidence, units);
    const segments: SplitSegment[] = [];
    let start = 0;
    while (start < units.length) {
        let end = spanEnd[start]!;
        let binding = spanBinding[start] ?? null;
        for (let cursor = start + 1; cursor <= end; cursor += 1) {
            end = Math.max(end, spanEnd[cursor]!);
            binding ??= spanBinding[cursor] ?? null;
        }
        const segmentUnits = units.slice(start, end + 1);
        segments.push({
            units: segmentUnits,
            commandCount: segmentUnits.reduce((total, unit) => total + unit.commandIndexes.length, 0),
            binding,
        });
        start = end + 1;
    }
    return segments;
}

function packSegments(segments: readonly SplitSegment[], maxCommandsPerBatch: number): SplitUnit[][] | string {
    const slices: SplitUnit[][] = [];
    let current: SplitUnit[] = [];
    let count = 0;
    for (const segment of segments) {
        if (segment.commandCount > maxCommandsPerBatch) {
            return segment.binding === null
                ? `One list item expands past one batch of ${String(maxCommandsPerBatch)} commands.`
                : `Batch-local binding $${segment.binding} and the commands that use it exceed one batch of ${String(maxCommandsPerBatch)} commands.`;
        }
        if (count + segment.commandCount > maxCommandsPerBatch && current.length > 0) {
            slices.push(current);
            current = [];
            count = 0;
        }
        current.push(...segment.units);
        count += segment.commandCount;
    }
    if (current.length > 0) {
        slices.push(current);
    }
    return slices;
}

/** The units of one slice, gathered per item in list order. */
function groupUnitsByItem(units: readonly SplitUnit[]): SplitUnit[][] {
    const groups: SplitUnit[][] = [];
    for (const unit of units) {
        const last = groups.at(-1);
        if (last?.[0]?.itemIndex === unit.itemIndex) {
            last.push(unit);
        } else {
            groups.push([unit]);
        }
    }
    return groups;
}

function sliceSelector(
    selector: ArbitraryCommandListSelectorEvidence,
    targetIds: readonly string[],
    setSelector: ArbitraryCommandListSetSelector | undefined
): ArbitraryCommandListSelectorEvidence | string {
    if (setSelector === undefined) {
        return `Bulk selector ${selector.itemId} cannot be replayed across successive batches.`;
    }
    const carried = new Set(targetIds);
    return {
        ...structuredClone(selector),
        stableIds: [...targetIds],
        preconditions: selector.preconditions.filter((precondition) => carried.has(precondition.stableId)),
        slice: {
            setStableIds: [...selector.stableIds],
            offset: selector.stableIds.indexOf(targetIds[0] ?? ''),
            selector: structuredClone(setSelector.selector),
        },
    };
}

type SliceBuilder = {
    commands: ArbitraryCommandListEvidence['commands'];
    items: CompiledItem[];
    selectors: ArbitraryCommandListSelectorEvidence[];
};

/** The set members a group of units carries: the whole item's for whole-item units, else its own subset. */
function carriedTargets(item: CompiledItem, group: readonly SplitUnit[], commandIndexes: readonly number[]) {
    if (group.every((unit) => unit.targetIds.length === 0)) {
        return { stableIds: [...item.stableIds], canonicalStableIds: [...item.canonicalStableIds] };
    }
    return {
        stableIds: group.flatMap((unit) => unit.targetIds),
        canonicalStableIds: commandIndexes.map((original) => item.canonicalStableIds[original - item.commandStart]!),
    };
}

/** Re-anchors one item's carried commands at the slice's own command cursor. */
function rebaseItem(item: CompiledItem, group: readonly SplitUnit[], builder: SliceBuilder): CompiledItem {
    const commandStart = builder.commands.length;
    const commandIndexes = group.flatMap((unit) => unit.commandIndexes);
    const newIndexByOriginal = new Map(commandIndexes.map((original, offset) => [original, commandStart + offset]));
    const positions = group.flatMap((unit) => unit.declaredPositions).sort((left, right) => left - right);
    const itemIds = new Set(builder.items.map((entry) => entry.itemId));
    return {
        ...structuredClone(item),
        dependsOn: item.dependsOn.filter((dependency) => itemIds.has(dependency)),
        commandStart,
        commandCount: commandIndexes.length,
        declaredCommandCount: positions.length,
        omittedCommandCount: positions.length - commandIndexes.length,
        declaredCommandIdentities: positions.map((position) => item.declaredCommandIdentities[position]!),
        representativeCommandIndexes: positions.map((position) =>
            newIndexByOriginal.get(item.representativeCommandIndexes[position]!)!
        ),
        ...carriedTargets(item, group, commandIndexes),
    };
}

function getRuleStableIds(item: CompiledItem, argument: string): readonly string[] {
    if (argument === item.targetArgument) {
        return item.stableIds;
    }
    return item.directTargets?.find((target) => target.argument === argument)?.stableIds ?? [];
}

/** The direct targets the slice's commands carry, derived the way the evidence validator derives them. */
function deriveProviderKnownTargetIds(
    items: readonly CompiledItem[],
    selectors: readonly ArbitraryCommandListSelectorEvidence[]
): string[] {
    const selectorItemIds = new Set(selectors.map((selector) => selector.itemId));
    const targetIds: string[] = [];
    for (const item of items) {
        if (!selectorItemIds.has(item.itemId)) {
            continue;
        }
        for (const rule of getExecutableAppActionGroundingRules(item.commandName)?.targetRules ?? []) {
            const stableIds = getRuleStableIds(item, rule.argument);
            targetIds.push(...stableIds.filter((stableId) => !targetIds.includes(stableId)));
        }
    }
    return targetIds;
}

/** An item split across batches records its slice of the set; an item carried whole keeps its selector. */
function sliceItemSelector(input: {
    selector: ArbitraryCommandListSelectorEvidence;
    targetIds: readonly string[];
    isSplit: boolean;
    setSelectors: readonly ArbitraryCommandListSetSelector[];
}): ArbitraryCommandListSelectorEvidence | string {
    if (!input.isSplit) {
        return structuredClone(input.selector);
    }
    const setSelector = input.setSelectors.find((candidate) => candidate.itemId === input.selector.itemId);
    return sliceSelector(input.selector, input.targetIds, setSelector);
}

function buildSliceEvidence(input: {
    evidence: ArbitraryCommandListEvidence;
    units: readonly SplitUnit[];
    splitItemIndexes: ReadonlySet<number>;
    setSelectors: readonly ArbitraryCommandListSetSelector[];
}): ArbitraryCommandListEvidence | string {
    const builder: SliceBuilder = { commands: [], items: [], selectors: [] };
    for (const group of groupUnitsByItem(input.units)) {
        const itemIndex = group[0]!.itemIndex;
        const item = input.evidence.items[itemIndex]!;
        const rebased = rebaseItem(item, group, builder);
        builder.commands.push(
            ...group.flatMap((unit) => unit.commandIndexes.map((index) => input.evidence.commands[index]!))
        );
        builder.items.push(rebased);
        const selector = input.evidence.selectors.find((candidate) => candidate.itemId === item.itemId);
        if (selector === undefined) {
            continue;
        }
        const sliced = sliceItemSelector({
            selector,
            targetIds: rebased.stableIds,
            isSplit: input.splitItemIndexes.has(itemIndex),
            setSelectors: input.setSelectors,
        });
        if (typeof sliced === 'string') {
            return sliced;
        }
        builder.selectors.push(sliced);
    }
    return {
        ...structuredClone(input.evidence),
        providerKnownTargetIds: deriveProviderKnownTargetIds(builder.items, builder.selectors),
        selectors: builder.selectors,
        items: builder.items,
        commands: structuredClone(builder.commands),
    };
}

function findSplitItemIndexes(slices: readonly SplitUnit[][]): Set<number> {
    const sliceCountByItem = new Map<number, Set<number>>();
    for (const [sliceIndex, units] of slices.entries()) {
        for (const unit of units) {
            const seen = sliceCountByItem.get(unit.itemIndex) ?? new Set<number>();
            seen.add(sliceIndex);
            sliceCountByItem.set(unit.itemIndex, seen);
        }
    }
    return new Set([...sliceCountByItem].flatMap(([itemIndex, seen]) => (seen.size > 1 ? [itemIndex] : [])));
}

/**
 * Splits one compiled list into the successive batches a run proposes one approval at a time. A list
 * that fits one batch comes back as itself, untouched. A larger one is cut only between set members
 * or whole items, never inside a binding's producer-to-consumer span, and packed greedily in list
 * order; every slice is evidence the ordinary validator accepts on its own, and a slice that carries
 * part of a set records where it sits in that set so a later replay can tell the members earlier
 * batches changed from members the project gained or lost.
 */
export function splitCompiledCommandList(input: {
    evidence: ArbitraryCommandListEvidence;
    maxCommandsPerBatch: number;
    setSelectors?: readonly ArbitraryCommandListSetSelector[];
}): SplitCompiledCommandListResult {
    const { evidence } = input;
    if (evidence.commands.length <= input.maxCommandsPerBatch) {
        return { status: 'accepted', slices: [evidence] };
    }
    const refusal = refuseUnsplittable(evidence);
    if (refusal !== null) {
        return { status: 'rejected', reason: refusal };
    }
    const selectorItemIds = new Set(evidence.selectors.map((selector) => selector.itemId));
    const units = evidence.items.flatMap((item, itemIndex) =>
        buildItemUnits(item, itemIndex, selectorItemIds.has(item.itemId))
    );
    const packed = packSegments(buildSegments(evidence, units), input.maxCommandsPerBatch);
    if (typeof packed === 'string') {
        return { status: 'rejected', reason: packed };
    }
    const splitItemIndexes = findSplitItemIndexes(packed);
    const slices: ArbitraryCommandListEvidence[] = [];
    for (const sliceUnits of packed) {
        const slice = buildSliceEvidence({
            evidence,
            units: sliceUnits,
            splitItemIndexes,
            setSelectors: input.setSelectors ?? [],
        });
        if (typeof slice === 'string') {
            return { status: 'rejected', reason: slice };
        }
        slices.push(slice);
    }
    return { status: 'accepted', slices };
}
