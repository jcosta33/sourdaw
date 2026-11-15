type CompactableTool = {
    type: 'function';
    function: { name: string; description?: string; parameters?: Record<string, unknown> };
};

type SchemaRecord = Record<string, unknown>;

/**
 * Levels of nested `properties` and `items` the local prompt spells out. It must reach the deepest
 * required property, `required` list, enum, const or combinator branch of every planning tool's
 * schema: a node past it keeps only its type, enum and description, and a selector written without
 * its `quantity.unit` is refused. The compaction spec walks each full schema to hold that.
 */
const MAX_SCHEMA_DEPTH = 8;

/**
 * Keywords that annotate a value without telling the model anything the description does not. A
 * description is content, not annotation: a unit, a range or an "exactly one of" rule lives in it,
 * and a handler that admits a value outside it edits the project with no receipt. Every description
 * stays, and every keyword that decides which values validate stays, because the reply is checked
 * against the full schema and a call the compacted text admits but that schema refuses fails the
 * whole provider attempt.
 */
const ANNOTATION_KEYWORDS: ReadonlySet<string> = new Set(['title', 'examples', 'default']);

const COMBINATOR_KEYWORDS: ReadonlySet<string> = new Set(['anyOf', 'oneOf', 'allOf']);

/** A repeated sub-schema shorter than this costs about as much as the reference to it. */
const MIN_DEFINITION_LENGTH = 36;
const MAX_DEFINITIONS = 16;
const DEFINITIONS_KEYWORD = '$defs';

function isRecord(value: unknown): value is SchemaRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collapseSchema(schema: SchemaRecord): SchemaRecord {
    const collapsed: SchemaRecord = {};
    for (const keyword of ['type', 'enum', 'description']) {
        if (schema[keyword] !== undefined) {
            collapsed[keyword] = schema[keyword];
        }
    }
    return collapsed;
}

/**
 * The one `type` that says nothing its sibling does not: a string type on a node whose `enum` lists
 * only strings, because the enum already admits those strings and no other value. Every other type
 * stays. `properties` is ignored for a value that is not an object and `items` for one that is not
 * an array, so an object or array type is what refuses a string where an object belongs.
 */
function isImpliedType(schema: SchemaRecord, keyword: string): boolean {
    return (
        keyword === 'type' &&
        schema.type === 'string' &&
        Array.isArray(schema.enum) &&
        schema.enum.every((value) => typeof value === 'string')
    );
}

function compactSchema(schema: unknown, depth: number): unknown {
    if (!isRecord(schema)) {
        return schema;
    }
    if (depth > MAX_SCHEMA_DEPTH) {
        return collapseSchema(schema);
    }
    const compacted: SchemaRecord = {};
    for (const [keyword, value] of Object.entries(schema)) {
        if (ANNOTATION_KEYWORDS.has(keyword) || isImpliedType(schema, keyword)) {
            continue;
        }
        if (keyword === 'properties' && isRecord(value)) {
            compacted.properties = Object.fromEntries(
                Object.entries(value).map(([name, property]) => [name, compactSchema(property, depth + 1)])
            );
        } else if (keyword === 'items') {
            compacted.items = compactSchema(value, depth + 1);
        } else if (COMBINATOR_KEYWORDS.has(keyword) && Array.isArray(value)) {
            compacted[keyword] = value.map((branch) => compactSchema(branch, depth + 1));
        } else {
            compacted[keyword] = value;
        }
    }
    return compacted;
}

type Occurrences = { count: number; units: Set<number> };

/**
 * The value under `keyword` with each sub-schema in a position the compaction spells out — a
 * property, `items` or a combinator branch — passed through `map`. A `properties` map, an `enum`
 * list or a `const` value is not a schema, so it is never a candidate for a definition.
 */
function mapSubschemaValue(keyword: string, value: unknown, map: (subschema: unknown) => unknown): unknown {
    if (keyword === 'properties' && isRecord(value)) {
        return Object.fromEntries(Object.entries(value).map(([name, property]) => [name, map(property)]));
    }
    if (keyword === 'items' && isRecord(value)) {
        return map(value);
    }
    if (COMBINATOR_KEYWORDS.has(keyword) && Array.isArray(value)) {
        return value.map(map);
    }
    return value;
}

function mapSubschemas(schema: SchemaRecord, map: (subschema: unknown) => unknown): SchemaRecord {
    return Object.fromEntries(
        Object.entries(schema).map(([keyword, value]) => [keyword, mapSubschemaValue(keyword, value, map)])
    );
}

function listSubschemas(schema: SchemaRecord): unknown[] {
    return Object.entries(schema).flatMap(([keyword, value]) => {
        if (keyword === 'properties' && isRecord(value)) {
            return Object.values(value);
        }
        if (keyword === 'items' && isRecord(value)) {
            return [value];
        }
        if (!COMBINATOR_KEYWORDS.has(keyword) || !Array.isArray(value)) {
            return [];
        }
        const branches: unknown[] = value;
        return branches;
    });
}

function countSubschemas(schema: SchemaRecord, unit: number, counts: Map<string, Occurrences>): void {
    for (const subschema of listSubschemas(schema)) {
        countRepeated(subschema, unit, counts);
    }
}

function countRepeated(schema: unknown, unit: number, counts: Map<string, Occurrences>): void {
    if (!isRecord(schema)) {
        return;
    }
    const key = JSON.stringify(schema);
    if (key.length >= MIN_DEFINITION_LENGTH) {
        const occurrences = counts.get(key) ?? { count: 0, units: new Set<number>() };
        occurrences.count += 1;
        occurrences.units.add(unit);
        counts.set(key, occurrences);
    }
    countSubschemas(schema, unit, counts);
}

function replaceRepeated(schema: unknown, key: string, reference: SchemaRecord): unknown {
    if (!isRecord(schema)) {
        return schema;
    }
    if (JSON.stringify(schema) === key) {
        return reference;
    }
    return replaceSubschemas(schema, key, reference);
}

function replaceSubschemas(schema: SchemaRecord, key: string, reference: SchemaRecord): SchemaRecord {
    return mapSubschemas(schema, (subschema) => replaceRepeated(subschema, key, reference));
}

/**
 * Moves sub-schemas repeated in `trees` into named definitions shown once, the way a schema author
 * would, so the repeated text costs a reference each time. The definitions are searched beside the
 * trees, as unit 0, so a repeat inside a definition is defined too. `isEligible` says which repeats
 * the definitions may take, by the units they occur in (tree `i` is unit `i + 1`). It picks the
 * repeat that saves the most, then looks again, because replacing one repeat can expose another.
 * Only byte-identical text is a repeat, so a shape that differs anywhere is never merged.
 */
function defineRepeated(input: {
    trees: readonly SchemaRecord[];
    prefix: string;
    isEligible: (occurrences: Occurrences) => boolean;
}): { trees: SchemaRecord[]; definitions: SchemaRecord } {
    let trees = [...input.trees];
    let definitions: SchemaRecord = {};
    for (let index = 1; index <= MAX_DEFINITIONS; index += 1) {
        const counts = new Map<string, Occurrences>();
        // A tool's whole parameters, or a definition's whole body, is a root and never replaced.
        for (const definition of Object.values(definitions)) {
            if (isRecord(definition)) {
                countSubschemas(definition, 0, counts);
            }
        }
        for (const [treeIndex, tree] of trees.entries()) {
            countSubschemas(tree, treeIndex + 1, counts);
        }
        const name = `${input.prefix}${String(index)}`;
        const reference = { $ref: `#/${DEFINITIONS_KEYWORD}/${name}` };
        const referenceLength = JSON.stringify(reference).length;
        let best: { key: string; saving: number } | null = null;
        for (const [key, occurrences] of counts) {
            const saving = (key.length - referenceLength) * occurrences.count - key.length;
            if (
                occurrences.count >= 2 &&
                saving > 0 &&
                input.isEligible(occurrences) &&
                (best === null || saving > best.saving)
            ) {
                best = { key, saving };
            }
        }
        if (best === null) {
            break;
        }
        const { key } = best;
        trees = trees.map((tree) => replaceSubschemas(tree, key, reference));
        const definition: unknown = JSON.parse(key);
        definitions = {
            ...Object.fromEntries(
                Object.entries(definitions).map(([definitionName, definition]) => [
                    definitionName,
                    isRecord(definition) ? replaceSubschemas(definition, key, reference) : definition,
                ])
            ),
            [name]: definition,
        };
    }
    return { trees, definitions };
}

/** A repeat within one tool is that tool's own definition. */
function defineRepeatedWithinTool(parameters: SchemaRecord): SchemaRecord {
    const { trees, definitions } = defineRepeated({ trees: [parameters], prefix: 'd', isEligible: () => true });
    const tree = trees[0] ?? parameters;
    return Object.keys(definitions).length === 0 ? tree : { ...tree, [DEFINITIONS_KEYWORD]: definitions };
}

function compactParameters(parameters: SchemaRecord): SchemaRecord {
    const compacted = compactSchema(parameters, 0);
    return isRecord(compacted) ? defineRepeatedWithinTool(compacted) : parameters;
}

/**
 * The tool as the local model's prompt spells it. The compaction is structural and lossless for text
 * and for validity: every description, tool and property, is kept word for word, and so is every
 * keyword that decides which values validate. What goes is what the model gains nothing from: titles,
 * examples, defaults, the string type of an all-string enum, and a sub-schema repeated within the
 * tool, which is defined once and referenced.
 */
export function compactWebLlmToolSchema(tool: CompactableTool): CompactableTool {
    const { parameters } = tool.function;
    const compactedParameters = parameters === undefined ? {} : { parameters: compactParameters(parameters) };
    return { ...tool, function: { ...tool.function, ...compactedParameters } };
}

/**
 * The tools as one prompt spells them together: each compacted as `compactWebLlmToolSchema` does,
 * except that a sub-schema byte-identical after compaction in two or more of the tools is defined
 * once in `sharedDefinitions`, which the prompt shows once before the tools, and each tool refers
 * to it by `{"$ref":"#/$defs/sN"}`. A repeat inside the shared definitions is defined there too,
 * and a repeat within one tool stays that tool's own `$defs`. Read with the shared definitions
 * merged into its `$defs`, each tool's schema admits exactly what its compacted schema alone does.
 */
export function compactWebLlmToolSchemas(tools: readonly CompactableTool[]): {
    sharedDefinitions: SchemaRecord;
    tools: CompactableTool[];
} {
    const trees = tools.map((tool) => {
        const tree = tool.function.parameters === undefined ? undefined : compactSchema(tool.function.parameters, 0);
        return isRecord(tree) ? tree : {};
    });
    const shared = defineRepeated({
        trees,
        prefix: 's',
        // A repeat within one tool alone stays that tool's; unit 0 is the shared definitions.
        isEligible: (occurrences) => occurrences.units.size >= 2 || occurrences.units.has(0),
    });
    return {
        sharedDefinitions: shared.definitions,
        tools: tools.map((tool, index) => {
            if (tool.function.parameters === undefined) {
                return tool;
            }
            const tree = shared.trees[index] ?? {};
            return { ...tool, function: { ...tool.function, parameters: defineRepeatedWithinTool(tree) } };
        }),
    };
}
