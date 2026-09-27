import { memberExpressionGeneration } from './memberExpressionGeneration';
import { memberExpressionState } from './memberExpressionState';
import { pendingMemberAdmission } from './pendingMemberAdmission';

export function resetMemberExpressionState(): void {
    memberExpressionGeneration.current += 1;
    memberExpressionState.clear();
    pendingMemberAdmission.clear();
}
