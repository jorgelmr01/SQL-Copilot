-- Sample: Orders fact table
CREATE TABLE gold.fact_orders AS
SELECT
    o.order_id,
    o.customer_id,
    o.order_date,
    o.status,
    o.total_amount,
    o.discount_amount,
    o.shipping_amount,
    o.tax_amount,
    o.net_amount,
    p.product_id,
    p.product_name,
    p.category_id,
    oi.quantity,
    oi.unit_price,
    oi.line_total
FROM silver.stg_orders o
INNER JOIN silver.stg_order_items oi ON o.order_id = oi.order_id
LEFT JOIN silver.stg_products p ON oi.product_id = p.product_id
WHERE o.order_date >= DATE '2024-01-01'
