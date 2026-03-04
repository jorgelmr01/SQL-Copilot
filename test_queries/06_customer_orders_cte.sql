-- Gold Layer: Customer lifetime value analysis with RFM segmentation
-- Uses CTEs to calculate customer metrics for marketing campaigns
CREATE TABLE gold.dim_customer_lifetime_value AS
WITH customer_order_totals AS (
    SELECT
        customer_id,
        COUNT(DISTINCT order_id) AS total_orders,
        SUM(order_total_amount) AS lifetime_value,
        SUM(order_net_amount) AS lifetime_net_value,
        SUM(gross_profit) AS lifetime_profit,
        MIN(order_date) AS first_order_date,
        MAX(order_date) AS last_order_date,
        AVG(order_total_amount) AS avg_order_value,
        AVG(DATEDIFF('day', LAG(order_date) OVER (PARTITION BY customer_id ORDER BY order_date), order_date)) AS avg_days_between_orders
    FROM gold.fact_orders
    GROUP BY customer_id
),
customer_rfm AS (
    SELECT
        customer_id,
        total_orders,
        lifetime_value,
        lifetime_net_value,
        lifetime_profit,
        first_order_date,
        last_order_date,
        avg_order_value,
        avg_days_between_orders,
        DATEDIFF('day', last_order_date, CURRENT_DATE) AS days_since_last_order,
        -- RFM Segmentation
        CASE 
            WHEN DATEDIFF('day', last_order_date, CURRENT_DATE) <= 30 THEN 'High'
            WHEN DATEDIFF('day', last_order_date, CURRENT_DATE) <= 90 THEN 'Medium'
            ELSE 'Low'
        END AS recency_score,
        CASE 
            WHEN total_orders >= 10 THEN 'High'
            WHEN total_orders >= 5 THEN 'Medium'
            ELSE 'Low'
        END AS frequency_score,
        CASE 
            WHEN lifetime_value >= 10000 THEN 'High'
            WHEN lifetime_value >= 1000 THEN 'Medium'
            ELSE 'Low'
        END AS monetary_score,
        -- Overall segment
        CASE 
            WHEN lifetime_value >= 10000 AND total_orders >= 10 THEN 'VIP'
            WHEN lifetime_value >= 5000 AND total_orders >= 5 THEN 'Loyal'
            WHEN lifetime_value >= 1000 THEN 'Regular'
            WHEN DATEDIFF('month', first_order_date, CURRENT_DATE) <= 6 THEN 'New'
            ELSE 'At Risk'
        END AS customer_segment
    FROM customer_order_totals
)
SELECT
    c.customer_id,
    c.first_name,
    c.last_name,
    c.full_name,
    c.email,
    c.phone,
    c.country,
    c.state,
    c.customer_segment AS demographic_segment,
    -- RFM attributes
    rfm.total_orders,
    rfm.lifetime_value,
    rfm.lifetime_net_value,
    rfm.lifetime_profit,
    rfm.avg_order_value,
    rfm.first_order_date,
    rfm.last_order_date,
    rfm.days_since_last_order,
    rfm.avg_days_between_orders,
    rfm.recency_score,
    rfm.frequency_score,
    rfm.monetary_score,
    rfm.customer_segment AS ltv_segment,
    -- Flags
    CASE WHEN rfm.days_since_last_order > 180 THEN true ELSE false END AS is_churned,
    CASE WHEN rfm.customer_segment = 'VIP' THEN true ELSE false END AS is_vip,
    CURRENT_TIMESTAMP AS dim_created_at
FROM gold.dim_customers c
INNER JOIN customer_rfm rfm ON c.customer_id = rfm.customer_id
