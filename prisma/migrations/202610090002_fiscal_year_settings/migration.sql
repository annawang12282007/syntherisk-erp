CREATE TABLE company_fiscal_settings (
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 company_id uuid PRIMARY KEY REFERENCES companies(id),
 version integer NOT NULL DEFAULT 1,
 first_year_start date NOT NULL,
 first_year_end date NOT NULL,
 end_month smallint NOT NULL CHECK(end_month BETWEEN 1 AND 12),
 end_day smallint CHECK(end_day BETWEEN 1 AND 31),
 updated_by text NOT NULL REFERENCES "user"(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(first_year_end >= first_year_start AND first_year_end - first_year_start < 371)
);
ALTER TABLE fiscal_periods ADD COLUMN fiscal_year_end date;
