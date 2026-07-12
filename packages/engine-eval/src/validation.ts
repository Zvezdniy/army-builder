import type { Issue } from "@muster/domain";
import type { EvalNode, EvalState } from "./state";
import { passesGate } from "./conditions";

// Designer-authored validation rules (BattleScribe field="error" modifiers):
// when a rule's gate passes on this node, the selection is invalid with the
// rule's message. `{this}` is replaced with the entry name. The gate is
// evaluated on the real node (real ancestor chain), mirroring nodeHiddenByState.
export function validationIssues(node: EvalNode, state: EvalState): Issue[] {
  const out: Issue[] = [];
  for (const rule of node.entry.validationRules ?? []) {
    if (passesGate(rule.conditions, rule.conditionGroups, node, state)) {
      out.push({
        severity: "error",
        code: "selection.invalid",
        message: rule.message.replaceAll("{this}", node.entry.name),
        selectionId: node.selectionId,
        entryId: node.entry.id,
      });
    }
  }
  return out;
}
