import { getFactoryPresets } from '#/modules/Arrangement/useCases';

import { type ProjectContext } from '../models/ProjectContext';

import { findAgentReferenceNameSpans } from './agentReference/findAgentReferenceNameSpans';

type NamedDevice = { name: string; parameterNames: string[] };

function blankSpans(text: string, names: readonly string[]): string {
    const masked = text.split('');
    for (const name of names) {
        for (const span of findAgentReferenceNameSpans(text, name, 'exact', names)) {
            masked.fill(' ', span.start, span.end);
        }
    }
    return masked.join('');
}

function readNamedDevice(device: { name?: string; parameters?: readonly { name: string }[] }): NamedDevice[] {
    if (device.name === undefined || device.name === '') {
        return [];
    }
    return [{ name: device.name, parameterNames: (device.parameters ?? []).map((parameter) => parameter.name) }];
}

function readNamedDevices(context: ProjectContext): NamedDevice[] {
    const projectDevices = context.tracks.flatMap((track) => track.devices);
    const availableDevices = context.availableDeviceTypes ?? [];
    return [...projectDevices, ...availableDevices].flatMap(readNamedDevice);
}

/** Every name of a thing the request can cite: a device, its type, a clip, a marker, a section, a preset. */
function readObjectNames(context: ProjectContext, devices: readonly NamedDevice[]): string[] {
    const names = [
        ...devices.map((device) => device.name),
        ...context.tracks.flatMap((track) => track.clips.map((clip) => clip.name)),
        ...(context.markers ?? []).map((marker) => marker.name),
        ...(context.sections ?? []).map((section) => section.name),
        ...(context.adjustmentLayers ?? []).map((layer) => layer.name),
        ...(context.vcaGroups ?? []).map((group) => group.name),
        ...getFactoryPresets().map((preset) => preset.name),
    ];
    return [...new Set(names.filter((name) => name.trim() !== ''))];
}

/**
 * A parameter name states a control, not a quality, only beside a device that has it: "Set the width of the
 * Stereo Widener to 2" names the Width control, while "Increase the width of the vocal" names no device and
 * stays a claim about sound. The clause is the unit, so a device named in another clause never accounts for it.
 */
function blankDeviceParameterNames(text: string, devices: readonly NamedDevice[], separator: RegExp): string {
    const parts: string[] = [];
    let cursor = 0;
    for (const boundary of text.matchAll(new RegExp(separator.source, `${separator.flags}g`))) {
        parts.push(blankClauseParameterNames(text.slice(cursor, boundary.index), devices), boundary[0]);
        cursor = boundary.index + boundary[0].length;
    }
    parts.push(blankClauseParameterNames(text.slice(cursor), devices));
    return parts.join('');
}

function blankClauseParameterNames(clause: string, devices: readonly NamedDevice[]): string {
    const parameterNames = devices
        .filter((device) => findAgentReferenceNameSpans(clause, device.name, 'exact', [device.name]).length > 0)
        .flatMap((device) => device.parameterNames);
    return blankSpans(clause, parameterNames);
}

/**
 * The request with the names of the project's objects, the catalog's devices and the factory presets blanked, offsets
 * kept, so a word inside a name ("Stereo Widener", "Bright Keys") is never read as the request's own claim.
 */
export function maskProjectObjectNames(text: string, context: ProjectContext, clauseSeparator: RegExp): string {
    const devices = readNamedDevices(context);
    const withoutParameters = blankDeviceParameterNames(text, devices, clauseSeparator);
    return blankSpans(withoutParameters, readObjectNames(context, devices));
}
