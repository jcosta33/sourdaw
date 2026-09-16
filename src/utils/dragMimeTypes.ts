/**
 * The drag-and-drop wire types between the browser panels (writers) and the
 * timeline drop hook (reader). A custom MIME type is the only payload channel
 * a drop carries besides files, so writer and reader must spell these
 * identically — a typo on either side is not an error, the payload just never
 * arrives. Beside {@link MIDI_CLIP_DRAG_MIME_TYPE}, the pre-existing member of
 * this family.
 */

export const SAMPLE_DRAG_MIME_TYPE = 'application/x-sourdaw-sample';
export const PLUGIN_DRAG_MIME_TYPE = 'application/x-sourdaw-plugin';
export const AI_RENDER_DRAG_MIME_TYPE = 'application/x-sourdaw-ai-render';
