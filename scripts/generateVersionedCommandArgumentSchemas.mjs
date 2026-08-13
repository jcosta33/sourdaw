import fs from 'node:fs';
import path from 'node:path';

import prettier from 'prettier';
import ts from 'typescript';

const root = process.cwd();
const configPath = path.join(root, 'tsconfig.app.json');
const contractPath = path.join(root, 'src/utils/handlerContract.ts');
const outputPath = path.join(root, 'src/modules/Command/useCases/versionedCommandArgumentKeys.ts');

const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
const checker = program.getTypeChecker();
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
if (!appAction.isUnion()) {
    throw new Error('AppAction must remain a discriminated union');
}

function uniqueSchemas(schemas) {
    return [...new Map(schemas.map((schema) => [JSON.stringify(schema), schema])).values()];
}

function schemaFor(type, stack = new Set()) {
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
        return { type: 'json' };
    }
    if (type.flags & ts.TypeFlags.Never) {
        return { type: 'never' };
    }
    if (type.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) {
        return { type: 'never' };
    }
    if (type.flags & ts.TypeFlags.Null) {
        return { type: 'null' };
    }
    if (type.isStringLiteral() || type.isNumberLiteral()) {
        return { type: 'literal', value: type.value };
    }
    if (type.flags & ts.TypeFlags.BooleanLiteral) {
        return { type: 'literal', value: type.intrinsicName === 'true' };
    }
    if (type.flags & (ts.TypeFlags.String | ts.TypeFlags.TemplateLiteral)) {
        return { type: 'string' };
    }
    if (type.flags & ts.TypeFlags.Number) {
        return { type: 'number' };
    }
    if (type.flags & ts.TypeFlags.Boolean) {
        return { type: 'boolean' };
    }
    if (stack.has(type.id)) {
        return { type: 'json' };
    }
    const nextStack = new Set(stack);
    nextStack.add(type.id);
    if (type.isUnion()) {
        const schemas = uniqueSchemas(
            type.types
                .filter((member) => !(member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Never)))
                .map((member) => schemaFor(member, nextStack))
        );
        return schemas.length === 1 ? schemas[0] : { anyOf: schemas };
    }
    if (type.isIntersection()) {
        return { allOf: type.types.map((member) => schemaFor(member, nextStack)) };
    }
    if (checker.isTupleType(type)) {
        return {
            type: 'tuple',
            items: checker.getTypeArguments(type).map((item) => schemaFor(item, nextStack)),
        };
    }
    if (checker.isArrayType(type) || checker.isArrayLikeType(type)) {
        const element = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
        if (!element) {
            throw new Error(`Unable to resolve array element type: ${checker.typeToString(type)}`);
        }
        return { type: 'array', items: schemaFor(element, nextStack) };
    }
    if (!(type.flags & ts.TypeFlags.Object)) {
        throw new Error(`Unsupported AppAction payload type: ${checker.typeToString(type)}`);
    }

    const stringIndex = checker.getIndexTypeOfType(type, ts.IndexKind.String);
    const properties = {};
    const required = [];
    for (const property of checker.getPropertiesOfType(type)) {
        const declaration = property.valueDeclaration ?? property.declarations?.[0] ?? contractSource;
        const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
        properties[property.name] = schemaFor(propertyType, nextStack);
        if ((property.flags & ts.SymbolFlags.Optional) === 0) {
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
for (const action of appAction.types) {
    const typeProperty = action.getProperty('type');
    const typeDeclaration = typeProperty?.valueDeclaration ?? typeProperty?.declarations?.[0];
    if (!typeProperty || !typeDeclaration) {
        throw new Error('AppAction variant is missing its type discriminator');
    }
    const actionType = checker.getTypeOfSymbolAtLocation(typeProperty, typeDeclaration);
    if (!actionType.isStringLiteral()) {
        throw new Error('AppAction type discriminator must be a string literal');
    }
    const payloadProperty = action.getProperty('payload');
    if (!payloadProperty) {
        schemas[actionType.value] = {
            type: 'object',
            properties: {},
            required: [],
            additionalProperties: false,
        };
        continue;
    }
    const payloadDeclaration = payloadProperty.valueDeclaration ?? payloadProperty.declarations?.[0];
    if (!payloadDeclaration) {
        throw new Error(`Unable to resolve ${actionType.value} payload`);
    }
    const payloadType = checker.getTypeOfSymbolAtLocation(payloadProperty, payloadDeclaration);
    schemas[actionType.value] =
        payloadType.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)
            ? {
                  type: 'object',
                  properties: {},
                  required: [],
                  additionalProperties: false,
              }
            : schemaFor(payloadType);
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

function isJsonSafe(value: unknown): boolean {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return true;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value);
    }
    if (Array.isArray(value)) {
        return value.every(isJsonSafe);
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
        return Array.isArray(value) && value.every((item) => matchesSchema(item, schema.items));
    }
    if (schema.type === 'tuple') {
        return (
            Array.isArray(value) &&
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
