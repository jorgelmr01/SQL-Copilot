-- Bronze Layer: Raw product categories with hierarchy
CREATE TABLE bronze.raw_categories AS
SELECT
    category_id,
    category_name,
    parent_category_id,
    category_level,
    category_path,
    description,
    display_order,
    is_active,
    created_at,
    updated_at,
    _ingestion_timestamp
FROM source_systems.product_categories
WHERE _ingestion_timestamp >= CURRENT_DATE - INTERVAL '1' DAY
