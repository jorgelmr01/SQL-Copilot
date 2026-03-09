// SQL Template Library for Data Scientists
// Pre-built SQL patterns for common data engineering tasks

const SQLTemplates = {
  // Incremental Load Templates
  incremental: {
    dailyLoad: {
      name: 'Daily Incremental Load',
      description: 'Load only new/changed records since last run',
      category: 'ETL',
      dialect: 'presto',
      template: `-- Daily Incremental Load Pattern
CREATE TABLE {{target_schema}}.{{target_table}} AS
SELECT *
FROM {{source_schema}}.{{source_table}}
WHERE {{timestamp_column}} >= (
  SELECT COALESCE(MAX({{timestamp_column}}), DATE '1900-01-01')
  FROM {{target_schema}}.{{target_table}}
)
AND {{timestamp_column}} < CURRENT_DATE;`,
      variables: ['target_schema', 'target_table', 'source_schema', 'source_table', 'timestamp_column']
    },
    
    mergeUpsert: {
      name: 'MERGE Upsert Pattern',
      description: 'Insert new records and update existing ones',
      category: 'ETL',
      dialect: 'presto',
      template: `-- MERGE Upsert Pattern
MERGE INTO {{target_table}} t
USING {{source_table}} s
ON t.{{primary_key}} = s.{{primary_key}}
WHEN MATCHED THEN
  UPDATE SET
    {{update_columns}}
WHEN NOT MATCHED THEN
  INSERT ({{insert_columns}})
  VALUES ({{insert_values}});`,
      variables: ['target_table', 'source_table', 'primary_key', 'update_columns', 'insert_columns', 'insert_values']
    }
  },
  
  // Slowly Changing Dimension Templates
  scd: {
    type1: {
      name: 'SCD Type 1: Overwrite',
      description: 'Simple overwrite of dimension attributes',
      category: 'Dimensional Modeling',
      dialect: 'presto',
      template: `-- SCD Type 1: Overwrite existing records
UPDATE {{dim_table}}
SET 
  {{attribute_columns}},
  updated_at = CURRENT_TIMESTAMP
WHERE {{natural_key}} IN (
  SELECT {{natural_key}}
  FROM {{source_table}}
);`,
      variables: ['dim_table', 'attribute_columns', 'natural_key', 'source_table']
    },
    
    type2: {
      name: 'SCD Type 2: Track History',
      description: 'Maintain historical versions with effective dates',
      category: 'Dimensional Modeling',
      dialect: 'presto',
      template: `-- SCD Type 2: Historical Tracking
-- Step 1: Expire current records that have changes
UPDATE {{dim_table}} 
SET 
  is_current = false,
  valid_to = CURRENT_TIMESTAMP
WHERE {{natural_key}} IN (
  SELECT {{natural_key}}
  FROM {{source_table}} s
  WHERE EXISTS (
    SELECT 1
    FROM {{dim_table}} d
    WHERE d.{{natural_key}} = s.{{natural_key}}
      AND d.is_current = true
      AND ({{change_detection_columns}})
  )
)
AND is_current = true;

-- Step 2: Insert new versions
INSERT INTO {{dim_table}} (
  {{natural_key}},
  {{attribute_columns}},
  valid_from,
  valid_to,
  is_current
)
SELECT 
  {{natural_key}},
  {{attribute_columns}},
  CURRENT_TIMESTAMP as valid_from,
  NULL as valid_to,
  true as is_current
FROM {{source_table}}
WHERE {{natural_key}} IN (
  SELECT {{natural_key}}
  FROM {{source_table}} s
  WHERE EXISTS (
    SELECT 1
    FROM {{dim_table}} d
    WHERE d.{{natural_key}} = s.{{natural_key}}
      AND d.is_current = true
      AND ({{change_detection_columns}})
  )
  OR NOT EXISTS (
    SELECT 1
    FROM {{dim_table}} d
    WHERE d.{{natural_key}} = s.{{natural_key}}
  )
);`,
      variables: ['dim_table', 'natural_key', 'attribute_columns', 'source_table', 'change_detection_columns']
    }
  },
  
  // Data Quality Templates
  quality: {
    deduplication: {
      name: 'Deduplication with QUALIFY',
      description: 'Remove duplicate records keeping the latest',
      category: 'Data Quality',
      dialect: 'presto',
      template: `-- Deduplication Pattern
SELECT {{columns}}
FROM {{source_table}}
WHERE {{filter_conditions}}
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY {{partition_keys}}
  ORDER BY {{order_by_columns}} DESC
) = 1;`,
      variables: ['columns', 'source_table', 'filter_conditions', 'partition_keys', 'order_by_columns']
    },
    
    nullCheck: {
      name: 'NULL Value Detection',
      description: 'Find records with null values in critical columns',
      category: 'Data Quality',
      dialect: 'presto',
      template: `-- NULL Value Detection
SELECT 
  '{{column_name}}' as failed_column,
  COUNT(*) as null_count,
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM {{table_name}}), 2) as null_percentage
FROM {{table_name}}
WHERE {{column_name}} IS NULL

UNION ALL

-- Add more columns to check
SELECT 
  '{{column_name_2}}' as failed_column,
  COUNT(*) as null_count,
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM {{table_name}}), 2) as null_percentage
FROM {{table_name}}
WHERE {{column_name_2}} IS NULL;`,
      variables: ['table_name', 'column_name', 'column_name_2']
    },
    
    dataValidation: {
      name: 'Data Validation Rules',
      description: 'Comprehensive data quality checks',
      category: 'Data Quality',
      dialect: 'presto',
      template: `-- Data Validation Report
WITH validation_checks AS (
  SELECT
    '{{table_name}}' as table_name,
    'row_count' as check_name,
    CAST(COUNT(*) as VARCHAR) as check_value,
    CASE WHEN COUNT(*) > 0 THEN 'PASS' ELSE 'FAIL' END as status
  FROM {{table_name}}
  
  UNION ALL
  
  SELECT
    '{{table_name}}',
    'null_{{pk_column}}',
    CAST(COUNT(*) as VARCHAR),
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM {{table_name}}
  WHERE {{pk_column}} IS NULL
  
  UNION ALL
  
  SELECT
    '{{table_name}}',
    'duplicate_{{pk_column}}',
    CAST(COUNT(*) as VARCHAR),
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM (
    SELECT {{pk_column}}, COUNT(*) as cnt
    FROM {{table_name}}
    GROUP BY {{pk_column}}
    HAVING COUNT(*) > 1
  )
)
SELECT * FROM validation_checks
WHERE status = 'FAIL';`,
      variables: ['table_name', 'pk_column']
    }
  },
  
  // Aggregation Templates
  aggregation: {
    dailyRollup: {
      name: 'Daily Aggregation Rollup',
      description: 'Aggregate metrics by day',
      category: 'Analytics',
      dialect: 'presto',
      template: `-- Daily Aggregation
SELECT
  DATE_TRUNC('day', {{timestamp_column}}) as date,
  {{dimension_columns}},
  COUNT(*) as record_count,
  COUNT(DISTINCT {{unique_key}}) as unique_count,
  SUM({{metric_column}}) as total_{{metric_name}},
  AVG({{metric_column}}) as avg_{{metric_name}},
  MIN({{metric_column}}) as min_{{metric_name}},
  MAX({{metric_column}}) as max_{{metric_name}}
FROM {{source_table}}
WHERE {{timestamp_column}} >= DATE '{{start_date}}'
  AND {{timestamp_column}} < DATE '{{end_date}}'
GROUP BY 1, {{dimension_group_by}}
ORDER BY 1 DESC;`,
      variables: ['timestamp_column', 'dimension_columns', 'unique_key', 'metric_column', 'metric_name', 'source_table', 'start_date', 'end_date', 'dimension_group_by']
    },
    
    runningTotals: {
      name: 'Running Totals with Window Functions',
      description: 'Calculate cumulative metrics over time',
      category: 'Analytics',
      dialect: 'presto',
      template: `-- Running Totals
SELECT
  {{date_column}},
  {{partition_columns}},
  {{metric_column}},
  SUM({{metric_column}}) OVER (
    PARTITION BY {{partition_by}}
    ORDER BY {{date_column}}
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) as running_total,
  AVG({{metric_column}}) OVER (
    PARTITION BY {{partition_by}}
    ORDER BY {{date_column}}
    ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
  ) as moving_avg_7_days
FROM {{source_table}}
ORDER BY {{date_column}};`,
      variables: ['date_column', 'partition_columns', 'metric_column', 'partition_by', 'source_table']
    }
  },
  
  // Bronze/Silver/Gold Templates
  medallion: {
    bronzeIngestion: {
      name: 'Bronze Layer: Raw Ingestion',
      description: 'Ingest raw data with metadata',
      category: 'Medallion Architecture',
      dialect: 'presto',
      template: `-- Bronze Layer: Raw Data Ingestion
CREATE TABLE bronze.{{table_name}} AS
SELECT
  *,
  CURRENT_TIMESTAMP as _ingestion_timestamp,
  '{{source_system}}' as _source_system,
  '{{pipeline_name}}' as _pipeline_name
FROM {{source_schema}}.{{source_table}}
WHERE {{incremental_filter}};`,
      variables: ['table_name', 'source_system', 'pipeline_name', 'source_schema', 'source_table', 'incremental_filter']
    },
    
    silverCleaning: {
      name: 'Silver Layer: Data Cleaning',
      description: 'Clean and standardize bronze data',
      category: 'Medallion Architecture',
      dialect: 'presto',
      template: `-- Silver Layer: Cleaned & Standardized
CREATE TABLE silver.{{table_name}} AS
SELECT
  {{primary_key}},
  TRIM(UPPER({{text_column}})) as {{text_column}},
  LOWER(TRIM({{email_column}})) as {{email_column}},
  REGEXP_REPLACE({{phone_column}}, '[^0-9]', '') as {{phone_column}},
  CAST({{numeric_column}} as DECIMAL(10,2)) as {{numeric_column}},
  {{other_columns}},
  _ingestion_timestamp,
  CURRENT_TIMESTAMP as _processed_timestamp
FROM bronze.{{bronze_table}}
WHERE {{quality_filters}}
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY {{primary_key}}
  ORDER BY _ingestion_timestamp DESC
) = 1;`,
      variables: ['table_name', 'primary_key', 'text_column', 'email_column', 'phone_column', 'numeric_column', 'other_columns', 'bronze_table', 'quality_filters']
    },
    
    goldDimension: {
      name: 'Gold Layer: Dimension Table',
      description: 'Build business-ready dimension',
      category: 'Medallion Architecture',
      dialect: 'presto',
      template: `-- Gold Layer: Dimension Table
CREATE TABLE gold.{{dim_name}} AS
SELECT
  ROW_NUMBER() OVER (ORDER BY {{natural_key}}) as {{dim_key}},
  {{natural_key}},
  {{attribute_columns}},
  CASE 
    WHEN {{status_column}} = '{{active_value}}' THEN true
    ELSE false
  END as is_active,
  CURRENT_TIMESTAMP as valid_from,
  NULL as valid_to,
  true as is_current
FROM silver.{{silver_table}}
WHERE {{business_filters}};`,
      variables: ['dim_name', 'dim_key', 'natural_key', 'attribute_columns', 'status_column', 'active_value', 'silver_table', 'business_filters']
    },
    
    goldFact: {
      name: 'Gold Layer: Fact Table',
      description: 'Build fact table with metrics',
      category: 'Medallion Architecture',
      dialect: 'presto',
      template: `-- Gold Layer: Fact Table
CREATE TABLE gold.{{fact_name}} AS
SELECT
  {{fact_key}},
  {{dim_fk_columns}},
  {{date_key}},
  {{measure_columns}},
  CURRENT_TIMESTAMP as created_at
FROM silver.{{silver_table}} s
LEFT JOIN gold.{{dim_table_1}} d1 ON s.{{join_key_1}} = d1.{{natural_key_1}}
LEFT JOIN gold.{{dim_table_2}} d2 ON s.{{join_key_2}} = d2.{{natural_key_2}}
WHERE {{fact_filters}};`,
      variables: ['fact_name', 'fact_key', 'dim_fk_columns', 'date_key', 'measure_columns', 'silver_table', 'dim_table_1', 'join_key_1', 'natural_key_1', 'dim_table_2', 'join_key_2', 'natural_key_2', 'fact_filters']
    }
  },
  
  // Advanced Analytics Templates
  analytics: {
    cohortAnalysis: {
      name: 'Cohort Analysis',
      description: 'Analyze user behavior by cohort',
      category: 'Advanced Analytics',
      dialect: 'presto',
      template: `-- Cohort Analysis
WITH cohorts AS (
  SELECT
    {{user_id}},
    DATE_TRUNC('month', MIN({{first_event_date}})) as cohort_month
  FROM {{events_table}}
  GROUP BY {{user_id}}
),
user_activities AS (
  SELECT
    e.{{user_id}},
    c.cohort_month,
    DATE_TRUNC('month', e.{{event_date}}) as activity_month,
    COUNT(*) as event_count
  FROM {{events_table}} e
  JOIN cohorts c ON e.{{user_id}} = c.{{user_id}}
  GROUP BY 1, 2, 3
)
SELECT
  cohort_month,
  activity_month,
  DATE_DIFF('month', cohort_month, activity_month) as months_since_cohort,
  COUNT(DISTINCT {{user_id}}) as active_users,
  SUM(event_count) as total_events
FROM user_activities
GROUP BY 1, 2
ORDER BY 1, 2;`,
      variables: ['user_id', 'first_event_date', 'events_table', 'event_date']
    },
    
    funnelAnalysis: {
      name: 'Funnel Analysis',
      description: 'Track conversion through stages',
      category: 'Advanced Analytics',
      dialect: 'presto',
      template: `-- Funnel Analysis
WITH funnel_steps AS (
  SELECT
    {{user_id}},
    MAX(CASE WHEN {{event_type}} = '{{step_1}}' THEN 1 ELSE 0 END) as completed_step_1,
    MAX(CASE WHEN {{event_type}} = '{{step_2}}' THEN 1 ELSE 0 END) as completed_step_2,
    MAX(CASE WHEN {{event_type}} = '{{step_3}}' THEN 1 ELSE 0 END) as completed_step_3,
    MAX(CASE WHEN {{event_type}} = '{{step_4}}' THEN 1 ELSE 0 END) as completed_step_4
  FROM {{events_table}}
  WHERE {{event_date}} >= DATE '{{start_date}}'
    AND {{event_date}} < DATE '{{end_date}}'
  GROUP BY {{user_id}}
)
SELECT
  'Step 1: {{step_1}}' as step_name,
  SUM(completed_step_1) as users,
  100.0 as conversion_rate
FROM funnel_steps

UNION ALL

SELECT
  'Step 2: {{step_2}}',
  SUM(completed_step_2),
  ROUND(SUM(completed_step_2) * 100.0 / NULLIF(SUM(completed_step_1), 0), 2)
FROM funnel_steps

UNION ALL

SELECT
  'Step 3: {{step_3}}',
  SUM(completed_step_3),
  ROUND(SUM(completed_step_3) * 100.0 / NULLIF(SUM(completed_step_2), 0), 2)
FROM funnel_steps

UNION ALL

SELECT
  'Step 4: {{step_4}}',
  SUM(completed_step_4),
  ROUND(SUM(completed_step_4) * 100.0 / NULLIF(SUM(completed_step_3), 0), 2)
FROM funnel_steps;`,
      variables: ['user_id', 'event_type', 'step_1', 'step_2', 'step_3', 'step_4', 'events_table', 'event_date', 'start_date', 'end_date']
    }
  }
};

// Export for use in main application
if (typeof window !== 'undefined') {
  window.SQLTemplates = SQLTemplates;
}
