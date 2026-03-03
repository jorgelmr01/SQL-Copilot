-- Sample: Customers dimension table
CREATE TABLE gold.dim_customers AS
SELECT
    c.customer_id,
    c.first_name,
    c.last_name,
    c.email,
    c.phone,
    c.created_at,
    a.address_line1,
    a.city,
    a.state,
    a.country,
    a.postal_code
FROM silver.stg_customers c
LEFT JOIN silver.stg_addresses a ON c.customer_id = a.customer_id
WHERE c.is_active = true
