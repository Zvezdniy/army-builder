use serde::Serialize;
use std::collections::BTreeMap;

fn is_false(b: &bool) -> bool {
    !*b
}

fn is_self(s: &str) -> bool {
    s == "self"
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IrCatalogue {
    pub id: String,
    pub name: String,
    pub game_system_id: String,
    pub revision: i64,
    pub entries: Vec<IrEntry>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub force_constraints: Vec<IrConstraint>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub category_names: BTreeMap<String, String>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub rule_texts: BTreeMap<String, String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IrEntry {
    pub id: String,
    pub name: String,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub entry_type: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub costs: Vec<IrCost>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub categories: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub constraints: Vec<IrConstraint>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<IrEntry>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub groups: Vec<IrGroup>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub profiles: Vec<IrProfile>,
    #[serde(skip_serializing_if = "is_false")]
    pub hidden: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub visibility_modifiers: Vec<IrVisibilityModifier>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub validation_rules: Vec<IrValidationRule>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub category_modifiers: Vec<IrCategoryModifier>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IrGroup {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_member_entry_id: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub member_entry_ids: Vec<String>,
    /// Transitive closure of member entry ids over this group and all nested
    /// sub-groups (⊇ member_entry_ids). The set engine-eval counts a group's
    /// selections limit over — see map_group / groups.ts.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub descendant_entry_ids: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub constraints: Vec<IrGroupConstraint>,
}

#[derive(Debug, Serialize)]
pub struct IrGroupConstraint {
    pub id: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub value: f64,
    #[serde(skip_serializing_if = "is_self")]
    pub scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modifiers: Option<Vec<IrModifier>>,
}

#[derive(Debug, Serialize)]
pub struct IrCost {
    pub name: String,
    pub value: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modifiers: Option<Vec<IrModifier>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IrConstraint {
    pub id: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub value: f64,
    pub field: String,
    pub scope: String,
    pub target_type: String,
    pub target_id: String,
    pub include_child_selections: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modifiers: Option<Vec<IrModifier>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IrModifier {
    pub id: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub value: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conditions: Option<Vec<IrCondition>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condition_groups: Option<Vec<IrConditionGroup>>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IrVisibilityModifier {
    pub set: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conditions: Option<Vec<IrCondition>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condition_groups: Option<Vec<IrConditionGroup>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IrValidationRule {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conditions: Option<Vec<IrCondition>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condition_groups: Option<Vec<IrConditionGroup>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IrCategoryModifier {
    #[serde(rename = "type")]
    pub type_: String,
    pub category_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conditions: Option<Vec<IrCondition>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condition_groups: Option<Vec<IrConditionGroup>>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IrCondition {
    pub id: String,
    pub comparator: String,
    pub value: f64,
    pub field: String,
    pub scope: String,
    pub target_type: String,
    pub target_id: String,
    pub include_child_selections: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IrConditionGroup {
    #[serde(rename = "type")]
    pub type_: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conditions: Option<Vec<IrCondition>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condition_groups: Option<Vec<IrConditionGroup>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IrProfile {
    pub name: String,
    pub type_name: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub characteristics: Vec<IrCharacteristic>,
}

#[derive(Debug, Serialize)]
pub struct IrCharacteristic {
    pub name: String,
    pub value: String,
}
