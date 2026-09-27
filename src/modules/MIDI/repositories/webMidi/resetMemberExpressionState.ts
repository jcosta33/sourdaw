import { memberExpressionGeneration } from './memberExpressionGeneration';
import { memberExpressionState } from './memberExpressionState';

export function resetMemberExpressionState(): void {
    memberExpressionGeneration.current += 1;
    memberExpressionState.clear();
}
