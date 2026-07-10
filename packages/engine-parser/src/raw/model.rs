use std::collections::HashMap;

#[derive(Debug, Default)]
pub struct RawCatalogue {
    pub id: String,
    pub name: String,
    pub revision: i64,
    pub game_system_id: Option<String>,
    pub cost_types: HashMap<String, String>,   // id -> name
    pub categories: HashMap<String, String>,   // id -> name
    pub shared_entries: Vec<RawEntry>,         // filled in Task 6
    pub shared_groups: Vec<RawGroup>,          // filled in Task 6
    pub entries: Vec<RawEntry>,                // filled in Task 6
    pub force_entries: Vec<RawForce>,          // filled in Task 6/11
    pub catalogue_links: Vec<RawCatalogueLink>,// filled in Task 9
}

#[derive(Debug, Default, Clone)]
pub struct RawEntry {
    pub id: String,
    pub name: String,
    pub entry_type: String,           // unit|model|upgrade
    pub costs: Vec<RawCost>,
    pub category_links: Vec<RawCategoryLink>,
    pub constraints: Vec<RawConstraint>,
    pub modifiers: Vec<RawModifier>,
    pub entries: Vec<RawEntry>,        // nested selectionEntries
    pub groups: Vec<RawGroup>,         // nested selectionEntryGroups
    pub entry_links: Vec<RawEntryLink>,
}

#[derive(Debug, Default, Clone)] pub struct RawGroup {
    pub id: String, pub name: String,
    pub entries: Vec<RawEntry>, pub groups: Vec<RawGroup>,
    pub entry_links: Vec<RawEntryLink>, pub constraints: Vec<RawConstraint>,
    pub modifiers: Vec<RawModifier>,
}
#[derive(Debug, Default, Clone)] pub struct RawCost { pub type_id: String, pub value: f64 }
#[derive(Debug, Default, Clone)] pub struct RawCategoryLink { pub target_id: String, pub primary: bool, pub constraints: Vec<RawConstraint> }
#[derive(Debug, Default, Clone)] pub struct RawEntryLink { pub target_id: String, pub link_type: String }
#[derive(Debug, Default, Clone)] pub struct RawForce { pub id: String, pub name: String, pub constraints: Vec<RawConstraint>, pub category_links: Vec<RawCategoryLink> }
#[derive(Debug, Default, Clone)] pub struct RawCatalogueLink { pub target_id: String, pub import_root_entries: bool }

#[derive(Debug, Default, Clone)]
pub struct RawConstraint {
    pub id: String, pub kind: String,     // min|max
    pub value: f64, pub field: String,    // selections | <costTypeId>
    pub scope: String,                    // parent|force|roster|self|<id>
    pub include_child_selections: bool,
}
#[derive(Debug, Default, Clone)]
pub struct RawModifier {
    pub kind: String,                     // set|increment|decrement
    pub field: String, pub value: f64,
    pub conditions: Vec<RawCondition>,
    pub condition_groups: Vec<RawConditionGroup>,
    pub has_repeats: bool,                // if true, emit diagnostic in mapping
}
#[derive(Debug, Default, Clone)]
pub struct RawCondition {
    pub comparator: String, pub field: String, pub scope: String,
    pub value: f64, pub child_id: String, pub include_child_selections: bool,
}
#[derive(Debug, Default, Clone)]
pub struct RawConditionGroup { pub kind: String, pub conditions: Vec<RawCondition>, pub groups: Vec<RawConditionGroup> }
