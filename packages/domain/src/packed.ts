import { z } from "zod";
import type { IrCatalogue, IrEntry } from "./ir";
import { IrCost, IrConstraint, IrGroup, IrProfile } from "./ir";
import { VisibilityModifier } from "./visibility";
import { IrValidationRule } from "./validation-rules";
import { IrCategoryModifier } from "./category-modifiers";

// Deterministic serialization for content-addressing: object keys sorted
// recursively so key-order variance never changes the hash. Arrays keep order
// (semantically significant). No cycles: a packed tree is a DAG of subtrees.
export function canonicalKey(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = walk((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

// A pooled entry mirrors IrEntry but replaces the recursive children with
// indices into PackedCatalogue.entryPool.
export const PackedEntry = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["unit", "upgrade", "model"]).optional(),
  costs: z.array(IrCost).default([]),
  categories: z.array(z.string()).default([]),
  constraints: z.array(IrConstraint).default([]),
  children: z.array(z.number().int().nonnegative()).default([]),
  groups: z.array(IrGroup).default([]),
  profiles: z.array(IrProfile).default([]),
  hidden: z.boolean().default(false),
  visibilityModifiers: z.array(VisibilityModifier).default([]),
  validationRules: z.array(IrValidationRule).default([]),
  categoryModifiers: z.array(IrCategoryModifier).default([]),
});
export type PackedEntry = z.infer<typeof PackedEntry>;

export const PackedCatalogue = z.object({
  format: z.literal("packed-v1"),
  id: z.string(),
  name: z.string(),
  gameSystemId: z.string(),
  revision: z.number().finite(),
  entryPool: z.array(PackedEntry),
  entries: z.array(z.number().int().nonnegative()),
  forceConstraints: z.array(IrConstraint).default([]),
  categoryNames: z.record(z.string()).default({}),
  ruleTexts: z.record(z.string()).optional(),
});
export type PackedCatalogue = z.infer<typeof PackedCatalogue>;

// Bottom-up interning: children are interned before their parent, so identical
// subtrees collapse to one pool entry and the pool is topologically ordered
// (every child index < its parent index).
export function packCatalogue(cat: IrCatalogue): PackedCatalogue {
  const pool: PackedEntry[] = [];
  const index = new Map<string, number>();
  const intern = (e: IrEntry): number => {
    const children = e.children.map(intern);
    // Fill the fields the IrEntry interface leaves optional (Zod parse already
    // materialized them at runtime) so the pooled entry satisfies PackedEntry.
    const packed: PackedEntry = {
      ...e,
      children,
      groups: e.groups ?? [],
      profiles: e.profiles ?? [],
      hidden: e.hidden ?? false,
      visibilityModifiers: e.visibilityModifiers ?? [],
      validationRules: e.validationRules ?? [],
      categoryModifiers: e.categoryModifiers ?? [],
    };
    const key = canonicalKey(packed);
    let i = index.get(key);
    if (i === undefined) {
      i = pool.length;
      pool.push(packed);
      index.set(key, i);
    }
    return i;
  };
  const entries = cat.entries.map(intern);
  return {
    format: "packed-v1",
    id: cat.id,
    name: cat.name,
    gameSystemId: cat.gameSystemId,
    revision: cat.revision,
    entryPool: pool,
    entries,
    forceConstraints: cat.forceConstraints,
    categoryNames: cat.categoryNames,
    ...(cat.ruleTexts !== undefined ? { ruleTexts: cat.ruleTexts } : {}),
  };
}

// Memoized rebuild: identical subtrees resolve to the SAME object (shared,
// read-only) so the runtime tree is a compact DAG. Order-independent, no cycles.
export function rehydrateCatalogue(p: PackedCatalogue): IrCatalogue {
  const built: (IrEntry | undefined)[] = new Array(p.entryPool.length);
  const build = (i: number): IrEntry => {
    const memo = built[i];
    if (memo) return memo;
    const pe = p.entryPool[i];
    if (!pe) throw new Error(`packed entry index out of range: ${i}`);
    const node: IrEntry = { ...pe, children: pe.children.map(build) };
    built[i] = node;
    return node;
  };
  const entries = p.entries.map(build);
  return {
    id: p.id,
    name: p.name,
    gameSystemId: p.gameSystemId,
    revision: p.revision,
    entries,
    forceConstraints: p.forceConstraints,
    categoryNames: p.categoryNames,
    ...(p.ruleTexts !== undefined ? { ruleTexts: p.ruleTexts } : {}),
  };
}
