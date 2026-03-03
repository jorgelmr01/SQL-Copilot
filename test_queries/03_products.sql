-- Sample: Products dimension table
SELECT
    product_id,
    product_name,
    product_description,
    category_id,
    brand_id,
    unit_price,
    cost_price,
    stock_quantity,
    is_active,
    created_at,
    updated_at
FROM raw.products
WHERE is_deleted = false
