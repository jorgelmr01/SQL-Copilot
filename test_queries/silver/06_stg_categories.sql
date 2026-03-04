-- Silver Layer: Cleaned product categories with hierarchy
CREATE TABLE silver.stg_categories AS
SELECT
    c.category_id,
    TRIM(c.category_name) AS category_name,
    c.parent_category_id,
    c.category_level,
    c.category_path,
    TRIM(c.description) AS description,
    c.display_order,
    c.is_active,
    c.created_at,
    c.updated_at
FROM bronze.raw_categories c
WHERE c.category_id IS NOT NULL
  AND c.category_name IS NOT NULL
  AND c.is_active = true
QUALIFY ROW_NUMBER() OVER (PARTITION BY c.category_id ORDER BY c.updated_at DESC) = 1
