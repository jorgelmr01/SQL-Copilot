-- Gold Layer: Products dimension with category enrichment
-- Denormalized product catalog for fast analytics queries
CREATE TABLE gold.dim_products AS
SELECT
    p.product_id,
    p.product_name,
    p.product_description,
    p.sku,
    -- Category attributes (denormalized from dim_categories)
    p.category_id,
    c.category_name,
    c.parent_category_id,
    pc.category_name AS parent_category_name,
    -- Brand attributes
    p.brand_id,
    -- Pricing and inventory
    p.unit_price,
    p.cost_price,
    p.unit_price - p.cost_price AS unit_profit,
    CASE 
        WHEN p.unit_price > 0 THEN (p.unit_price - p.cost_price) / p.unit_price
        ELSE 0
    END AS profit_margin_pct,
    p.stock_quantity,
    p.reorder_level,
    CASE 
        WHEN p.stock_quantity <= 0 THEN 'Out of Stock'
        WHEN p.stock_quantity <= p.reorder_level THEN 'Low Stock'
        ELSE 'In Stock'
    END AS stock_status,
    -- Flags
    p.is_active,
    p.created_at,
    p.updated_at,
    CURRENT_TIMESTAMP AS dim_created_at
FROM silver.stg_products p
LEFT JOIN silver.stg_categories c ON p.category_id = c.category_id
LEFT JOIN silver.stg_categories pc ON c.parent_category_id = pc.category_id
WHERE p.is_active = true
