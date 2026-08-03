import { DAW_TOOL_SCHEMAS, type ToolSchema } from '../models/ToolDefinitions';

const addNotesToolSchema = DAW_TOOL_SCHEMAS.find((toolSchema) => toolSchema.function.name === 'addNotes');

export function getMidiNoteGenerationToolSchemas(): readonly ToolSchema[] {
    if (!addNotesToolSchema) {
        throw new Error('The addNotes tool schema is unavailable');
    }

    return [addNotesToolSchema];
}
