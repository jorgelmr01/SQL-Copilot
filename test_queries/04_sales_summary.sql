-- Gold Layer: Sales summary aggregation - monthly rollup by geography and category
-- Aggregated fact table for executive dashboards
CREATE TABLE gold.fact_sales_summary AS
SELECT
    DATE_TRUNC('month', o.order_date) AS month,
    EXTRACT(year FROM o.order_date) AS year,
    EXTRACT(quarter FROM o.order_date) AS quarter,
    c.country,
    c.state,
    c.customer_segment,
    p.category_id,
    p.category_name,
    p.parent_category_name,
    -- Aggregated measures
    COUNT(DISTINCT o.order_id) AS order_count,
    COUNT(DISTINCT o.customer_id) AS customer_count,
    COUNT(DISTINCT o.product_id) AS product_count,
    SUM(o.order_total_amount) AS total_revenue,
    SUM(o.order_discount_amount) AS total_discounts,
    SUM(o.order_net_amount) AS total_net_revenue,
    SUM(o.gross_profit) AS total_gross_profit,
    AVG(o.order_total_amount) AS avg_order_value,
    AVG(o.profit_margin) AS avg_profit_margin,
    SUM(o.quantity) AS total_units_sold,
    -- Period over period metrics
    CURRENT_TIMESTAMP AS fact_created_at
FROM gold.fact_orders o
LEFT JOIN gold.dim_customers c ON o.customer_id = c.customer_id
LEFT JOIN gold.dim_products p ON o.product_id = p.product_id
WHERE o.order_date >= DATE '2024-01-01'
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9
