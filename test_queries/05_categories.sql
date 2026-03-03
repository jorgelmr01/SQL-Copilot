-- Sample: Categories dimension with hierarchy
CREATE VIEW silver.dim_categories AS
SELECT
    cat.category_id,
    cat.category_name,
    cat.parent_category_id,
    parent.category_name AS parent_category_name,
    cat.description,
    cat.is_active
FROM raw.categories cat
LEFT JOIN raw.categories parent ON cat.parent_category_id = parent.category_id
