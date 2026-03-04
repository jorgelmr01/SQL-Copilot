-- Bronze Layer: Raw order line items
CREATE TABLE bronze.raw_order_items AS
SELECT
    order_item_id,
    order_id,
    product_id,
    quantity,
    unit_price,
    discount_percentage,
    line_total,
    tax_amount,
    created_at,
    _ingestion_timestamp
FROM source_systems.ecommerce_order_items
WHERE _ingestion_timestamp >= CURRENT_DATE - INTERVAL '1' DAY
