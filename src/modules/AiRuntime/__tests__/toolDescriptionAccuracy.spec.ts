import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIDI_TRANSFORM_IMPLEMENTATIONS } from '#/modules/AiGeneration/useCases';
import { getBuiltinPlugins, getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { getAgentMeasurementMetricIds } from '#/modules/AudioAnalysis/useCases';
import { clearMidiTransformRegistry, registerMidiTransforms } from '#/modules/Command/stores';
import {
    getExecutableAppActionToolSchemas,
    getMidiTransformToolSchemas,
    parseDeclarativeTransformDocument,
} from '#/modules/Command/useCases';

import { AGENT_CATALOG_CATEGORIES, AGENT_CATALOG_DISCOVERY_TOOL_NAME } from '../models/AgentToolCatalogNames';
import { type ProjectContext } from '../models/ProjectContext';
import { DAW_TOOL_SCHEMAS, type ToolSchema } from '../models/ToolDefinitions';
import { resolveAutomationLaneTarget } from '../transformers/resolveAutomationLaneTarget';
import { getAgentToolCatalogSchemas } from '../useCases/agentToolCatalog';
import { getAgentToolCatalogEntries } from '../useCases/getAgentToolCatalogEntries';
import { getMidiNoteGenerationToolSchemas } from '../useCases/getMidiNoteGenerationToolSchemas';
import { getPlanningProviderToolSchemas } from '../useCases/getPlanningProviderToolSchemas';
import { getPlanningProviderSchemaContract } from '../useCases/planningProviderSchema';

/**
 * Every description a planner reads cites identifiers: device parameter ids, tool and command names,
 * mixing descriptor terms, catalogue categories, receipt codes. A citation the application no longer
 * recognises misleads the planner in the one place it trusts, so each one must resolve on a live
 * source.
 *
 * What counts as a citation (the extraction rule):
 *  - a backticked token;
 *  - a double-quoted token;
 *  - each item of a "for example ..." or "e.g. ..." list;
 *  - a bare dotted tool name (`analysis.measure`), camelCase name (`setDeviceParameter`), or kebab
 *    token whose first segment starts a live device parameter id (`eq-mid-freq`).
 * Other hyphenated words are prose and are not citations.
 *
 * What a citation resolves against: tool and command names, property names, the schema's own enum
 * values, built-in device ids, names and parameter ids, mixing descriptors, their request terms and
 * roles, measurement metric ids, catalogue categories, and the receipt vocabulary below.
 *
 * Out of scope, by site and for a stated reason, in the tables below: display-name examples, which
 * are user-chosen labels with no catalogue to resolve against; and the transform document
 * description, whose embedded example is checked by the live parser instead.
 */

const DISPLAY_NAME_SITES: ReadonlySet<string> = new Set([
    'addTrack|function.parameters.properties.name.description',
    'createBus|function.parameters.properties.name.description',
    'addSidechainRoute|function.parameters.properties.sourceTrackId.description',
    'addSidechainRoute|function.parameters.properties.targetTrackId.description',
    'addMarker|function.description',
    'addSection|function.description',
    'addSection|function.parameters.properties.name.description',
    'automateParameterRange|function.parameters.properties.range.properties.section.description',
]);

/** Sites whose quoted tokens are automation lane targets, resolved by the live lane-target resolver. */
const LANE_TARGET_SITES: ReadonlySet<string> = new Set([
    'addAutomationLane|function.parameters.properties.parameterId.description',
    'automateParameterRange|function.parameters.properties.parameterId.description',
]);

const TRANSFORM_DOCUMENT_SITE = 'transform.compile|function.parameters.properties.document.description';
const TRANSFORM_EXAMPLE_MARKER = 'Valid complete document JSON text: ';

/**
 * Receipt fields and failure codes a description tells the planner to expect. Each is tied to the
 * tools that cite it, so a rename on either side fails, and to the AiRuntime source that emits it.
 */
const RECEIPT_TERM_CITERS: Readonly<Record<string, readonly string[]>> = {
    callId: ['transform.compile', 'recipe.expand', 'analysis.measure'],
    nextCursor: ['device.factory-manifest.read'],
    'tool-receipt-too-large': ['device.factory-manifest.read'],
    'no-reference-loaded': ['analysis.compareReference'],
};

/**
 * Fields of the project context a description tells the planner to read a bound from. They are
 * context fields, not tool properties, so each must be declared on the context type's source.
 */
const CONTEXT_FIELD_TERMS: readonly string[] = ['minValue', 'maxValue', 'minValueDb', 'maxValueDb'];

const PROBE_IDS: ReadonlyMap<string, string> = new Map([
    ['busId', 'probe-bus'],
    ['deviceId', 'probe-device'],
    ['parameterId', 'probe-parameter'],
]);

type Site = { tool: string; path: string; text: string; schema: ToolSchema };
type CitationRule = 'backtick' | 'quote' | 'example' | 'bare-dotted' | 'bare-camel' | 'bare-kebab';
type Citation = { token: string; rule: CitationRule };
type Vocabulary = {
    toolNames: ReadonlySet<string>;
    propertyNames: ReadonlySet<string>;
    deviceIds: ReadonlySet<string>;
    deviceParameterIds: ReadonlySet<string>;
    deviceParameterPrefixes: ReadonlySet<string>;
    mixingTerms: ReadonlySet<string>;
    metricIds: ReadonlySet<string>;
    catalogCategories: ReadonlySet<string>;
    receiptTerms: ReadonlySet<string>;
    contextFields: ReadonlySet<string>;
};

const projectContextSource: string = Object.values(
    import.meta.glob('../models/ProjectContext.ts', { query: '?raw', import: 'default', eager: true })
).join('\n');

const productionSources: readonly string[] = Object.entries(
    import.meta.glob('../useCases/**/*.ts', { query: '?raw', import: 'default', eager: true })
)
    .filter(([path]) => !path.includes('/__tests__/'))
    .map(([, source]) => source);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function siteKey(site: { tool: string; path: string }): string {
    return `${site.tool}|${site.path}`;
}

function collectSites(schemas: readonly ToolSchema[]): Site[] {
    const sites: Site[] = [];
    const seen = new Set<string>();
    const visit = (node: unknown, path: string, schema: ToolSchema, isPropertyMap: boolean): void => {
        if (Array.isArray(node)) {
            for (const [index, item] of node.entries()) {
                visit(item, `${path}[${String(index)}]`, schema, false);
            }
            return;
        }
        if (!isRecord(node)) {
            return;
        }
        for (const [key, value] of Object.entries(node)) {
            if (key === 'description' && typeof value === 'string' && !isPropertyMap) {
                const dedupeKey = `${schema.function.name}|${path}.description|${value}`;
                if (!seen.has(dedupeKey)) {
                    seen.add(dedupeKey);
                    sites.push({ tool: schema.function.name, path: `${path}.description`, text: value, schema });
                }
                continue;
            }
            visit(value, `${path}.${key}`, schema, key === 'properties');
        }
    };
    for (const schema of schemas) {
        visit(schema.function, 'function', schema, false);
    }
    return sites;
}

function collectPropertyNames(schemas: readonly ToolSchema[]): Set<string> {
    const names = new Set<string>();
    const visit = (node: unknown, isPropertyMap: boolean): void => {
        if (Array.isArray(node)) {
            for (const item of node) {
                visit(item, false);
            }
            return;
        }
        if (!isRecord(node)) {
            return;
        }
        for (const [key, value] of Object.entries(node)) {
            if (isPropertyMap) {
                names.add(key);
            }
            visit(value, key === 'properties');
        }
    };
    for (const schema of schemas) {
        visit(schema.function.parameters, false);
    }
    return names;
}

/** The string values a schema itself enumerates: `enum` members and `const` values at any depth. */
function collectOwnEnumValues(schema: ToolSchema): Set<string> {
    const values = new Set<string>();
    const visit = (node: unknown): void => {
        if (Array.isArray(node)) {
            for (const item of node) {
                visit(item);
            }
            return;
        }
        if (!isRecord(node)) {
            return;
        }
        for (const [key, value] of Object.entries(node)) {
            if (key === 'enum' && Array.isArray(value)) {
                for (const member of value) {
                    if (typeof member === 'string') {
                        values.add(member);
                    }
                }
                continue;
            }
            if (key === 'const' && typeof value === 'string') {
                values.add(value);
                continue;
            }
            visit(value);
        }
    };
    visit(schema.function.parameters);
    return values;
}

/** Every `enum` array under a schema's parameters, keyed by its path. */
function collectEnumerations(schema: ToolSchema): Map<string, readonly unknown[]> {
    const enumerations = new Map<string, readonly unknown[]>();
    const visit = (node: unknown, path: string): void => {
        if (Array.isArray(node)) {
            for (const [index, item] of node.entries()) {
                visit(item, `${path}[${String(index)}]`);
            }
            return;
        }
        if (!isRecord(node)) {
            return;
        }
        for (const [key, value] of Object.entries(node)) {
            if (key === 'enum' && Array.isArray(value)) {
                enumerations.set(path, value);
                continue;
            }
            visit(value, `${path}.${key}`);
        }
    };
    visit(schema.function.parameters, 'parameters');
    return enumerations;
}

function splitExampleItems(segment: string): string[] {
    return segment
        .split(/,|\bor\b|\band\b/)
        .map((item) => item.trim().replaceAll(/^["'`]|["'`]$/g, ''))
        .filter((item) => item.length > 0);
}

/** The documented extraction rule: which tokens of a description are citations. */
function extractCitations(text: string, deviceParameterPrefixes: ReadonlySet<string>): Citation[] {
    const citations: Citation[] = [];
    for (const match of text.matchAll(/`([^`]+)`/g)) {
        citations.push({ token: match[1] ?? '', rule: 'backtick' });
    }
    for (const match of text.matchAll(/"([^"]+)"/g)) {
        citations.push({ token: match[1] ?? '', rule: 'quote' });
    }
    for (const match of text.matchAll(/(?:for example|e\.g\.)\s+(.+?)(?:\)|\.(?:\s|$)|$)/gi)) {
        for (const item of splitExampleItems(match[1] ?? '')) {
            citations.push({ token: item, rule: 'example' });
        }
    }
    for (const match of text.matchAll(/(?<![\w.])[a-z]+(?:\.[a-zA-Z][a-zA-Z-]*)+(?![\w-])/g)) {
        if (match[0] !== 'e.g') {
            citations.push({ token: match[0], rule: 'bare-dotted' });
        }
    }
    for (const match of text.matchAll(/(?<![\w.#$-])[a-z]{2,}(?:[A-Z][a-z0-9]*)+(?!\w)/g)) {
        citations.push({ token: match[0], rule: 'bare-camel' });
    }
    for (const match of text.matchAll(/(?<![\w-])[a-z][a-z0-9]*(?:-[a-z0-9]+)+(?![\w-])/g)) {
        const firstSegment = match[0].split('-')[0] ?? '';
        if (deviceParameterPrefixes.has(firstSegment) || Object.hasOwn(RECEIPT_TERM_CITERS, match[0])) {
            citations.push({ token: match[0], rule: 'bare-kebab' });
        }
    }
    const firstCitationByToken = new Map<string, Citation>();
    for (const citation of citations) {
        if (!firstCitationByToken.has(citation.token)) {
            firstCitationByToken.set(citation.token, citation);
        }
    }
    return [...firstCitationByToken.values()];
}

function createLaneTargetContext(): ProjectContext {
    return {
        tempo: 120,
        timeSignature: [4, 4],
        isPlaying: false,
        isRecording: false,
        isLooping: false,
        loopStart: 0,
        loopEnd: 0,
        punchInEnabled: false,
        punchInBeat: 0,
        punchOutBeat: 0,
        metronomeEnabled: false,
        metronomeVolume: 1,
        masterGain: 1,
        tracks: [
            {
                id: 'probe-track',
                name: 'Probe',
                kind: 'audio',
                muted: false,
                soloed: false,
                soloSafe: false,
                armed: false,
                gain: 1,
                pan: 0,
                automationMode: 'read',
                clipCount: 0,
                deviceCount: 1,
                clips: [],
                devices: [
                    {
                        id: 'probe-device',
                        type: 'builtin-eq',
                        bypassed: false,
                        parameters: [
                            {
                                id: 'probe-parameter',
                                name: 'Probe',
                                type: 'float',
                                value: 0,
                                minValue: 0,
                                maxValue: 1,
                                unit: '',
                            },
                        ],
                    },
                ],
                sends: [{ busId: 'probe-bus', level: 1, preFader: false }],
            },
        ],
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        activeView: 'arrange',
        playheadPosition: 0,
    };
}

function isLiveLaneTarget(token: string): boolean {
    const substituted = token.replaceAll(/<(\w+)>/g, (placeholder, name: string) => PROBE_IDS.get(name) ?? placeholder);
    return resolveAutomationLaneTarget(createLaneTargetContext(), 'probe-track', substituted) !== null;
}

function isDeclaredInProductionSource(term: string): boolean {
    const keyPattern = new RegExp(String.raw`\b${term}\??:`);
    return productionSources.some((source) => source.includes(`'${term}'`) || keyPattern.test(source));
}

function isResolvedCitation(citation: Citation, site: Site, vocabulary: Vocabulary): boolean {
    const { token } = citation;
    if (LANE_TARGET_SITES.has(siteKey(site)) && citation.rule === 'quote') {
        return isLiveLaneTarget(token);
    }
    return (
        /^#[0-9a-fA-F]{6}$/.test(token) ||
        vocabulary.toolNames.has(token) ||
        vocabulary.propertyNames.has(token) ||
        vocabulary.deviceIds.has(token) ||
        vocabulary.deviceParameterIds.has(token) ||
        vocabulary.mixingTerms.has(token) ||
        vocabulary.metricIds.has(token) ||
        vocabulary.catalogCategories.has(token) ||
        vocabulary.receiptTerms.has(token) ||
        vocabulary.contextFields.has(token) ||
        collectOwnEnumValues(site.schema).has(token)
    );
}

/** One line per citation that no live source recognises, naming the tool and the JSON path. */
function findUnresolvedCitations(schemas: readonly ToolSchema[], vocabulary: Vocabulary): string[] {
    const unresolved: string[] = [];
    for (const site of collectSites(schemas)) {
        const key = siteKey(site);
        if (DISPLAY_NAME_SITES.has(key) || key === TRANSFORM_DOCUMENT_SITE) {
            continue;
        }
        for (const citation of extractCitations(site.text, vocabulary.deviceParameterPrefixes)) {
            if (!isResolvedCitation(citation, site, vocabulary)) {
                unresolved.push(`${site.tool} ${site.path} cites "${citation.token}" (${citation.rule})`);
            }
        }
    }
    return unresolved;
}

/** Legacy enumerations that differ from, or have no counterpart in, what the live registry publishes. */
function findLegacyEnumerationDrift(legacy: readonly ToolSchema[], live: readonly ToolSchema[]): string[] {
    const liveByName = new Map(live.map((schema) => [schema.function.name, schema]));
    const drift: string[] = [];
    for (const schema of legacy) {
        const twin = liveByName.get(schema.function.name);
        const twinEnumerations = twin === undefined ? new Map<string, readonly unknown[]>() : collectEnumerations(twin);
        for (const [path, values] of collectEnumerations(schema)) {
            const liveValues = twinEnumerations.get(path);
            if (JSON.stringify(liveValues) !== JSON.stringify(values)) {
                drift.push(
                    `${schema.function.name} ${path}: legacy [${values.join(', ')}] but live ${
                        liveValues === undefined ? 'publishes none' : `[${liveValues.join(', ')}]`
                    }`
                );
            }
        }
    }
    return drift;
}

function isServedCatalogCategory(category: string): boolean {
    const served = AGENT_CATALOG_CATEGORIES.find((candidate) => candidate === category);
    if (served === undefined) {
        return false;
    }
    try {
        getAgentToolCatalogEntries({ category: served, names: ['not-a-published-catalog-name'] });
        return true;
    } catch (error) {
        return error instanceof Error && error.message.startsWith('Catalog entry is unavailable');
    }
}

function withDescription(schema: ToolSchema, replace: (description: string) => string): ToolSchema {
    return { ...schema, function: { ...schema.function, description: replace(schema.function.description) } };
}

function withPropertyDescription(
    schema: ToolSchema,
    property: string,
    replace: (description: string) => string
): ToolSchema {
    const properties = structuredClone(schema.function.parameters.properties);
    const current = properties[property];
    if (!isRecord(current) || typeof current.description !== 'string') {
        throw new Error(`Probe schema has no described property ${property}.`);
    }
    properties[property] = { ...current, description: replace(current.description) };
    return { ...schema, function: { ...schema.function, parameters: { ...schema.function.parameters, properties } } };
}

describe('planner tool description accuracy', () => {
    let legacySchemas: readonly ToolSchema[] = [];
    let liveSchemas: readonly ToolSchema[] = [];
    let publishedSchemas: readonly ToolSchema[] = [];
    let vocabulary: Vocabulary;

    beforeAll(() => {
        clearMidiTransformRegistry();
        registerMidiTransforms(MIDI_TRANSFORM_IMPLEMENTATIONS);
        legacySchemas = DAW_TOOL_SCHEMAS;
        liveSchemas = getExecutableAppActionToolSchemas();
        publishedSchemas = [
            ...getAgentToolCatalogSchemas(),
            ...getPlanningProviderSchemaContract().schemas,
            ...getPlanningProviderToolSchemas(),
            ...liveSchemas,
            ...getMidiTransformToolSchemas(),
            ...getMidiNoteGenerationToolSchemas({ expectedClipId: 'probe-clip' }),
            ...legacySchemas,
        ];
        const plugins = getBuiltinPlugins();
        const recipeCatalog = getMixRecipeCatalog();
        const deviceParameterIdList = plugins.flatMap((plugin) => plugin.parameters.map((parameter) => parameter.id));
        const kebabParameterIds = deviceParameterIdList.filter((id) => id.includes('-'));
        vocabulary = {
            toolNames: new Set(publishedSchemas.map((schema) => schema.function.name)),
            propertyNames: collectPropertyNames(publishedSchemas),
            deviceIds: new Set(plugins.flatMap((plugin) => [plugin.id, plugin.name])),
            deviceParameterIds: new Set(deviceParameterIdList),
            deviceParameterPrefixes: new Set(kebabParameterIds.map((id) => id.split('-')[0] ?? '')),
            mixingTerms: new Set([
                ...recipeCatalog.descriptors,
                ...recipeCatalog.roles,
                ...Object.values(recipeCatalog.descriptorTerms).flat(),
            ]),
            metricIds: new Set(getAgentMeasurementMetricIds()),
            catalogCategories: new Set(AGENT_CATALOG_CATEGORIES),
            receiptTerms: new Set(Object.keys(RECEIPT_TERM_CITERS).filter(isDeclaredInProductionSource)),
            contextFields: new Set(
                CONTEXT_FIELD_TERMS.filter((field) => new RegExp(String.raw`\b${field}\??:`).test(projectContextSource))
            ),
        };
    });

    afterAll(() => {
        clearMidiTransformRegistry();
    });

    it('walks every published planning tool source, so a clean result is not an empty one', () => {
        const names = new Set(publishedSchemas.map((schema) => schema.function.name));
        for (const expected of [
            'agent.catalog.discover',
            'recipe.discover',
            'transform.compile',
            'selectWorkflowCapability',
            'setDeviceParameter',
            'addNotes',
            'transposeNotes',
        ]) {
            expect(names.has(expected), `${expected} is walked`).toBe(true);
        }
        expect(getMidiTransformToolSchemas().length).toBeGreaterThan(0);
        const citedAt = (tool: string, path: string): string[] => {
            const sites = collectSites(publishedSchemas).filter((site) => site.tool === tool && site.path === path);
            const citations = sites.flatMap((site) => extractCitations(site.text, vocabulary.deviceParameterPrefixes));
            return citations.map((citation) => citation.token);
        };
        expect(citedAt('setDeviceParameter', 'function.parameters.properties.paramId.description')).toEqual(
            expect.arrayContaining(['eq-mid-freq', 'comp-ratio', 'rev-mix', 'comp-threshold'])
        );
        expect(citedAt('recipe.discover', 'function.description')).toEqual(
            expect.arrayContaining(['warm', 'brighter', 'less muddy'])
        );
    });

    it('resolves every id or name a published description cites on a live source', () => {
        expect(findUnresolvedCitations(publishedSchemas, vocabulary)).toEqual([]);
    });

    it('keeps each display-name exemption pinned to a description that still has examples', () => {
        const sites = collectSites(publishedSchemas);
        for (const key of DISPLAY_NAME_SITES) {
            const cited = sites.filter(
                (site) =>
                    siteKey(site) === key && extractCitations(site.text, vocabulary.deviceParameterPrefixes).length > 0
            );
            expect(cited.length, `${key} still cites an example`).toBeGreaterThan(0);
        }
    });

    it('names, in the owning tools, every receipt term a description tells the planner to expect', () => {
        const sites = collectSites(publishedSchemas);
        for (const [term, citers] of Object.entries(RECEIPT_TERM_CITERS)) {
            expect(isDeclaredInProductionSource(term), `${term} is emitted by AiRuntime source`).toBe(true);
            for (const citer of citers) {
                const mentioned = sites.some((site) => site.tool === citer && site.text.includes(term));
                expect(mentioned, `${citer} still cites ${term}`).toBe(true);
            }
        }
    });

    it('reports a renamed device parameter id with its tool and JSON path', () => {
        const setDeviceParameter = liveSchemas.find((schema) => schema.function.name === 'setDeviceParameter');
        expect(setDeviceParameter).toBeDefined();
        if (setDeviceParameter === undefined) {
            return;
        }
        const stale = [
            withDescription(setDeviceParameter, (text) => text.replace('eq-mid-freq', 'eq-mid-frequency')),
            withPropertyDescription(setDeviceParameter, 'paramId', (text) =>
                text.replace('eq-mid-freq', 'eq-mid-frequency')
            ),
        ];
        expect(findUnresolvedCitations(stale, vocabulary)).toEqual([
            'setDeviceParameter function.description cites "eq-mid-frequency" (example)',
            'setDeviceParameter function.parameters.properties.paramId.description cites "eq-mid-frequency" (example)',
        ]);
    });

    it('reports a mixing descriptor term the catalogue does not know', () => {
        const recipeDiscover = getAgentToolCatalogSchemas().find(
            (schema) => schema.function.name === 'recipe.discover'
        );
        expect(recipeDiscover).toBeDefined();
        if (recipeDiscover === undefined) {
            return;
        }
        const stale = withDescription(recipeDiscover, (text) => text.replace('less muddy', 'less toasty'));
        expect(findUnresolvedCitations([stale], vocabulary)).toEqual([
            'recipe.discover function.description cites "less toasty" (example)',
        ]);
    });

    it('resolves the transform.compile example document on the live parser and its operations on live commands', () => {
        const site = collectSites(publishedSchemas).find((candidate) => siteKey(candidate) === TRANSFORM_DOCUMENT_SITE);
        expect(site).toBeDefined();
        const exampleStart = site?.text.indexOf(TRANSFORM_EXAMPLE_MARKER) ?? -1;
        expect(exampleStart).toBeGreaterThanOrEqual(0);
        const example: unknown = JSON.parse(site?.text.slice(exampleStart + TRANSFORM_EXAMPLE_MARKER.length) ?? '');
        const parsed = parseDeclarativeTransformDocument(example);
        expect(parsed.status).toBe('accepted');
        if (parsed.status !== 'accepted') {
            return;
        }
        const commandNames = new Set(liveSchemas.map((schema) => schema.function.name));
        const operations: string[] = [];
        const visit = (steps: typeof parsed.document.steps): void => {
            for (const step of steps) {
                if (step.kind === 'each') {
                    visit(step.body);
                } else if (step.kind === 'when') {
                    visit(step.then);
                } else {
                    operations.push(step.operation);
                }
            }
        };
        visit(parsed.document.steps);
        expect(operations.length).toBeGreaterThan(0);
        for (const operation of operations) {
            expect(commandNames.has(operation), `${operation} is a live command`).toBe(true);
        }
    });

    it('offers agent.catalog.discover exactly the categories the catalogue serves', () => {
        const catalogSchema = getAgentToolCatalogSchemas().find(
            (schema) => schema.function.name === AGENT_CATALOG_DISCOVERY_TOOL_NAME
        );
        const category = catalogSchema?.function.parameters.properties.category;
        expect(isRecord(category) ? category.enum : undefined).toEqual([...AGENT_CATALOG_CATEGORIES]);
        const unserved = AGENT_CATALOG_CATEGORIES.filter((candidate) => !isServedCatalogCategory(candidate));
        expect(unserved).toEqual([]);
    });

    it('does not serve a category the catalogue never offered', () => {
        expect(isServedCatalogCategory('command-index')).toBe(false);
        expect(isServedCatalogCategory('retired-category')).toBe(false);
    });

    it('keeps every legacy tool enumeration equal to what the live registry publishes for the same tool', () => {
        expect(findLegacyEnumerationDrift(legacySchemas, liveSchemas)).toEqual([]);
    });

    it('reports a legacy enumeration that has drifted from the live registry', () => {
        const addTrack = legacySchemas.find((schema) => schema.function.name === 'addTrack');
        expect(addTrack).toBeDefined();
        if (addTrack === undefined) {
            return;
        }
        const properties = structuredClone(addTrack.function.parameters.properties);
        properties.kind = { type: 'string', enum: ['audio', 'midi', 'bus', 'folder'] };
        const drifted: ToolSchema = {
            ...addTrack,
            function: { ...addTrack.function, parameters: { ...addTrack.function.parameters, properties } },
        };
        expect(findLegacyEnumerationDrift([drifted], liveSchemas)).toEqual([
            'addTrack parameters.properties.kind: legacy [audio, midi, bus, folder] but live [audio, midi, folder]',
        ]);
    });
});
