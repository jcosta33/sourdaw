import { type ToolCallResult } from '../transformers/toolCallParser';

import { type RetainedTransformCompilation } from './applicationOwnedToolLoop';

/** Only the application may turn retained compiler emissions into proposal calls. */
export function materializeTransformToolCalls(compilations: readonly RetainedTransformCompilation[]): ToolCallResult[] {
    return compilations.flatMap((compiled) =>
        compiled.commands.map((command) => {
            if (command.binding === null) {
                return { name: command.operation, arguments: command.arguments };
            }
            return { name: command.operation, arguments: { ...command.arguments, binding: command.binding } };
        })
    );
}
