/**
 * Command palette entry type.
 *
 * Type-only model for the command palette. The aggregated catalog
 * (`commandRegistry`) and the search/match helpers live in
 * `./CommandRegistry.ts`. Per-category command lists live in
 * `./Commands/*.ts` and import this file rather than the aggregator.
 */

import { type AppAction } from '../useCases/commandQueries';

export type CommandEntry = {
    id: string;
    label: string;
    description: string;
    category: string;
    shortcut?: string;
    action: AppAction | (() => void);
};
