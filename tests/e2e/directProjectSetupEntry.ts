import { captureUndoHistory } from '../../src/modules/Command/useCases';
import { captureProjectRevision, getCrdtDoc } from '../../src/modules/CrdtDocument/useCases';
import { newProject as _newProject } from '../../src/modules/Project/useCases';

import type {
    DirectProjectSetupModule,
    ProjectInspectionModule,
    ProjectInspectionRecord,
    ProjectInspectionValue,
} from './directProjectSetupContract';

// Checked against the pure contract so both Node tooling and browser tsconfigs
// agree on the callable surface without crossing module-graph boundaries.
export const newProject: DirectProjectSetupModule['newProject'] = _newProject;

function cloneRecord(value: object, ancestors: ReadonlySet<object>): ProjectInspectionRecord {
    if (ancestors.has(value)) {
        throw new TypeError('Project inspection cannot transport cyclic data');
    }
    const nextAncestors = new Set(ancestors).add(value);
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry, nextAncestors)]));
}

function cloneValue(value: unknown, ancestors: ReadonlySet<object>): ProjectInspectionValue {
    if (
        value === null ||
        value === undefined ||
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        typeof value === 'number'
    ) {
        return value;
    }
    if (Array.isArray(value)) {
        if (ancestors.has(value)) {
            throw new TypeError('Project inspection cannot transport cyclic data');
        }
        const nextAncestors = new Set(ancestors).add(value);
        return value.map((entry) => cloneValue(entry, nextAncestors));
    }
    if (
        typeof value === 'object' &&
        (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
    ) {
        return cloneRecord(value, ancestors);
    }
    throw new TypeError(`Project inspection cannot transport ${typeof value} data`);
}

export const inspectProject: ProjectInspectionModule['inspectProject'] = () => {
    const project = getCrdtDoc('root');
    const history = captureUndoHistory();
    return {
        project: project ? cloneRecord(project, new Set()) : null,
        revision: captureProjectRevision(),
        history: {
            past: history.past.map((entry) => cloneRecord(entry, new Set())),
            future: history.future.map((entry) => cloneRecord(entry, new Set())),
            undoTree: cloneValue(history.undoTree, new Set()),
        },
    };
};
