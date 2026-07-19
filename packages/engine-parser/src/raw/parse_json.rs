use std::collections::{BTreeMap, HashMap};
use serde::Deserialize;
use crate::raw::model::*;
use crate::{Diagnostic, ParseError};

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonRoot { catalogue: Option<JsonCat>, game_system: Option<JsonCat> }

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonCat {
    id: String, name: String, revision: i64, game_system_id: Option<String>,
    cost_types: Vec<JsonCostType>,
    category_entries: Vec<JsonCategoryEntry>,
    rules: Vec<JsonRule>, shared_rules: Vec<JsonRule>,
    shared_selection_entries: Vec<JsonEntry>,
    shared_selection_entry_groups: Vec<JsonGroup>,
    shared_profiles: Vec<JsonProfile>,
    selection_entries: Vec<JsonEntry>,
    entry_links: Vec<JsonEntryLink>,
    catalogue_links: Vec<JsonCatalogueLink>,
    force_entries: Vec<JsonForce>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonCostType { id: String, name: String }

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonCategoryEntry { id: String, name: String }

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonRule {
    id: String, name: String,
    #[serde(deserialize_with = "string_or_string_seq")] alias: Vec<String>,
    description: String,
}

/// Real BSData JSON encodes a rule's `alias` as either a single string (the
/// hand-written mini fixtures) or an array of strings (real wh40k-11e data,
/// e.g. `"alias": ["PISTOL"]` — a rule can have multiple alias keywords).
/// This is the field that made the raw SM 11e catalogue fail to parse:
/// `serde` rejected the JSON array against a `String`-typed field.
fn string_or_string_seq<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct V;
    impl<'de> serde::de::Visitor<'de> for V {
        type Value = Vec<String>;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("a string or an array of strings")
        }
        fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
            Ok(vec![v.to_string()])
        }
        fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
        where
            A: serde::de::SeqAccess<'de>,
        {
            let mut out = Vec::new();
            while let Some(s) = seq.next_element::<String>()? { out.push(s); }
            Ok(out)
        }
        fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
            // Explicit JSON `null` (as opposed to an absent key) — treat as
            // "no alias", the same as an empty array or a missing field.
            Ok(Vec::new())
        }
    }
    deserializer.deserialize_any(V)
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonEntry {
    id: String, name: String, #[serde(rename = "type")] entry_type: String, hidden: bool,
    costs: Vec<JsonCost>, category_links: Vec<JsonCategoryLink>,
    constraints: Vec<JsonConstraint>, modifiers: Vec<JsonModifier>,
    modifier_groups: Vec<JsonModifierGroup>,
    selection_entries: Vec<JsonEntry>, selection_entry_groups: Vec<JsonGroup>,
    entry_links: Vec<JsonEntryLink>, profiles: Vec<JsonProfile>,
    rules: Vec<JsonRule>, associations: Vec<serde_json::Value>,
    info_links: Vec<JsonInfoLink>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonGroup {
    id: String, name: String, default_selection_entry_id: String, hidden: bool,
    selection_entries: Vec<JsonEntry>, selection_entry_groups: Vec<JsonGroup>,
    entry_links: Vec<JsonEntryLink>, constraints: Vec<JsonConstraint>,
    modifiers: Vec<JsonModifier>, modifier_groups: Vec<JsonModifierGroup>,
    profiles: Vec<JsonProfile>, rules: Vec<JsonRule>,
    info_links: Vec<JsonInfoLink>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonInfoLink { target_id: String, #[serde(rename = "type")] link_type: String, hidden: bool }

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonEntryLink {
    id: String, target_id: String, #[serde(rename = "type")] link_type: String,
    hidden: bool, modifiers: Vec<JsonModifier>, modifier_groups: Vec<JsonModifierGroup>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonCatalogueLink { target_id: String, import_root_entries: bool }

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonForce {
    id: String, name: String, constraints: Vec<JsonConstraint>,
    category_links: Vec<JsonCategoryLink>, rules: Vec<JsonRule>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonCategoryLink { target_id: String, primary: bool, constraints: Vec<JsonConstraint> }

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonCost { #[serde(rename = "typeId")] type_id: String, value: f64 }

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonConstraint {
    id: String, #[serde(rename = "type")] kind: String, value: f64, field: String,
    scope: String, include_child_selections: bool,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonModifier {
    #[serde(rename = "type")] kind: String, field: String,
    value: serde_json::Value,
    conditions: Vec<JsonCondition>, condition_groups: Vec<JsonConditionGroup>,
    repeats: Vec<serde_json::Value>,
}

/// A `modifierGroup` bundles several sibling `modifiers` under one shared
/// `conditions` list, and — as also seen in real data (e.g. Leagues of
/// Votann, Imperial Knights Library, Necrons, Thousand Sons) — a shared
/// `conditionGroups` list too. Both are ANDed onto each flattened child
/// modifier's own conditions/conditionGroups (see `flatten_modifier_groups`).
/// All 218 modifierGroups observed in the real wh40k-11e Space Marines
/// catalogue use `"type": "and"`; a non-"and" `type` is diagnosed (see
/// `flatten_modifier_groups`) rather than modelled, and is still flattened
/// as AND on a best-effort basis.
#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonModifierGroup {
    #[serde(rename = "type")] kind: String,
    modifiers: Vec<JsonModifier>,
    conditions: Vec<JsonCondition>,
    condition_groups: Vec<JsonConditionGroup>,
    repeats: Vec<serde_json::Value>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonCondition {
    #[serde(rename = "type")] comparator: String, field: String, scope: String,
    value: f64, child_id: String, include_child_selections: bool,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonConditionGroup {
    #[serde(rename = "type")] kind: String,
    conditions: Vec<JsonCondition>, condition_groups: Vec<JsonConditionGroup>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonProfile {
    id: String, name: String, type_name: String, characteristics: Vec<JsonCharacteristic>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonCharacteristic { name: String, #[serde(rename = "$text")] text: String }

/// Parse BS-JSON bytes (catalogue or gameSystem wrapper) into a RawCatalogue,
/// the same target the XML parser produces. Diagnostics are collected by the
/// caller in later stages; the only diagnostic emitted here (dropped
/// `associations`) is accumulated into a thread-local-free out param added in Task 5.
pub fn parse_raw_json(bytes: &[u8], diags: &mut Vec<Diagnostic>) -> Result<RawCatalogue, ParseError> {
    let root: JsonRoot = serde_json::from_slice(bytes)
        .map_err(|e| ParseError::Io(format!("invalid catalogue JSON: {e}")))?;
    let cat = root.catalogue.or(root.game_system)
        .ok_or_else(|| ParseError::Io("JSON has neither `catalogue` nor `gameSystem`".into()))?;
    Ok(map_cat(cat, diags))
}

fn map_cat(c: JsonCat, diags: &mut Vec<Diagnostic>) -> RawCatalogue {
    let mut cost_types = HashMap::new();
    for ct in &c.cost_types {
        if ct.id.is_empty() { continue; }
        cost_types.insert(ct.id.clone(), ct.name.clone());
    }
    let mut categories = HashMap::new();
    for ce in &c.category_entries {
        if ce.id.is_empty() { continue; }
        categories.insert(ce.id.clone(), ce.name.clone());
    }
    let mut rules = BTreeMap::new();
    collect_rules(&c, &mut rules);
    RawCatalogue {
        id: c.id.clone(), name: c.name.clone(), revision: c.revision,
        game_system_id: c.game_system_id.clone(),
        cost_types, categories, rules,
        shared_entries: c.shared_selection_entries.iter().map(|e| map_entry(e, diags)).collect(),
        shared_groups: c.shared_selection_entry_groups.iter().map(|g| map_group(g, diags)).collect(),
        entries: c.selection_entries.iter().map(|e| map_entry(e, diags)).collect(),
        force_entries: c.force_entries.iter().map(map_force).collect(),
        catalogue_links: c.catalogue_links.iter()
            .map(|l| RawCatalogueLink { target_id: l.target_id.clone(), import_root_entries: l.import_root_entries })
            .collect(),
        entry_links: c.entry_links.iter().map(|l| map_entry_link(l, diags)).collect(),
        shared_profiles: map_profiles(&c.shared_profiles),
    }
}

fn map_entry(e: &JsonEntry, diags: &mut Vec<Diagnostic>) -> RawEntry {
    if !e.associations.is_empty() {
        diags.push(Diagnostic {
            code: "entry.associations_dropped".into(),
            message: format!("entry {} associations dropped (unsupported)", e.id),
        });
    }
    RawEntry {
        id: e.id.clone(), name: e.name.clone(), entry_type: e.entry_type.clone(), hidden: e.hidden,
        costs: map_costs(&e.costs),
        category_links: map_category_links(&e.category_links),
        constraints: map_constraints(&e.constraints),
        modifiers: map_modifiers(&e.modifiers, &e.modifier_groups, diags),
        entries: e.selection_entries.iter().map(|c| map_entry(c, diags)).collect(),
        groups: e.selection_entry_groups.iter().map(|g| map_group(g, diags)).collect(),
        entry_links: e.entry_links.iter().map(|l| map_entry_link(l, diags)).collect(),
        profiles: map_profiles(&e.profiles),
        info_links: map_info_links(&e.info_links),
    }
}

fn map_group(g: &JsonGroup, diags: &mut Vec<Diagnostic>) -> RawGroup {
    RawGroup {
        id: g.id.clone(), name: g.name.clone(),
        default_selection_entry_id: g.default_selection_entry_id.clone(), hidden: g.hidden,
        entries: g.selection_entries.iter().map(|c| map_entry(c, diags)).collect(),
        groups: g.selection_entry_groups.iter().map(|sg| map_group(sg, diags)).collect(),
        entry_links: g.entry_links.iter().map(|l| map_entry_link(l, diags)).collect(),
        constraints: map_constraints(&g.constraints),
        modifiers: map_modifiers(&g.modifiers, &g.modifier_groups, diags),
        profiles: map_profiles(&g.profiles),
        info_links: map_info_links(&g.info_links),
    }
}

fn map_entry_link(l: &JsonEntryLink, diags: &mut Vec<Diagnostic>) -> RawEntryLink {
    RawEntryLink {
        id: l.id.clone(), target_id: l.target_id.clone(), link_type: l.link_type.clone(),
        hidden: l.hidden, modifiers: map_modifiers(&l.modifiers, &l.modifier_groups, diags),
    }
}

fn map_category_links(ls: &[JsonCategoryLink]) -> Vec<RawCategoryLink> {
    ls.iter().map(|l| RawCategoryLink {
        target_id: l.target_id.clone(), primary: l.primary,
        constraints: map_constraints(&l.constraints),
    }).collect()
}

fn map_force(f: &JsonForce) -> RawForce {
    RawForce {
        id: f.id.clone(), name: f.name.clone(),
        constraints: map_constraints(&f.constraints),
        category_links: map_category_links(&f.category_links),
    }
}

/// Rules live at top level (rules/sharedRules) AND nested inside entries/groups/
/// forces. Key by `name` and, when present, also by `alias` — mirroring the XML
/// parser's `read_all_rules` flat capture. Later (non-empty) descriptions win on
/// duplicate keys, matching insertion-order-last semantics of the XML pass.
fn collect_rules(c: &JsonCat, out: &mut BTreeMap<String, String>) {
    for r in c.rules.iter().chain(c.shared_rules.iter()) { insert_rule(r, out); }
    for e in c.shared_selection_entries.iter().chain(c.selection_entries.iter()) {
        collect_rules_entry(e, out);
    }
    for g in &c.shared_selection_entry_groups { collect_rules_group(g, out); }
    for f in &c.force_entries { for r in &f.rules { insert_rule(r, out); } }
}
fn insert_rule(r: &JsonRule, out: &mut BTreeMap<String, String>) {
    if r.description.is_empty() { return; }
    if !r.name.is_empty() { out.insert(r.name.clone(), r.description.clone()); }
    for alias in &r.alias {
        if !alias.is_empty() { out.insert(alias.clone(), r.description.clone()); }
    }
}
fn collect_rules_entry(e: &JsonEntry, out: &mut BTreeMap<String, String>) {
    for r in &e.rules { insert_rule(r, out); }
    for c in e.selection_entries.iter() { collect_rules_entry(c, out); }
    for g in &e.selection_entry_groups { collect_rules_group(g, out); }
}
fn collect_rules_group(g: &JsonGroup, out: &mut BTreeMap<String, String>) {
    for r in &g.rules { insert_rule(r, out); }
    for c in g.selection_entries.iter() { collect_rules_entry(c, out); }
    for sg in &g.selection_entry_groups { collect_rules_group(sg, out); }
}

/// Maps BS-JSON profiles to `RawProfile`s, taking each characteristic's value
/// from the `$text` field. Used for entry/group profiles (via `map_entry`/
/// `map_group`) and the catalogue's shared-profile pool (via `map_cat`).
fn map_profiles(ps: &[JsonProfile]) -> Vec<RawProfile> {
    ps.iter().map(|p| RawProfile {
        id: p.id.clone(), name: p.name.clone(), type_name: p.type_name.clone(),
        characteristics: p.characteristics.iter()
            .map(|c| RawCharacteristic { name: c.name.clone(), value: c.text.clone() })
            .collect(),
    }).collect()
}

fn map_info_links(ls: &[JsonInfoLink]) -> Vec<RawInfoLink> {
    ls.iter().map(|l| RawInfoLink {
        target_id: l.target_id.clone(), link_type: l.link_type.clone(), hidden: l.hidden,
    }).collect()
}

fn map_costs(cs: &[JsonCost]) -> Vec<RawCost> {
    cs.iter().map(|c| RawCost { type_id: c.type_id.clone(), value: c.value }).collect()
}
fn map_constraints(cs: &[JsonConstraint]) -> Vec<RawConstraint> {
    cs.iter().map(|c| RawConstraint {
        id: c.id.clone(), kind: c.kind.clone(), value: c.value, field: c.field.clone(),
        scope: c.scope.clone(), include_child_selections: c.include_child_selections,
    }).collect()
}
/// BS-JSON encodes a modifier's `value` as bool (field="hidden"), number, or
/// string. RawModifier needs both the numeric value (for cost/limit modifiers)
/// and the raw string (for field="hidden"/"category", parsed downstream in to_ir).
fn modifier_value(v: &serde_json::Value) -> (f64, String) {
    match v {
        serde_json::Value::Bool(b) => (0.0, b.to_string()),
        serde_json::Value::Number(n) => (n.as_f64().unwrap_or(0.0), n.to_string()),
        serde_json::Value::String(s) => (s.parse::<f64>().unwrap_or(0.0), s.clone()),
        _ => (0.0, String::new()),
    }
}
fn map_conditions(cs: &[JsonCondition]) -> Vec<RawCondition> {
    cs.iter().map(|c| RawCondition {
        comparator: c.comparator.clone(), field: c.field.clone(), scope: c.scope.clone(),
        value: c.value, child_id: c.child_id.clone(),
        include_child_selections: c.include_child_selections,
    }).collect()
}
fn map_condition_groups(gs: &[JsonConditionGroup]) -> Vec<RawConditionGroup> {
    gs.iter().map(|g| RawConditionGroup {
        kind: g.kind.clone(),
        conditions: map_conditions(&g.conditions),
        groups: map_condition_groups(&g.condition_groups),
    }).collect()
}
fn map_one_modifier(m: &JsonModifier) -> RawModifier {
    let (value, value_raw) = modifier_value(&m.value);
    RawModifier {
        kind: m.kind.clone(), field: m.field.clone(), value, value_raw,
        conditions: map_conditions(&m.conditions),
        condition_groups: map_condition_groups(&m.condition_groups),
        has_repeats: !m.repeats.is_empty(),
    }
}

/// BS-JSON's `modifierGroups` bundles sibling `modifiers` under a shared
/// `conditions` list (and, rarely, a shared `repeats`). Every modifierGroup
/// observed in real wh40k-11e data uses `"type": "and"`, so — as a faithful
/// but simple first cut — each contained modifier is mapped exactly as a
/// standalone `<modifier>` would be, then the group's own conditions/
/// conditionGroups are appended (ANDed) onto it and the group's `repeats`
/// (if any) ORs into its `has_repeats` flag. The flattened modifiers are
/// appended to the owning entry/group's own `modifiers` list.
fn flatten_modifier_groups(groups: &[JsonModifierGroup], diags: &mut Vec<Diagnostic>) -> Vec<RawModifier> {
    let mut out = Vec::new();
    for g in groups {
        if !g.kind.is_empty() && g.kind != "and" {
            diags.push(Diagnostic {
                code: "modifier_group.non_and_unsupported".into(),
                message: format!("modifier group with type {:?} flattened as AND (unsupported)", g.kind),
            });
        }
        let group_conditions = map_conditions(&g.conditions);
        let group_condition_groups = map_condition_groups(&g.condition_groups);
        let group_has_repeats = !g.repeats.is_empty();
        for m in &g.modifiers {
            let mut rm = map_one_modifier(m);
            rm.conditions.extend(group_conditions.iter().cloned());
            rm.condition_groups.extend(group_condition_groups.iter().cloned());
            rm.has_repeats = rm.has_repeats || group_has_repeats;
            out.push(rm);
        }
    }
    out
}

fn map_modifiers(ms: &[JsonModifier], groups: &[JsonModifierGroup], diags: &mut Vec<Diagnostic>) -> Vec<RawModifier> {
    let mut out: Vec<RawModifier> = ms.iter().map(map_one_modifier).collect();
    out.extend(flatten_modifier_groups(groups, diags));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn map_profiles_uses_text_as_value() {
        let p = JsonProfile {
            id: "p".into(), name: "U".into(), type_name: "Unit".into(),
            characteristics: vec![JsonCharacteristic { name: "InSv".into(), text: "4+".into() }],
        };
        let out = map_profiles(std::slice::from_ref(&p));
        assert_eq!(out[0].characteristics[0].value, "4+");
        assert_eq!(out[0].type_name, "Unit");
    }

    #[test]
    fn modifier_value_handles_bool_number_string() {
        assert_eq!(modifier_value(&serde_json::json!(true)), (0.0, "true".to_string()));
        assert_eq!(modifier_value(&serde_json::json!(3)), (3.0, "3".to_string()));
        assert_eq!(modifier_value(&serde_json::json!("-1")), (-1.0, "-1".to_string()));
        assert_eq!(modifier_value(&serde_json::json!("x2")), (0.0, "x2".to_string()));
    }

    #[test]
    fn alias_null_deserializes_as_empty_vec() {
        let r: JsonRule = serde_json::from_str(
            r#"{"id":"r","name":"N","alias":null,"description":"d"}"#,
        ).unwrap();
        assert!(r.alias.is_empty());
    }

    #[test]
    fn map_modifier_carries_repeats_and_nested_conditions() {
        let m = JsonModifier {
            kind: "set".into(), field: "hidden".into(), value: serde_json::json!(true),
            conditions: vec![JsonCondition { comparator: "instanceOf".into(), field: "selections".into(),
                scope: "roster".into(), value: 1.0, child_id: "x".into(), include_child_selections: true }],
            condition_groups: vec![], repeats: vec![serde_json::json!({})],
        };
        let out = map_modifiers(std::slice::from_ref(&m), &[], &mut Vec::new());
        assert_eq!((out[0].kind.as_str(), out[0].value, out[0].value_raw.as_str()), ("set", 0.0, "true"));
        assert!(out[0].has_repeats);
        assert_eq!(out[0].conditions[0].comparator, "instanceOf");
        assert_eq!(out[0].conditions[0].child_id, "x");
    }
}
