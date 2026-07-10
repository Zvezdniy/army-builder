import type { IrModifier } from "@muster/domain";
import type { EvalNode, EvalState } from "./state";
import { gatePasses } from "./conditions";
import { nodePoints, type CostFn } from "./cost";

export function applyModifiers(
  base: number,
  modifiers: IrModifier[] | undefined,
  node: EvalNode | null,
  state: EvalState,
  costOf: CostFn = nodePoints,
): number {
  let value = base;
  for (const modifier of modifiers ?? []) {
    if (!gatePasses(modifier, node, state, costOf)) continue;
    switch (modifier.type) {
      case "set":
        value = modifier.value;
        break;
      case "increment":
        value += modifier.value;
        break;
      case "decrement":
        value -= modifier.value;
        break;
      default: {
        const _exhaustive: never = modifier.type;
        throw new Error(`Unknown modifier type: ${String(_exhaustive)}`);
      }
    }
  }
  return value;
}
