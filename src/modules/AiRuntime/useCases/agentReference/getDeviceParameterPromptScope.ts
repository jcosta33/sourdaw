import { type ProjectContext } from '../../models/ProjectContext';

type ContextDevice = ProjectContext['tracks'][number]['devices'][number];
type ContextParameter = NonNullable<ContextDevice['parameters']>[number];

type DeviceParameterPromptAssignment = {
    parameter: ContextParameter;
    value: number;
};

type DeviceParameterPromptScope = {
    assignments: DeviceParameterPromptAssignment[];
    device: ContextDevice;
    protectedParameters: ContextParameter[];
    track: ProjectContext['tracks'][number];
};

function normalizeText(value: string): string {
    return value
        .toLocaleLowerCase()
        .replaceAll(/[^\p{L}\p{N}:+.-]+/gu, ' ')
        .trim();
}

function hasWholePhrase(text: string, phrase: string): boolean {
    return ` ${text} `.includes(` ${phrase} `);
}

function getParameterAliases(parameter: ContextParameter): string[] {
    const aliases = new Set([normalizeText(parameter.name), normalizeText(parameter.id.replace(/^.*-/u, ''))]);
    if (normalizeText(parameter.name) === 'makeup') {
        aliases.add('makeup gain');
    }
    return [...aliases].sort((left, right) => right.length - left.length);
}

function findParameterAlias(text: string, parameter: ContextParameter): string | null {
    return getParameterAliases(parameter).find((alias) => hasWholePhrase(text, alias)) ?? null;
}

function parseRequestedValue(text: string, alias: string, unit: string): number | null {
    const escapedAlias = alias.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const match = new RegExp(`${escapedAlias}\\s+(?:to\\s+)?([+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+))`, 'u').exec(text);
    const numericText = match?.[1];
    if (!numericText) {
        return null;
    }
    const value = Number(numericText);
    if (!Number.isFinite(value)) {
        return null;
    }
    const suffix = text.slice(match.index + match[0].length).trimStart();
    if (unit === 'dB' && !/^db\b/iu.test(suffix)) {
        return null;
    }
    if (unit === ':1' && !/^\s*:1\b/u.test(suffix)) {
        return null;
    }
    return value;
}

function getReferencedTrack(prompt: string, context: ProjectContext) {
    const normalizedPrompt = normalizeText(prompt);
    const matches = context.tracks.filter((track) => hasWholePhrase(normalizedPrompt, normalizeText(track.name)));
    return matches.length === 1 ? matches[0] : null;
}

function getReferencedDevice(prompt: string, track: ProjectContext['tracks'][number]) {
    const normalizedPrompt = normalizeText(prompt);
    const matches = track.devices.filter((device) => {
        const names = [device.name, device.type.replace(/^builtin-/u, '')]
            .filter((name): name is string => typeof name === 'string' && name.length > 0)
            .map(normalizeText);
        return names.some((name) => hasWholePhrase(normalizedPrompt, name));
    });
    return matches.length === 1 ? matches[0] : null;
}

export function getDeviceParameterPromptScope(
    prompt: string,
    context: ProjectContext
): DeviceParameterPromptScope | null {
    const unchangedMatch = /\b(?:leave|leaving|keep|keeping|preserve|preserving)\s+(.+?)\s+unchanged\b/iu.exec(prompt);
    if (!unchangedMatch?.[1]) {
        return null;
    }
    const requestedText = normalizeText(prompt.slice(0, unchangedMatch.index));
    if (!/^(?:please\s+)?(?:set|adjust|change)\b/u.test(requestedText)) {
        return null;
    }
    const protectedText = normalizeText(unchangedMatch[1]);
    const track = getReferencedTrack(prompt, context);
    if (!track || track.frozen === true) {
        return null;
    }
    const device = getReferencedDevice(prompt, track);
    if (!device?.parameters || device.parameters.length === 0) {
        return null;
    }

    const assignments: DeviceParameterPromptAssignment[] = [];
    const protectedParameters: ContextParameter[] = [];
    for (const parameter of device.parameters) {
        const requestedAlias = findParameterAlias(requestedText, parameter);
        if (requestedAlias) {
            const value = parseRequestedValue(requestedText, requestedAlias, parameter.unit);
            if (value === null || value < parameter.minValue || value > parameter.maxValue) {
                return null;
            }
            assignments.push({ parameter, value });
        }
        if (findParameterAlias(protectedText, parameter)) {
            protectedParameters.push(parameter);
        }
    }

    if (assignments.length === 0 || protectedParameters.length === 0) {
        return null;
    }
    const changedIds = new Set(assignments.map(({ parameter }) => parameter.id));
    if (protectedParameters.some((parameter) => changedIds.has(parameter.id))) {
        return null;
    }
    return { assignments, device, protectedParameters, track };
}
