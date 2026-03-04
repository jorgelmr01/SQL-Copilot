-- Gold Layer: Orders fact table - grain is order line item
-- Contains all order transactions with product details for sales analysis
CREATE TABLE gold.fact_orders AS
SELECT
    -- Fact grain: order_id + product_id (line item level)
    oi.order_item_id,
    o.order_id,
    o.customer_id,
    o.order_date,
    DATE_TRUNC('month', o.order_date) AS order_month,
    DATE_TRUNC('quarter', o.order_date) AS order_quarter,
    EXTRACT(year FROM o.order_date) AS order_year,
    o.status,
    -- Product foreign keys
    oi.product_id,
    p.product_name,
    p.category_id,
    p.brand_id,
    -- Measures - order level
    o.total_amount AS order_total_amount,
    o.discount_amount AS order_discount_amount,
    o.shipping_amount AS order_shipping_amount,
    o.tax_amount AS order_tax_amount,
    o.net_amount AS order_net_amount,
    -- Measures - line item level
    oi.quantity,
    oi.unit_price,
    oi.discount_percentage,
    oi.line_total,
    oi.tax_amount AS line_tax_amount,
    oi.total_with_tax AS line_total_with_tax,
    -- Derived measures
    oi.line_total - (p.cost_price * oi.quantity) AS gross_profit,
    CASE 
        WHEN oi.line_total > 0 THEN (oi.line_total - (p.cost_price * oi.quantity)) / oi.line_total 
        ELSE 0 
    END AS profit_margin,
    o.created_at,
    CURRENT_TIMESTAMP AS fact_created_at
FROM silver.stg_orders o
INNER JOIN silver.stg_order_items oi ON o.order_id = oi.order_id
LEFT JOIN silver.stg_products p ON oi.product_id = p.product_id
WHERE o.order_date >= DATE '2024-01-01'
  AND o.status IN ('COMPLETED', 'SHIPPED', 'DELIVERED')
