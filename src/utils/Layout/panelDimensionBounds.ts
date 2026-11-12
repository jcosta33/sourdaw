import { MIN_TRACK_LIST_WIDTH } from './allocateMainFirstWidths';

export const SIDEBAR_WIDTH_BOUNDS = { min: 180, max: 500 } as const;
export const INSPECTOR_WIDTH_BOUNDS = { min: 200, max: 500 } as const;
export const TRACK_LIST_WIDTH_BOUNDS = { min: MIN_TRACK_LIST_WIDTH, max: 400 } as const;
export const SESSION_VIEW_WIDTH_BOUNDS = { min: 200, max: 800 } as const;
export const VIRTUAL_KEYBOARD_HEIGHT_BOUNDS = { min: 80, max: 400 } as const;
