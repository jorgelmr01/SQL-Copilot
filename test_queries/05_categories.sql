-- Gold Layer: Categories dimension with full hierarchy path
-- Self-referencing hierarchy for product categorization
CREATE TABLE gold.dim_categories AS
SELECT
    cat.category_id,
    cat.category_name,
    cat.parent_category_id,
    parent.category_name AS parent_category_name,
    cat.category_level,
    cat.category_path,
    cat.description,
    cat.display_order,
    -- Hierarchy flags
    CASE WHEN cat.parent_category_id IS NULL THEN true ELSE false END AS is_root_category,
    CASE WHEN cat.category_level = 1 THEN true ELSE false END AS is_top_level,
    cat.is_active,
    cat.created_at,
    cat.updated_at,
    CURRENT_TIMESTAMP AS dim_created_at
FROM silver.stg_categories cat
LEFT JOIN silver.stg_categories parent ON cat.parent_category_id = parent.category_id
WHERE cat.is_active = true
