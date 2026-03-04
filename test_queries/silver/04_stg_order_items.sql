-- Silver Layer: Cleaned order line items
CREATE TABLE silver.stg_order_items AS
SELECT
    oi.order_item_id,
    oi.order_id,
    oi.product_id,
    oi.quantity,
    oi.unit_price,
    COALESCE(oi.discount_percentage, 0) AS discount_percentage,
    oi.line_total,
    COALESCE(oi.tax_amount, 0) AS tax_amount,
    oi.line_total + COALESCE(oi.tax_amount, 0) AS total_with_tax,
    oi.created_at
FROM bronze.raw_order_items oi
WHERE oi.order_id IS NOT NULL
  AND oi.product_id IS NOT NULL
  AND oi.quantity > 0
  AND oi.unit_price >= 0
QUALIFY ROW_NUMBER() OVER (PARTITION BY oi.order_item_id ORDER BY oi.created_at DESC) = 1
