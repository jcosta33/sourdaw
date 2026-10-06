import { type RetainedCommandSet } from '../models/RetainedCompilation';
import { type ToolCallResult } from '../transformers/toolCallParser';

/**
 * Only the application may turn retained compiler emissions into proposal calls. A binding a command
 * mints rides as its own argument, the form the provider writes it in.
 */
export function materializeTransformToolCalls(compilations: readonly RetainedCommandSet[]): ToolCallResult[] {
    return compilations.flatMap((compiled) =>
        compiled.commands.map((command) => {
            if (command.binding === null) {
                return { name: command.operation, arguments: command.arguments };
            }
            return { name: command.operation, arguments: { ...command.arguments, binding: command.binding } };
        })
    );
}
