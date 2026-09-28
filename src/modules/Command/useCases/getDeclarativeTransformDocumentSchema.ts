import {
    DECLARATIVE_TRANSFORM_MAX_EMITTED_COMMANDS,
    DECLARATIVE_TRANSFORM_MAX_EXPRESSION_DEPTH,
    DECLARATIVE_TRANSFORM_MAX_SEED,
    DECLARATIVE_TRANSFORM_MAX_SELECTOR_LIMIT,
    DECLARATIVE_TRANSFORM_MAX_STEP_DEPTH,
    DECLARATIVE_TRANSFORM_MAX_VARIABLES,
    DECLARATIVE_TRANSFORM_MIN_SEED,
    DECLARATIVE_TRANSFORM_SCHEMA_VERSION,
    DECLARATIVE_TRANSFORM_UNITS,
} from '../models/DeclarativeTransform';

// The hosted Anthropic response and local model-provider stream both stop at 1 MiB.
// Check this before parsing the nested JSON text as well as in provider guidance.
const MAX_TRANSFORM_DOCUMENT_JSON_BYTES = 1_024 * 1_024;

const EXAMPLE = JSON.stringify({
    schemaVersion: DECLARATIVE_TRANSFORM_SCHEMA_VERSION,
    name: 'set-midi-clip-velocities',
    seed: 7,
    variables: {
        velocity: {
            node: 'add',
            left: { node: 'const', quantity: { unit: 'count', value: 80 } },
            right: { node: 'const', quantity: { unit: 'count', value: 10 } },
        },
    },
    selectors: { clips: { target: 'clip', where: { contentType: 'midi' }, limit: 2 } },
    steps: [
        {
            id: 'each-clip',
            kind: 'each',
            selector: 'clips',
            as: 'clip',
            body: [
                {
                    id: 'only-first-two',
                    kind: 'when',
                    condition: {
                        cmp: 'lt',
                        left: { node: 'index', item: 'clip' },
                        right: { node: 'const', quantity: { unit: 'count', value: 2 } },
                    },
                    then: [
                        {
                            id: 'set-velocity',
                            kind: 'emit',
                            operation: 'setAllVelocities',
                            arguments: { clipId: { itemId: 'clip' }, velocity: { node: 'var', name: 'velocity' } },
                        },
                    ],
                },
            ],
        },
    ],
    assertions: [
        {
            condition: {
                cmp: 'lt',
                left: { node: 'const', quantity: { unit: 'count', value: 0 } },
                right: { node: 'var', name: 'velocity' },
            },
            message: 'Velocity must be positive.',
        },
    ],
});

/** Provider guidance for the full existing DSL; parseDeclarativeTransformDocument is the runtime authority. */
export function getDeclarativeTransformDocumentSchema() {
    return {
        type: 'string',
        minLength: 2,
        maxLength: MAX_TRANSFORM_DOCUMENT_JSON_BYTES,
        description: [
            'Pass one JSON-encoded string, not an object, containing the complete versioned transform document.',
            `Required document keys: schemaVersion=${String(DECLARATIVE_TRANSFORM_SCHEMA_VERSION)}, name, seed (${String(DECLARATIVE_TRANSFORM_MIN_SEED)}..${String(DECLARATIVE_TRANSFORM_MAX_SEED)}), variables (name-to-expression map, at most ${String(DECLARATIVE_TRANSFORM_MAX_VARIABLES)}), selectors (name-to-selector map), steps (array), assertions (array).`,
            `Selector: {target:"track"|"clip",limit:1..${String(DECLARATIVE_TRANSFORM_MAX_SELECTOR_LIMIT)},where?:{contentType?:"audio"|"midi"|null,nameIncludes?:string,trackId?:string,startsAtOrAfterBeat?:number,endsAtOrBeforeBeat?:number}}.`,
            'Step: {id,kind:"each",selector,as,body:[steps]} or {id,kind:"when",condition,then:[steps]} or {id,kind:"emit",operation,arguments:{argumentName:argument},binding?:string,dependsOn?:string[]}.',
            'Argument: expression, {literal:string|number|boolean}, {itemId:string}, or {bindingRef:string}.',
            `Expression: {node:"const",quantity:{unit,value}} where unit is ${DECLARATIVE_TRANSFORM_UNITS.join('|')}; {node:"var",name}; {node:"index",item}; {node:"field",item,field:"startBeat"|"endBeat"|"length"}; {node:"add"|"sub"|"mul"|"div",left,right}; {node:"random",min,max}; or {node:"secondsToBeats"|"beatsToSeconds",value}.`,
            'Condition: {cmp:"lt"|"le"|"eq"|"ge"|"gt",left:expression,right:expression}, {all:[conditions]}, or {any:[conditions]}. Assertion: {condition,message}.',
            `Limits: at most ${String(DECLARATIVE_TRANSFORM_MAX_STEP_DEPTH)} nested step levels, ${String(DECLARATIVE_TRANSFORM_MAX_EXPRESSION_DEPTH)} expression/condition levels, ${String(DECLARATIVE_TRANSFORM_MAX_EMITTED_COMMANDS)} emitted commands, and ${String(MAX_TRANSFORM_DOCUMENT_JSON_BYTES)} UTF-8 bytes of JSON text. No scripts, callbacks, or array/object literals as command arguments. Compilation is preview only.`,
            `Valid complete document JSON text: ${EXAMPLE}`,
        ].join(' '),
    } as const;
}
