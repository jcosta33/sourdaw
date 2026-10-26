/** The case-level admission question, kept with its evidence contract and counterexamples. */

import type { SemanticRule } from './rules.ts';

type TestRuleBase = Omit<SemanticRule, 'id' | 'version' | 'purpose' | 'instructions' | 'criteria' | 'counterexamples'>;

export function admissionCaseRule(base: TestRuleBase): SemanticRule {
    return {
        ...base,
        requiredEvidence: [...base.requiredEvidence, 'complete test case context'],
        id: 'admission_branch_completes_without_asserting',
        version: '3',
        purpose: 'Whether a new branch lets a collected test case finish without asserting.',
        instructions:
            'Does `after` add a branch that lets a collected test case complete successfully without executing an assertion or explicit failure? Follow the enclosing `it` or `test` callback through the branch to case completion. A mock or helper callback return resumes the case; it is not case completion when downstream assertions still execute. This question is asked only when the supplied regions contain every relevant complete test case on both available sides. `state.unit.changedLines.after.addedControlFlow` names the added lines whose text introduces control flow — `if (`, `else`, `catch`, `switch`, `throw`, and a bare `return` — with a count and line numbers. Those are facts about which lines the edit added, never proof about behaviour: the text of an added line cannot show what its branch body does, whether a `catch` rethrows, or whether an assertion outside the regions this request carries covers the path a branch skips. When `state.unit.changedLines.basis` is `unavailable` the edit was not read line by line: answer from the supplied sides alone, and never read a missing fact as absence.',
        criteria: {
            true: 'At least one new branch lets the test case complete successfully without executing an assertion or explicit failure.',
            false: 'Every successful case path still executes an assertion or explicitly fails; a mock or helper return followed by a case assertion does not satisfy this concern.',
        },
        counterexamples: [
            'A branch that calls a shared assertion helper',
            'A catch that rethrows or fails the test',
            'An ordinary return inside a mock or fixture callback followed by an assertion in the enclosing test case',
        ],
    };
}
