import { type ToolSchema } from '../../../models/ToolDefinitions';

import { encodeWireToolName } from './encodeWireToolName';

export function buildWireToolNameCodec(toolSchemas: readonly ToolSchema[]): {
    encode: (name: string) => string;
    decode: (wireName: string) => string;
} {
    const wireToInternal = new Map<string, string>();
    for (const schema of toolSchemas) {
        const internalName = schema.function.name;
        const wireName = encodeWireToolName(internalName);
        const existing = wireToInternal.get(wireName);
        if (existing !== undefined && existing !== internalName) {
            throw new Error(`Tool names '${existing}' and '${internalName}' collide onto wire name '${wireName}'`);
        }
        wireToInternal.set(wireName, internalName);
    }
    return {
        encode: encodeWireToolName,
        decode: (wireName: string) => wireToInternal.get(wireName) ?? wireName,
    };
}
