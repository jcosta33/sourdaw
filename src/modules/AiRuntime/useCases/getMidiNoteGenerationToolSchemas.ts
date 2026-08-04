import { createAddNotesToolSchema } from '../models/Tools/CreateAddNotesToolSchema';
import { type ToolSchema } from '../models/Tools/Types';

type GetMidiNoteGenerationToolSchemasInput = {
    expectedClipId: string;
    allowNegativeStartBeat?: boolean;
};

export function getMidiNoteGenerationToolSchemas(input: GetMidiNoteGenerationToolSchemasInput): readonly ToolSchema[] {
    return [createAddNotesToolSchema(input)];
}
