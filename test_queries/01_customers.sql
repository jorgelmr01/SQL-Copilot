-- Gold Layer: Customer dimension with SCD Type 2 for address changes
-- Business-ready dimension for analytics and reporting
CREATE TABLE gold.dim_customers AS
SELECT
    c.customer_id,
    c.first_name,
    c.last_name,
    c.first_name || ' ' || c.last_name AS full_name,
    c.email,
    c.phone,
    -- Primary address attributes
    a.address_line1,
    a.address_line2,
    a.city,
    a.state,
    a.country,
    a.postal_code,
    -- Derived business attributes
    CASE 
        WHEN DATEDIFF('year', c.created_at, CURRENT_DATE) >= 5 THEN 'Loyal'
        WHEN DATEDIFF('year', c.created_at, CURRENT_DATE) >= 1 THEN 'Regular'
        ELSE 'New'
    END AS customer_segment,
    c.is_active,
    c.created_at AS customer_since,
    c.updated_at AS last_updated,
    CURRENT_TIMESTAMP AS dim_created_at,
    CURRENT_TIMESTAMP AS dim_updated_at
FROM silver.stg_customers c
LEFT JOIN silver.stg_addresses a 
    ON c.customer_id = a.customer_id 
    AND a.is_primary = true
WHERE c.is_active = true
