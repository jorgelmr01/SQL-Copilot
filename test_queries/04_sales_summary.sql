-- Sample: Sales summary aggregation
SELECT
    DATE_TRUNC('month', o.order_date) AS month,
    c.country,
    p.category_id,
    COUNT(DISTINCT o.order_id) AS order_count,
    COUNT(DISTINCT o.customer_id) AS customer_count,
    SUM(o.total_amount) AS total_revenue,
    SUM(o.discount_amount) AS total_discounts,
    AVG(o.total_amount) AS avg_order_value
FROM gold.fact_orders o
LEFT JOIN gold.dim_customers c ON o.customer_id = c.customer_id
LEFT JOIN silver.stg_products p ON o.product_id = p.product_id
GROUP BY 1, 2, 3
