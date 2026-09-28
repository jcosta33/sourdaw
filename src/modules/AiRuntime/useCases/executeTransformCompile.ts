import { compileDeclarativeTransform, parseDeclarativeTransformDocument } from '#/modules/Command/useCases';

import { TRANSFORM_COMPILE_TOOL_NAME } from '../models/AgentToolCatalogNames';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import { type ToolCallResult } from '../transformers/toolCallParser';

type TransformSnapshot = Parameters<typeof compileDeclarativeTransform>[1];
type CompiledCommands = Extract<ReturnType<typeof compileDeclarativeTransform>, { status: 'compiled' }>['commands'];

type TransformCompileResult = {
    receipt: ApplicationToolReceipt;
    commands: CompiledCommands | null;
};

export function executeTransformCompile(input: {
    call: ToolCallResult;
    callId: string;
    turn: number;
    snapshot: TransformSnapshot;
}): TransformCompileResult {
    const { call, callId, turn, snapshot } = input;
    const failure = (code: string, reason: string): TransformCompileResult => ({
        commands: null,
        receipt: {
            schema: 'sourdaw.application-tool-receipt',
            schemaVersion: 1,
            callId,
            toolName: TRANSFORM_COMPILE_TOOL_NAME,
            turn,
            status: 'failure',
            revision: snapshot.revision,
            data: null,
            summary: reason,
            warnings: [],
            error: { code, safeMessage: reason, retryable: false },
        },
    });
    if (Object.keys(call.arguments).length !== 1 || !Object.hasOwn(call.arguments, 'document')) {
        return failure('invalid-tool-arguments', 'Transform call must contain one document.');
    }
    const parsed = parseDeclarativeTransformDocument(call.arguments.document);
    if (parsed.status === 'rejected') {
        return failure('invalid-tool-arguments', parsed.reason);
    }
    const compiled = compileDeclarativeTransform(parsed.document, snapshot);
    if (compiled.status === 'rejected') {
        return failure('transform-rejected', compiled.reason);
    }
    return {
        commands: compiled.commands,
        receipt: {
            schema: 'sourdaw.application-tool-receipt',
            schemaVersion: 1,
            callId,
            toolName: TRANSFORM_COMPILE_TOOL_NAME,
            turn,
            status: 'success',
            revision: snapshot.revision,
            data: { commands: compiled.commands },
            summary: `Compiled ${String(compiled.commands.length)} ordinary command(s).`,
            warnings: [],
            error: null,
        },
    };
}
