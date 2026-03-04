-- Silver Layer: Cleaned product catalog
CREATE TABLE silver.stg_products AS
SELECT
    p.product_id,
    TRIM(p.product_name) AS product_name,
    TRIM(p.product_description) AS product_description,
    p.category_id,
    p.brand_id,
    UPPER(p.sku) AS sku,
    p.unit_price,
    p.cost_price,
    COALESCE(p.stock_quantity, 0) AS stock_quantity,
    COALESCE(p.reorder_level, 10) AS reorder_level,
    p.is_active,
    p.created_at,
    p.updated_at
FROM bronze.raw_products p
WHERE p.product_id IS NOT NULL
  AND p.product_name IS NOT NULL
  AND p.is_deleted = false
  AND p.unit_price >= 0
QUALIFY ROW_NUMBER() OVER (PARTITION BY p.product_id ORDER BY p.updated_at DESC) = 1
