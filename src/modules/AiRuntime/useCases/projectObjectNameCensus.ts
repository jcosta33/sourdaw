import { type ProjectContext, type ProjectContextDevice, type ProjectContextTrack } from '../models/ProjectContext';

import { reservedVcaGroupReferenceWords } from './agentReference/groundingStrategies/maskProjectReferences';
import { normalizePromptText } from './agentReference/groundingStrategies/normalizePromptText';

/** The keys of an object whose value is an array, optional ones included. */
type ArrayKeyOf<Owner> = {
    [Key in keyof Owner]-?: NonNullable<Owner[Key]> extends readonly unknown[] ? Key : never;
}[keyof Owner];

/**
 * How one array of the context is read for the names and ids a request can cite: either the texts to
 * blank, or `notAName` with the reason its texts are the request's own vocabulary or repeat another kind.
 */
type ObjectNameReading<Value> =
    { readonly names: (value: Value, context: ProjectContext) => readonly string[] } | { readonly notAName: string };

/** Every array of `Owner` classified, so a new array field fails the typecheck until it is read here. */
type ObjectNameCensus<Owner> = {
    readonly [Key in ArrayKeyOf<Owner>]: ObjectNameReading<NonNullable<Owner[Key]>>;
};

/**
 * A name that is only its kind's own noun ("Group", "Clip") would blank that noun from the request's words
 * ("group the drums"), so it is never read as a name.
 */
const RESERVED_OBJECT_KIND_WORDS: ReadonlySet<string> = new Set([
    ...reservedVcaGroupReferenceWords,
    'clip',
    'audio',
    'midi',
    'section',
    'marker',
    'layer',
    'adjustment layer',
    'device',
    'track',
]);

function isCitableName(name: string): boolean {
    return !RESERVED_OBJECT_KIND_WORDS.has(normalizePromptText(name));
}

function readNamedObject(object: { id: string; name: string }): string[] {
    if (!isCitableName(object.name)) {
        return [object.id];
    }
    return [object.id, object.name];
}

function readNamedObjects(objects: readonly { id: string; name: string }[]): string[] {
    return objects.flatMap(readNamedObject);
}

/** A device name the app gave from its type ("Compressor") is catalog vocabulary, not a name the user typed. */
function readDeviceNames(device: ProjectContextDevice, context: ProjectContext): string[] {
    const name = device.name;
    if (name === undefined || !isCitableName(name)) {
        return [device.id];
    }
    const catalogName = context.availableDeviceTypes?.find((type) => type.id === device.type)?.name;
    const vocabulary = [device.type, catalogName ?? device.type].map(normalizePromptText);
    if (vocabulary.includes(normalizePromptText(name))) {
        return [device.id];
    }
    return [device.id, name];
}

function readCensusEntry<Value>(
    reading: ObjectNameReading<NonNullable<Value>>,
    value: Value,
    context: ProjectContext
): readonly string[] {
    if ('notAName' in reading || value === undefined || value === null) {
        return [];
    }
    return reading.names(value, context);
}

function readCensus<Owner>(census: ObjectNameCensus<Owner>, owner: Owner, context: ProjectContext): string[] {
    // The census type names exactly these keys, which `Object.keys` cannot state.
    const keys = Object.keys(census) as ArrayKeyOf<Owner>[];
    return keys.flatMap((key) => readCensusEntry(census[key], owner[key], context));
}

const TRACK_OBJECT_NAMES: ObjectNameCensus<ProjectContextTrack> = {
    clips: { names: readNamedObjects },
    devices: { names: (devices, context) => devices.flatMap((device) => readDeviceNames(device, context)) },
    alternativeClipIds: { names: (ids) => ids },
    sends: { notAName: 'a send names its bus by a track id the tracks already read' },
};

function readTrackObjectNames(track: ProjectContextTrack, context: ProjectContext): string[] {
    return readCensus(TRACK_OBJECT_NAMES, track, context);
}

const PROJECT_OBJECT_NAMES: ObjectNameCensus<ProjectContext> = {
    tracks: {
        names: (tracks, context) =>
            tracks.flatMap((track) => [track.name, track.id, ...readTrackObjectNames(track, context)]),
    },
    sections: { names: readNamedObjects },
    markers: { names: readNamedObjects },
    vcaGroups: { names: readNamedObjects },
    adjustmentLayers: { names: readNamedObjects },
    availableDeviceTypes: { notAName: "the device catalog is the app's vocabulary for what a request adds" },
    automationLanes: { notAName: "a lane is named after the parameter it draws, the app's own word" },
    sidechainRoutes: { notAName: 'a route has no name; it joins tracks, devices and parameters read elsewhere' },
    selectedClipIds: { notAName: 'the selection repeats clip ids the tracks already read' },
    glueEligibleClipPairs: { notAName: 'a glue pair repeats clip ids the tracks already read' },
    timeSignature: { notAName: 'the meter is two numbers, not an object' },
};

/** Every name and literal id of an object the request can cite, as the census reads them. */
export function readProjectObjectNames(context: ProjectContext): string[] {
    const names = readCensus(PROJECT_OBJECT_NAMES, context, context).filter((name) => name.trim() !== '');
    return [...new Set(names)];
}
