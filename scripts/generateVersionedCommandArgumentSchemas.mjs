import fs from 'node:fs';
import path from 'node:path';

import prettier from 'prettier';
import { isTypeAliasDeclaration, isTypeReferenceNode } from 'typescript/unstable/ast';
import { API, DiagnosticCategory, SymbolFlags, TypeFlags } from 'typescript/unstable/sync';

const root = process.cwd();
const configPath = path.join(root, 'tsconfig.app.json');
const contractPath = path.join(root, 'src/utils/handlerContract.ts');
const outputPath = path.join(root, 'src/modules/Command/useCases/versionedCommandArgumentKeys.ts');

const schemas = readActionSchemas();

function readActionSchemas() {
    const api = new API({ cwd: root });
    let snapshot;
    try {
        snapshot = api.updateSnapshot({ openProjects: [configPath] });
        const project = snapshot.getProject(configPath);
        if (!project) {
            throw new Error('Unable to open tsconfig.app.json');
        }
        const { program, checker } = project;
        const errors = [
            ...program.getConfigFileParsingDiagnostics(),
            ...program.getProgramDiagnostics(),
            ...program.getSyntacticDiagnostics(contractPath),
            ...program.getSemanticDiagnostics(contractPath),
        ].filter((diagnostic) => diagnostic.category === DiagnosticCategory.Error);
        if (errors.length > 0) {
            throw new Error(
                `Unable to generate AppAction schemas:\n${errors
                    .map(
                        (diagnostic) =>
                            `${diagnostic.fileName ?? configPath}:${diagnostic.pos} TS${diagnostic.code}: ${diagnostic.text}`
                    )
                    .join('\n')}`
            );
        }
        const contractSource = program.getSourceFile(contractPath);
        if (!contractSource) {
            throw new Error('Unable to read handlerContract.ts');
        }
        const moduleSymbol = checker.getSymbolAtLocation(contractSource);
        const appActionSymbol = moduleSymbol
            ? checker.getExportsOfModule(moduleSymbol).find((symbol) => symbol.name === 'AppAction')
            : undefined;
        if (!appActionSymbol) {
            throw new Error('Unable to resolve AppAction');
        }
        const appAction = checker.getDeclaredTypeOfSymbol(appActionSymbol);
        if (!appAction.isUnionType()) {
            throw new Error('AppAction must remain a discriminated union');
        }

        function resolveDeclaration(symbol) {
            const handle = symbol.valueDeclaration ?? symbol.declarations[0];
            if (!handle) {
                return undefined;
            }
            const declaration = handle.resolve(project);
            if (!declaration) {
                throw new Error(`Unable to resolve declaration for ${symbol.name}`);
            }
            return declaration;
        }

        function uniqueSchemas(schemas) {
            return [...new Map(schemas.map((schema) => [JSON.stringify(schema), schema])).values()];
        }

        // Native unions use a display order; persisted definition IDs retain checker creation order.
        function orderedProperties(type) {
            const properties = checker.getPropertiesOfType(type);
            const alias = type.getAliasSymbol();
            const declaration = alias ? resolveDeclaration(alias) : undefined;
            if (!declaration || !isTypeAliasDeclaration(declaration) || !isTypeReferenceNode(declaration.type)) {
                return properties;
            }
            // Mapped aliases such as Pick enumerate their keys differently from their source object.
            // Only an exact native key-set match can establish an ordering; it never supplies properties.
            for (const argument of declaration.type.typeArguments ?? []) {
                const keys = checker.getTypeFromTypeNode(argument);
                if (!keys?.isUnionType()) continue;
                const members = [...keys.getTypes()].sort((left, right) => left.id - right.id);
                if (members.length !== properties.length || !members.every((member) => member.isStringLiteralType()))
                    continue;
                const order = new Map(members.map((member, index) => [member.value, index]));
                if (properties.every((property) => order.has(property.name))) {
                    return [...properties].sort((left, right) => order.get(left.name) - order.get(right.name));
                }
            }
            return properties;
        }

        function schemaFor(type, stack = new Set()) {
            if (type.isErrorType()) {
                throw new Error(`Unable to resolve AppAction payload type: ${checker.typeToString(type)}`);
            }
            if (type.flags & (TypeFlags.Any | TypeFlags.Unknown)) {
                return { type: 'json' };
            }
            if (type.flags & TypeFlags.Never) {
                return { type: 'never' };
            }
            if (type.flags & (TypeFlags.Undefined | TypeFlags.Void)) {
                return { type: 'never' };
            }
            if (type.flags & TypeFlags.Null) {
                return { type: 'null' };
            }
            if (type.isStringLiteralType() || type.isNumberLiteralType()) {
                return { type: 'literal', value: type.value };
            }
            if (type.flags & TypeFlags.BooleanLiteral) {
                return { type: 'literal', value: type.value };
            }
            if (type.flags & (TypeFlags.String | TypeFlags.TemplateLiteral)) {
                return { type: 'string' };
            }
            if (type.flags & TypeFlags.Number) {
                return { type: 'number' };
            }
            if (type.flags & TypeFlags.Boolean) {
                return { type: 'boolean' };
            }
            if (stack.has(type.id)) {
                return { type: 'json' };
            }
            const nextStack = new Set(stack);
            nextStack.add(type.id);
            if (type.isUnionType()) {
                const schemas = uniqueSchemas(
                    [...type.getTypes()]
                        .sort((left, right) => left.id - right.id)
                        .filter((member) => !(member.flags & (TypeFlags.Undefined | TypeFlags.Never)))
                        .map((member) => schemaFor(member, nextStack))
                );
                return schemas.length === 1 ? schemas[0] : { anyOf: schemas };
            }
            if (type.isIntersectionType()) {
                return { allOf: type.getTypes().map((member) => schemaFor(member, nextStack)) };
            }
            if (checker.isTupleType(type)) {
                return {
                    type: 'tuple',
                    items: checker.getTypeArguments(type).map((item) => schemaFor(item, nextStack)),
                };
            }
            if (checker.isArrayType(type) || checker.isArrayLikeType(type)) {
                const element = checker
                    .getIndexInfosOfType(type)
                    .find((index) => index.keyType.flags === TypeFlags.Number)?.valueType;
                if (!element) {
                    throw new Error(`Unable to resolve array element type: ${checker.typeToString(type)}`);
                }
                return { type: 'array', items: schemaFor(element, nextStack) };
            }
            if (!(type.flags & TypeFlags.Object)) {
                throw new Error(`Unsupported AppAction payload type: ${checker.typeToString(type)}`);
            }

            const stringIndex = checker
                .getIndexInfosOfType(type)
                .find((index) => index.keyType.flags === TypeFlags.String)?.valueType;
            const properties = {};
            const required = [];
            for (const property of orderedProperties(type)) {
                const declaration = resolveDeclaration(property) ?? contractSource;
                const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
                properties[property.name] = schemaFor(propertyType, nextStack);
                if ((property.flags & SymbolFlags.Optional) === 0) {
                    required.push(property.name);
                }
            }
            if (Object.keys(properties).length === 0 && stringIndex) {
                return { type: 'record', values: schemaFor(stringIndex, nextStack) };
            }
            return {
                type: 'object',
                properties,
                required,
                additionalProperties: stringIndex ? schemaFor(stringIndex, nextStack) : false,
            };
        }

        const schemas = {};
        for (const action of appAction.getTypes()) {
            const typeProperty = checker.getPropertyOfType(action, 'type');
            const typeDeclaration = typeProperty ? resolveDeclaration(typeProperty) : undefined;
            if (!typeProperty || !typeDeclaration) {
                throw new Error('AppAction variant is missing its type discriminator');
            }
            const actionType = checker.getTypeOfSymbolAtLocation(typeProperty, typeDeclaration);
            if (!actionType.isStringLiteralType()) {
                throw new Error('AppAction type discriminator must be a string literal');
            }
            const payloadProperty = checker.getPropertyOfType(action, 'payload');
            if (!payloadProperty) {
                schemas[actionType.value] = {
                    type: 'object',
                    properties: {},
                    required: [],
                    additionalProperties: false,
                };
                continue;
            }
            const payloadDeclaration = resolveDeclaration(payloadProperty);
            if (!payloadDeclaration) {
                throw new Error(`Unable to resolve ${actionType.value} payload`);
            }
            const payloadType = checker.getTypeOfSymbolAtLocation(payloadProperty, payloadDeclaration);
            schemas[actionType.value] =
                payloadType.flags & (TypeFlags.Undefined | TypeFlags.Void)
                    ? {
                          type: 'object',
                          properties: {},
                          required: [],
                          additionalProperties: false,
                      }
                    : schemaFor(payloadType);
        }

        return schemas;
    } finally {
        try {
            snapshot?.dispose();
        } finally {
            api.close();
        }
    }
}

const definitions = [];
const definitionIds = new Map();

function intern(schema) {
    let compact;
    if (schema.anyOf) {
        compact = { anyOf: schema.anyOf.map(intern) };
    } else if (schema.allOf) {
        compact = { allOf: schema.allOf.map(intern) };
    } else if (schema.type === 'array') {
        compact = { type: 'array', items: intern(schema.items) };
    } else if (schema.type === 'tuple') {
        compact = { type: 'tuple', items: schema.items.map(intern) };
    } else if (schema.type === 'record') {
        compact = { type: 'record', values: intern(schema.values) };
    } else if (schema.type === 'object') {
        compact = {
            type: 'object',
            properties: Object.fromEntries(
                Object.entries(schema.properties).map(([key, value]) => [key, intern(value)])
            ),
            required: schema.required,
            additionalProperties: schema.additionalProperties === false ? false : intern(schema.additionalProperties),
        };
    } else {
        compact = schema;
    }
    const key = JSON.stringify(compact);
    const existing = definitionIds.get(key);
    if (existing !== undefined) {
        return existing;
    }
    const id = definitions.length;
    definitions.push(compact);
    definitionIds.set(key, id);
    return id;
}

const actionSchemaIds = Object.fromEntries(Object.entries(schemas).map(([action, schema]) => [action, intern(schema)]));

const source = `// Generated by scripts/generateVersionedCommandArgumentSchemas.mjs from AppAction.
// Do not edit this file by hand.
import { type AppActionType } from '#/utils/handlerContract';

type ObjectSchemaDefinition = {
    readonly type: 'object';
    readonly properties: Readonly<Record<string, number>>;
    readonly required: readonly string[];
    readonly additionalProperties: false | number;
};

type SchemaDefinition =
    | { readonly type: 'string' | 'number' | 'boolean' | 'null' | 'json' | 'never' }
    | { readonly type: 'literal'; readonly value: string | number | boolean }
    | { readonly anyOf: readonly number[] }
    | { readonly allOf: readonly number[] }
    | { readonly type: 'array'; readonly items: number }
    | { readonly type: 'tuple'; readonly items: readonly number[] }
    | { readonly type: 'record'; readonly values: number }
    | ObjectSchemaDefinition;

const schemaDefinitions = ${JSON.stringify(definitions, null, 4)} as const satisfies readonly SchemaDefinition[];

const schemaIdByActionType = ${JSON.stringify(actionSchemaIds, null, 4)} as const satisfies Readonly<Record<AppActionType, number>>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Array.prototype.every skips missing slots, so a sparse hole would slip past
// element validation; every position is checked for presence instead.
function isDenseArray(value: unknown[]): boolean {
    for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
            return false;
        }
    }
    return true;
}

function isJsonSafe(value: unknown): boolean {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return true;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value);
    }
    if (Array.isArray(value)) {
        return isDenseArray(value) && value.every(isJsonSafe);
    }
    return (
        isRecord(value) &&
        Object.getPrototypeOf(value) === Object.prototype &&
        Object.values(value).every(isJsonSafe)
    );
}

function matchesSchema(value: unknown, schemaId: number): boolean {
    const schema = schemaDefinitions[schemaId];
    if (!schema) {
        return false;
    }
    if ('anyOf' in schema) {
        return schema.anyOf.some((member) => matchesSchema(value, member));
    }
    if ('allOf' in schema) {
        return schema.allOf.every((member) => matchesSchema(value, member));
    }
    if (schema.type === 'string') {
        return typeof value === 'string';
    }
    if (schema.type === 'number') {
        return typeof value === 'number' && Number.isFinite(value);
    }
    if (schema.type === 'boolean') {
        return typeof value === 'boolean';
    }
    if (schema.type === 'null') {
        return value === null;
    }
    if (schema.type === 'literal') {
        return Object.is(value, schema.value);
    }
    if (schema.type === 'json') {
        return isJsonSafe(value);
    }
    if (schema.type === 'never') {
        return false;
    }
    if (schema.type === 'array') {
        return Array.isArray(value) && isDenseArray(value) && value.every((item) => matchesSchema(item, schema.items));
    }
    if (schema.type === 'tuple') {
        return (
            Array.isArray(value) &&
            isDenseArray(value) &&
            value.length === schema.items.length &&
            schema.items.every((item, index) => matchesSchema(value[index], item))
        );
    }
    if (schema.type === 'record') {
        return isRecord(value) && Object.values(value).every((item) => matchesSchema(item, schema.values));
    }
    if (!isRecord(value)) {
        return false;
    }
    const objectSchema: ObjectSchemaDefinition = schema;
    const properties = objectSchema.properties;
    const allowedKeys = Object.keys(properties);
    if (
        !objectSchema.required.every((key) => Object.hasOwn(value, key)) ||
        (objectSchema.additionalProperties === false &&
            !Reflect.ownKeys(value).every(
                (key) => typeof key === 'string' && allowedKeys.includes(key)
            ))
    ) {
        return false;
    }
    return Object.entries(value).every(([key, item]) => {
        const propertySchemaId = properties[key];
        if (propertySchemaId !== undefined) {
            return matchesSchema(item, propertySchemaId);
        }
        return (
            objectSchema.additionalProperties !== false &&
            matchesSchema(item, objectSchema.additionalProperties)
        );
    });
}

export function validateVersionedCommandArguments(operation: string, value: unknown): boolean {
    if (!Object.hasOwn(schemaIdByActionType, operation)) {
        return false;
    }
    return matchesSchema(value, schemaIdByActionType[operation as AppActionType]);
}
`;

const prettierConfig = (await prettier.resolveConfig(outputPath)) ?? {};
const formatted = await prettier.format(source, { ...prettierConfig, filepath: outputPath });
if (process.argv.includes('--check')) {
    if (fs.readFileSync(outputPath, 'utf8') !== formatted) {
        throw new Error('Versioned command argument schemas are stale');
    }
} else {
    fs.writeFileSync(outputPath, formatted);
}
