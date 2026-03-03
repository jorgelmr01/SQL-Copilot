-- Sample: CTE with multiple levels
WITH customer_totals AS (
    SELECT
        customer_id,
        COUNT(*) AS total_orders,
        SUM(total_amount) AS lifetime_value,
        MIN(order_date) AS first_order_date,
        MAX(order_date) AS last_order_date
    FROM gold.fact_orders
    GROUP BY customer_id
),
customer_segments AS (
    SELECT
        customer_id,
        total_orders,
        lifetime_value,
        first_order_date,
        last_order_date,
        CASE 
            WHEN lifetime_value >= 10000 THEN 'VIP'
            WHEN lifetime_value >= 1000 THEN 'Regular'
            ELSE 'New'
        END AS segment
    FROM customer_totals
)
SELECT
    c.customer_id,
    c.first_name,
    c.last_name,
    c.email,
    cs.total_orders,
    cs.lifetime_value,
    cs.segment,
    cs.first_order_date,
    cs.last_order_date
FROM gold.dim_customers c
INNER JOIN customer_segments cs ON c.customer_id = cs.customer_id
