-- Silver Layer: Cleaned and standardized customers
-- Business rules applied: data quality checks, standardization, deduplication
CREATE TABLE silver.stg_customers AS
SELECT
    customer_id,
    TRIM(UPPER(first_name)) AS first_name,
    TRIM(UPPER(last_name)) AS last_name,
    LOWER(TRIM(email)) AS email,
    REGEXP_REPLACE(phone, '[^0-9]', '') AS phone,
    date_of_birth,
    registration_date,
    CASE 
        WHEN customer_status = 'active' THEN true
        WHEN customer_status = 'inactive' THEN false
        ELSE is_active
    END AS is_active,
    created_at,
    updated_at
FROM bronze.raw_customers
WHERE email IS NOT NULL 
  AND email LIKE '%@%'
  AND customer_id IS NOT NULL
QUALIFY ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY updated_at DESC) = 1
