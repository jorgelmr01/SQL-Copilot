-- Bronze Layer: Raw orders from transactional system
CREATE TABLE bronze.raw_orders AS
SELECT
    order_id,
    customer_id,
    order_date,
    order_status,
    total_amount,
    discount_amount,
    shipping_amount,
    tax_amount,
    payment_method,
    shipping_address_id,
    billing_address_id,
    created_at,
    updated_at,
    _ingestion_timestamp
FROM source_systems.ecommerce_orders
WHERE _ingestion_timestamp >= CURRENT_DATE - INTERVAL '1' DAY
