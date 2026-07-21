import type { IrProfile } from "@muster/domain";

// A weapon's abilities ("Assault", "Anti-Vehicle 4+", "Sustained Hits 2") reach us
// TWO different ways depending on the catalogue:
//   - Real 10e/11e data carries them as a single "Keywords" CHARACTERISTIC whose value
//     is a comma-separated list — profile.keywords is absent.
//   - The bundled mini40k fixture carries them as the profile.keywords ARRAY, with no
//     "Keywords" characteristic.
// The keyword-rule popups read profile.keywords, so on real data they silently render
// nothing. weaponKeywords() reads whichever shape is present.
//
// A token also carries a PARAMETER the base rule text is not keyed by: "Sustained Hits 2"
// is explained by the "Sustained Hits" rule, "Anti-Vehicle 4+" by the generic "Anti" rule.
// Each keyword therefore pairs a display `label` (the full token) with a `ruleKey` (the
// base name to look up in catalogue.ruleTexts).
export const KEYWORDS_CHARACTERISTIC = "Keywords";

export interface WeaponKeyword {
  /** Full token, shown on the chip and as the popup title, e.g. "Sustained Hits 2". */
  label: string;
  /** Base keyword the rule text is keyed by, e.g. "Sustained Hits". */
  ruleKey: string;
}

/** The base keyword a token's rule is filed under: drop a trailing " N" / " N+" parameter,
 *  and collapse any "Anti-<type> N+" to the generic "Anti" rule. */
export function baseKeyword(token: string): string {
  const t = token.trim();
  if (/^anti\b/i.test(t)) return "Anti";
  return t.replace(/\s+\d+\+?$/, "").trim();
}

/** The weapon keywords on a profile, in source order, deduped by label. Empty for a
 *  weapon with no keywords (the "Keywords" value is "-" or blank). */
export function weaponKeywords(profile: IrProfile): WeaponKeyword[] {
  const chr = profile.characteristics.find((c) => c.name === KEYWORDS_CHARACTERISTIC);
  const tokens = chr !== undefined
    ? chr.value.split(",").map((s) => s.trim()).filter((s) => s !== "" && s !== "-")
    : (profile.keywords ?? []);
  const seen = new Set<string>();
  const out: WeaponKeyword[] = [];
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    out.push({ label: token, ruleKey: baseKeyword(token) });
  }
  return out;
}

/** A rule-text lookup that tolerates the case drift in real data (a keyword written
 *  "Anti-VEHICLE 3+" on one weapon and "Anti-Vehicle 3+" on another, while ruleTexts is
 *  keyed "Anti"): exact match first, then a case-insensitive fallback. Returns undefined
 *  when no rule is known, so the caller can decide what to show. */
export function makeRuleResolver(
  ruleTexts: Record<string, string> | undefined,
): (ruleKey: string) => string | undefined {
  if (ruleTexts === undefined) return () => undefined;
  const lower = new Map<string, string>();
  for (const [k, v] of Object.entries(ruleTexts)) {
    const lk = k.toLowerCase();
    if (!lower.has(lk)) lower.set(lk, v); // first key of a given casing wins, deterministically
  }
  return (ruleKey) => ruleTexts[ruleKey] ?? lower.get(ruleKey.toLowerCase());
}
