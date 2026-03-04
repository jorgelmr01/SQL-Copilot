-- Bronze Layer: Raw customer addresses
CREATE TABLE bronze.raw_addresses AS
SELECT
    address_id,
    customer_id,
    address_type,
    address_line1,
    address_line2,
    city,
    state,
    country,
    postal_code,
    is_primary,
    valid_from,
    valid_to,
    created_at,
    updated_at,
    _ingestion_timestamp
FROM source_systems.crm_addresses
WHERE _ingestion_timestamp >= CURRENT_DATE - INTERVAL '1' DAY
