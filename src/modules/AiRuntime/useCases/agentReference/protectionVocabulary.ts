import { getMixRecipeCatalog, getPlatformPlugins } from '#/modules/Arrangement/useCases';

import { devicePresets } from '../../models/PresetActions/Presets/Device';
import { type ProjectContext } from '../../models/ProjectContext';

import { refinementRequestReading } from './refinementRequestReading';

/** The vocabulary a protection reading tells an object's name from: what is no object. */

export const CONNECTIVE_WORDS: ReadonlySet<string> = new Set([
    'the',
    'a',
    'an',
    'of',
    'and',
    'or',
    'both',
    'my',
    'your',
    'our',
    'in',
    'on',
    'at',
    'to',
    'for',
    'from',
    'by',
    'with',
    'into',
    'than',
]);
export const CONTROL_WORDS: ReadonlySet<string> = new Set([
    'pan',
    'panning',
    'solo',
    'mute',
    'fader',
    'gain',
    'level',
    'volume',
    'arm',
    'send',
    'routing',
    'output',
    'setting',
]);
export const SEND_ACTIONS: readonly string[] = ['addSend', 'removeSend', 'setSend'];
/** Nouns that name a kind of object beside a name ("the Keys track", "the compressor"), never an object. */
export const KIND_NOUNS: ReadonlySet<string> = new Set([
    'track',
    'tracks',
    'channel',
    'channels',
    'bus',
    'buses',
    'group',
    'groups',
    'clip',
    'clips',
    'plugin',
    'plugins',
    'device',
    'devices',
    'insert',
    'inserts',
    'return',
    'returns',
    'automation',
    'effect',
    'effects',
    'fx',
]);
/** Capitalized words that name no object: filler, qualities and project-wide terms. */
export const NON_OBJECT_WORDS: ReadonlySet<string> = new Set([
    'please',
    'thanks',
    'thank',
    'you',
    'too',
    'also',
    'either',
    'though',
    'otherwise',
    'now',
    'again',
    'okay',
    'ok',
    'groove',
    'vibe',
    'tone',
    'feel',
    'mix',
    'dynamics',
    'balance',
    'energy',
    'warmth',
    'punch',
    'sound',
    'character',
    'timing',
    'arrangement',
    'structure',
    'song',
    'project',
    'tempo',
    'key',
    'loop',
    'metronome',
    'click',
    'compressor',
    'reverb',
    'delay',
    'master',
    'notes',
    'midi',
    'marker',
    'markers',
    'section',
    'sections',
    'selected',
    'current',
]);

/** A word and its singular, which a plural of any word reads as. */
function wordForms(lower: string): string[] {
    return [lower, lower.replace(/es$/u, ''), lower.replace(/s$/u, '')];
}

function hasWord(words: ReadonlySet<string>, lower: string): boolean {
    return wordForms(lower).some((form) => words.has(form));
}

function splitWords(text: string): string[] {
    return text
        .replaceAll(/([a-z])([A-Z])/gu, '$1 $2')
        .toLocaleLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length > 1);
}

let catalogWords: ReadonlySet<string> | null = null;

/**
 * The words the platform already holds for what is not a project object: what its effects, utilities and
 * analyzers are called, what a request calls a device ("equalizer", "echo"), and what a mix is judged by
 * (the mixing descriptor terms and the measurements a recipe moves). Instruments are left out, so the
 * name of a sound ("Strings") is still a name.
 */
function readCatalogWords(): ReadonlySet<string> {
    if (catalogWords === null) {
        const catalog = getMixRecipeCatalog();
        const sources = [
            ...getPlatformPlugins()
                .filter((plugin) => plugin.category !== 'instrument')
                .flatMap((plugin) => [plugin.id.replace(/^[a-z]+-/u, ''), plugin.name]),
            ...devicePresets.flatMap((preset) => preset.keywords),
            ...Object.values(catalog.descriptorTerms).flat(),
            ...catalog.recipes.flatMap((recipe) =>
                recipe.metrics.flatMap((expectation) => [expectation.metric, expectation.band ?? ''])
            ),
        ];
        catalogWords = new Set(sources.flatMap(splitWords));
    }
    return catalogWords;
}

/** The words the project itself holds for kinds of device: the types it offers and the ones on its tracks. */
function readProjectDeviceWords(context: ProjectContext): ReadonlySet<string> {
    const devices = context.tracks.flatMap((track) => track.devices);
    return new Set(
        [
            ...(context.availableDeviceTypes ?? []).flatMap((type) => [type.id, type.name]),
            ...devices.flatMap((device) => [device.type, device.name ?? '']),
        ].flatMap(splitWords)
    );
}

/** The action types a control word names, or undefined when it names none, which makes it the whole track. */
function readControlActions(control: string): readonly string[] | undefined {
    const singular = wordForms(control).find((form) => CONTROL_WORDS.has(form));
    if (singular === 'send') {
        return SEND_ACTIONS;
    }
    return refinementRequestReading.operationActions[singular ?? control];
}

/** Whether a word names a device type or a mixing quality the platform already holds, or one the project's devices do. */
function isKnownMixWord(lower: string, projectWords: ReadonlySet<string>): boolean {
    return hasWord(readCatalogWords(), lower) || hasWord(projectWords, lower);
}

export const protectionVocabulary = {
    wordForms,
    hasWord,
    readProjectDeviceWords,
    readControlActions,
    isKnownMixWord,
} as const;
