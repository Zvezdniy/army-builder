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
struct JsonRule { id: String, name: String, alias: String, description: String }

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonEntry {
    id: String, name: String, #[serde(rename = "type")] entry_type: String, hidden: bool,
    costs: Vec<JsonCost>, category_links: Vec<JsonCategoryLink>,
    constraints: Vec<JsonConstraint>, modifiers: Vec<JsonModifier>,
    selection_entries: Vec<JsonEntry>, selection_entry_groups: Vec<JsonGroup>,
    entry_links: Vec<JsonEntryLink>, profiles: Vec<JsonProfile>,
    rules: Vec<JsonRule>, associations: Vec<serde_json::Value>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonGroup {
    id: String, name: String, default_selection_entry_id: String, hidden: bool,
    selection_entries: Vec<JsonEntry>, selection_entry_groups: Vec<JsonGroup>,
    entry_links: Vec<JsonEntryLink>, constraints: Vec<JsonConstraint>,
    modifiers: Vec<JsonModifier>, profiles: Vec<JsonProfile>, rules: Vec<JsonRule>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonEntryLink {
    id: String, target_id: String, #[serde(rename = "type")] link_type: String,
    hidden: bool, modifiers: Vec<JsonModifier>,
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
pub fn parse_raw_json(bytes: &[u8], _diags: &mut Vec<Diagnostic>) -> Result<RawCatalogue, ParseError> {
    let root: JsonRoot = serde_json::from_slice(bytes)
        .map_err(|e| ParseError::Io(format!("invalid catalogue JSON: {e}")))?;
    let cat = root.catalogue.or(root.game_system)
        .ok_or_else(|| ParseError::Io("JSON has neither `catalogue` nor `gameSystem`".into()))?;
    Ok(map_cat(cat))
}

fn map_cat(c: JsonCat) -> RawCatalogue {
    RawCatalogue {
        id: c.id,
        name: c.name,
        revision: c.revision,
        game_system_id: c.game_system_id,
        ..Default::default()
    }
}
