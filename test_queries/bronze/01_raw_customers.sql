-- Bronze Layer: Raw customers from source system
-- Represents unprocessed data from operational database
CREATE TABLE bronze.raw_customers AS
SELECT
    customer_id,
    first_name,
    last_name,
    email,
    phone,
    date_of_birth,
    registration_date,
    customer_status,
    source_system,
    is_active,
    created_at,
    updated_at,
    _ingestion_timestamp
FROM source_systems.crm_customers
WHERE _ingestion_timestamp >= CURRENT_DATE - INTERVAL '1' DAY
