import { resolveMarkerColorValue } from '#/utils/markerColorPalette';

import { type RuntimeAction } from '../../models/RuntimeAction';
import { normalizeSafeProjectName } from '../../validators/normalizeSafeProjectName';

import {
    type LlmActionRejection,
    type MarkerPlanningSignature,
    type SectionPlanningSignature,
} from '../llmActionBridge';
import { type ToolCallResult } from '../toolCallParser';
import { createLlmActionStrategyRegistry, type LlmActionStrategyDefinition } from './createLlmActionStrategyRegistry';

export const markerSectionActionNames = [
    'addMarker',
    'removeMarker',
    'setMarkerColor',
    'addSection',
    'removeSection',
    'renameSection',
] as const;

export type MarkerSectionCallName = (typeof markerSectionActionNames)[number];

type MarkerSectionStrategyInput = {
    call: ToolCallResult;
    index: number;
    markerSignatures: readonly MarkerPlanningSignature[];
    sectionSignatures: readonly SectionPlanningSignature[];
};

type MarkerSectionStrategy<Name extends MarkerSectionCallName> = (
    input: MarkerSectionStrategyInput
) => Extract<RuntimeAction, { type: Name }> | LlmActionRejection;

type MarkerSectionStrategyDefinition<Name extends MarkerSectionCallName> = {
    [StrategyName in Name]: {
        name: StrategyName;
        transform: MarkerSectionStrategy<StrategyName>;
    };
}[Name];

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
    const actualKeys = Object.keys(value);
    return actualKeys.length === expectedKeys.length && expectedKeys.every((key) => Object.hasOwn(value, key));
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function normalizeMarkerName(name: string): string {
    return name.trim().toLocaleLowerCase();
}

function rejection(index: number, name: string, reason: string): LlmActionRejection {
    return { index, name, reason };
}

const markerSectionStrategyDefinitions = [
    {
        name: 'addMarker',
        transform: ({ call, index, markerSignatures }) => {
            const args = call.arguments;
            const name = normalizeSafeProjectName(args.name);
            if (!hasExactKeys(args, ['beat', 'name']) || !isFiniteNumber(args.beat) || args.beat < 0 || !name) {
                return rejection(
                    index,
                    call.name,
                    'Expected only a nonnegative finite beat and a safe explicit marker name'
                );
            }
            const alreadyExists = markerSignatures.some(
                (marker) => marker.beat === args.beat && normalizeMarkerName(marker.name) === normalizeMarkerName(name)
            );
            if (alreadyExists) {
                return rejection(index, call.name, 'Requested marker already exists at that beat');
            }
            return { type: 'addMarker', payload: { beat: args.beat, name } };
        },
    },
    {
        name: 'removeMarker',
        transform: ({ call, index, markerSignatures }) => {
            const args = call.arguments;
            const name = normalizeSafeProjectName(args.name);
            if (!hasExactKeys(args, ['beat', 'name']) || !isFiniteNumber(args.beat) || args.beat < 0 || !name) {
                return rejection(
                    index,
                    call.name,
                    'Expected only a nonnegative finite beat and a safe explicit marker name'
                );
            }
            const matches = markerSignatures.filter(
                (marker) =>
                    marker.markerId !== undefined &&
                    marker.beat === args.beat &&
                    normalizeMarkerName(marker.name) === normalizeMarkerName(name)
            );
            const match = matches[0];
            if (matches.length !== 1 || match?.markerId === undefined) {
                return rejection(index, call.name, 'Requested marker does not resolve to exactly one local marker');
            }
            return { type: 'removeMarker', payload: { markerId: match.markerId } };
        },
    },
    {
        name: 'setMarkerColor',
        transform: ({ call, index, markerSignatures }) => {
            const args = call.arguments;
            const name = normalizeSafeProjectName(args.name);
            const color = typeof args.color === 'string' ? resolveMarkerColorValue(args.color) : null;
            if (
                !hasExactKeys(args, ['beat', 'name', 'color']) ||
                !isFiniteNumber(args.beat) ||
                args.beat < 0 ||
                !name ||
                color === null
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected only a nonnegative finite beat, a safe explicit marker name, and a named marker palette color'
                );
            }
            const matches = markerSignatures.filter(
                (marker) =>
                    marker.markerId !== undefined &&
                    marker.beat === args.beat &&
                    normalizeMarkerName(marker.name) === normalizeMarkerName(name)
            );
            const match = matches[0];
            if (matches.length !== 1 || match?.markerId === undefined) {
                return rejection(index, call.name, 'Requested marker does not resolve to exactly one local marker');
            }
            if (match.color === color) {
                return rejection(index, call.name, 'Requested marker already has that color');
            }
            return { type: 'setMarkerColor', payload: { markerId: match.markerId, color } };
        },
    },
    {
        name: 'addSection',
        transform: ({ call, index, sectionSignatures }) => {
            const args = call.arguments;
            const name = normalizeSafeProjectName(args.name);
            if (
                !hasExactKeys(args, ['startBeat', 'endBeat', 'name']) ||
                !isFiniteNumber(args.startBeat) ||
                !isFiniteNumber(args.endBeat) ||
                args.startBeat < 0 ||
                args.endBeat <= args.startBeat ||
                !name
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected only a valid finite beat range and a safe explicit section name'
                );
            }
            const alreadyExists = sectionSignatures.some(
                (section) =>
                    section.startBeat === args.startBeat &&
                    section.endBeat === args.endBeat &&
                    normalizeMarkerName(section.name) === normalizeMarkerName(name)
            );
            if (alreadyExists) {
                return rejection(index, call.name, 'Requested section already exists at that range');
            }
            return { type: 'addSection', payload: { startBeat: args.startBeat, endBeat: args.endBeat, name } };
        },
    },
    {
        name: 'removeSection',
        transform: ({ call, index, sectionSignatures }) => {
            const args = call.arguments;
            const name = normalizeSafeProjectName(args.name);
            if (
                !hasExactKeys(args, ['startBeat', 'endBeat', 'name']) ||
                !isFiniteNumber(args.startBeat) ||
                !isFiniteNumber(args.endBeat) ||
                args.startBeat < 0 ||
                args.endBeat <= args.startBeat ||
                !name
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected only one exact section range and label plus a changed safe replacement label when renaming'
                );
            }
            const matches = sectionSignatures.filter(
                (section) =>
                    section.sectionId !== undefined &&
                    section.startBeat === args.startBeat &&
                    section.endBeat === args.endBeat &&
                    normalizeMarkerName(section.name) === normalizeMarkerName(name)
            );
            const match = matches[0];
            if (matches.length !== 1 || match?.sectionId === undefined) {
                return rejection(index, call.name, 'Requested section does not resolve to exactly one local section');
            }
            return { type: 'removeSection', payload: { sectionId: match.sectionId } };
        },
    },
    {
        name: 'renameSection',
        transform: ({ call, index, sectionSignatures }) => {
            const args = call.arguments;
            const name = normalizeSafeProjectName(args.name);
            const newName = normalizeSafeProjectName(args.newName);
            if (
                !hasExactKeys(args, ['startBeat', 'endBeat', 'name', 'newName']) ||
                !isFiniteNumber(args.startBeat) ||
                !isFiniteNumber(args.endBeat) ||
                args.startBeat < 0 ||
                args.endBeat <= args.startBeat ||
                !name ||
                !newName ||
                normalizeMarkerName(newName) === normalizeMarkerName(name)
            ) {
                return rejection(
                    index,
                    call.name,
                    'Expected only one exact section range and label plus a changed safe replacement label when renaming'
                );
            }
            const matches = sectionSignatures.filter(
                (section) =>
                    section.sectionId !== undefined &&
                    section.startBeat === args.startBeat &&
                    section.endBeat === args.endBeat &&
                    normalizeMarkerName(section.name) === normalizeMarkerName(name)
            );
            const match = matches[0];
            if (matches.length !== 1 || match?.sectionId === undefined) {
                return rejection(index, call.name, 'Requested section does not resolve to exactly one local section');
            }
            const destinationExists = sectionSignatures.some(
                (section) =>
                    section.sectionId !== match.sectionId &&
                    section.startBeat === match.startBeat &&
                    section.endBeat === match.endBeat &&
                    normalizeMarkerName(section.name) === normalizeMarkerName(newName)
            );
            if (destinationExists) {
                return rejection(index, call.name, 'Replacement section label already exists at that range');
            }
            return { type: 'renameSection', payload: { sectionId: match.sectionId, name: newName } };
        },
    },
] as const satisfies readonly MarkerSectionStrategyDefinition<MarkerSectionCallName>[];

const markerSectionStrategyRegistry = createLlmActionStrategyRegistry<
    MarkerSectionCallName,
    MarkerSectionStrategyInput,
    RuntimeAction | LlmActionRejection
>(markerSectionStrategyDefinitions, markerSectionActionNames);

function isMarkerSectionCallName(value: string): value is MarkerSectionCallName {
    return markerSectionActionNames.some((actionName) => actionName === value);
}

export function bridgeMarkerSectionToolCall(
    input: MarkerSectionStrategyInput
): RuntimeAction | LlmActionRejection | null {
    if (!isMarkerSectionCallName(input.call.name)) {
        return null;
    }
    const strategy = markerSectionStrategyRegistry.get(input.call.name);
    if (!strategy) {
        throw new Error(`Missing LLM action strategy: ${input.call.name}`);
    }
    return strategy(input);
}
