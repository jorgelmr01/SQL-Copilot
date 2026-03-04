-- Bronze Layer: Raw product catalog
CREATE TABLE bronze.raw_products AS
SELECT
    product_id,
    product_name,
    product_description,
    category_id,
    brand_id,
    sku,
    unit_price,
    cost_price,
    stock_quantity,
    reorder_level,
    is_active,
    is_deleted,
    created_at,
    updated_at,
    _ingestion_timestamp
FROM source_systems.product_catalog
WHERE _ingestion_timestamp >= CURRENT_DATE - INTERVAL '1' DAY
