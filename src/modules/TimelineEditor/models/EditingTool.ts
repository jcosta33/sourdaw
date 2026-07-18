/**
 * TimelineEditor-local view shape of the Workspace editing tool (model
 * isolation — NOT a re-export). Workspace owns the canonical `EditingTool`
 * (its `workspaceStore` holds `activeTool`); this local copy lets timeline
 * surfaces type tool state without a cross-module model import.
 */

export type EditingTool = 'select' | 'cut' | 'draw' | 'automation' | 'stretch' | 'marquee';
