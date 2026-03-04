-- Silver Layer: Cleaned and validated orders
CREATE TABLE silver.stg_orders AS
SELECT
    o.order_id,
    o.customer_id,
    o.order_date,
    UPPER(o.order_status) AS status,
    o.total_amount,
    COALESCE(o.discount_amount, 0) AS discount_amount,
    COALESCE(o.shipping_amount, 0) AS shipping_amount,
    COALESCE(o.tax_amount, 0) AS tax_amount,
    o.total_amount - COALESCE(o.discount_amount, 0) AS net_amount,
    o.payment_method,
    o.created_at,
    o.updated_at
FROM bronze.raw_orders o
WHERE o.customer_id IS NOT NULL
  AND o.order_date IS NOT NULL
  AND o.total_amount >= 0
QUALIFY ROW_NUMBER() OVER (PARTITION BY o.order_id ORDER BY o.updated_at DESC) = 1
