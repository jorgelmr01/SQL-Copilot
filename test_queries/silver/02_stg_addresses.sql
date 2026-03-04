-- Silver Layer: Cleaned customer addresses
CREATE TABLE silver.stg_addresses AS
SELECT
    address_id,
    customer_id,
    address_type,
    TRIM(address_line1) AS address_line1,
    TRIM(address_line2) AS address_line2,
    TRIM(UPPER(city)) AS city,
    TRIM(UPPER(state)) AS state,
    TRIM(UPPER(country)) AS country,
    UPPER(REPLACE(postal_code, ' ', '')) AS postal_code,
    is_primary,
    COALESCE(valid_from, created_at) AS valid_from,
    valid_to,
    created_at,
    updated_at
FROM bronze.raw_addresses
WHERE customer_id IS NOT NULL
  AND address_line1 IS NOT NULL
  AND city IS NOT NULL
  AND country IS NOT NULL
QUALIFY ROW_NUMBER() OVER (PARTITION BY address_id ORDER BY updated_at DESC) = 1
