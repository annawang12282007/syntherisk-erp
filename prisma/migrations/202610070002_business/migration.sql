-- Explicit relational business schema. Monetary values are integer minor units.

CREATE SEQUENCE IF NOT EXISTS business_document_number;

CREATE TABLE organizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 name text NOT NULL,
 kind text CHECK(kind IN ('customer','laboratory','investor','partner','other')),
 website text,
 address text,
 tags text,
 notes text,
 location text,
 time_zone text,
 language text,
 referral_source text,
 next_follow_up_at timestamptz
);

CREATE INDEX organizations_workspace_updated_idx ON organizations(workspace_id,company_id,updated_at DESC);

CREATE INDEX organizations_owner_idx ON organizations(workspace_id,owner_id);

CREATE TABLE contacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 name text NOT NULL,
 email text,
 phone text,
 job_title text,
 contact_preference text CHECK(contact_preference IN ('email','phone','none')),
 do_not_contact boolean DEFAULT false,
 tags text,
 notes text,
 location text,
 time_zone text,
 language text,
 referral_source text,
 next_follow_up_at timestamptz
);

CREATE INDEX contacts_workspace_updated_idx ON contacts(workspace_id,company_id,updated_at DESC);

CREATE INDEX contacts_owner_idx ON contacts(workspace_id,owner_id);

CREATE TABLE contact_affiliations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 contact_id uuid,
 organization_id uuid,
 role text,
 start_date date,
 end_date date,
 notes text
);

CREATE INDEX contact_affiliations_workspace_updated_idx ON contact_affiliations(workspace_id,company_id,updated_at DESC);

CREATE INDEX contact_affiliations_owner_idx ON contact_affiliations(workspace_id,owner_id);

CREATE TABLE relationships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 contact_id uuid,
 related_contact_id uuid,
 organization_id uuid,
 relationship_type text,
 notes text
);

CREATE INDEX relationships_workspace_updated_idx ON relationships(workspace_id,company_id,updated_at DESC);

CREATE INDEX relationships_owner_idx ON relationships(workspace_id,owner_id);

CREATE TABLE activities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 title text NOT NULL,
 contact_id uuid,
 organization_id uuid,
 project_id uuid,
 engagement_id uuid,
 occurred_at timestamptz,
 body text,
 notes text
);

CREATE INDEX activities_workspace_updated_idx ON activities(workspace_id,company_id,updated_at DESC);

CREATE INDEX activities_owner_idx ON activities(workspace_id,owner_id);

CREATE TABLE pipelines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 name text NOT NULL,
 kind text CHECK(kind IN ('expert_interview','lab_collaboration','product_trial','fundraising','customer','custom')),
 notes text
);

CREATE INDEX pipelines_workspace_updated_idx ON pipelines(workspace_id,company_id,updated_at DESC);

CREATE INDEX pipelines_owner_idx ON pipelines(workspace_id,owner_id);

CREATE TABLE pipeline_stages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 name text NOT NULL,
 pipeline_id uuid NOT NULL,
 position integer DEFAULT 0,
 required_next_step boolean DEFAULT false,
 notes text
);

CREATE INDEX pipeline_stages_workspace_updated_idx ON pipeline_stages(workspace_id,company_id,updated_at DESC);

CREATE INDEX pipeline_stages_owner_idx ON pipeline_stages(workspace_id,owner_id);

CREATE TABLE engagements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 title text NOT NULL,
 pipeline_id uuid NOT NULL,
 stage_id uuid NOT NULL,
 contact_id uuid,
 organization_id uuid,
 project_id uuid,
 goal text,
 next_step text,
 follow_up_at timestamptz,
 estimated_value_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(estimated_value_minor>=0),
 fundraising_target_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(fundraising_target_minor>=0),
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 notes text,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','won','lost','cancelled'))
);

CREATE INDEX engagements_workspace_updated_idx ON engagements(workspace_id,company_id,updated_at DESC);

CREATE INDEX engagements_owner_idx ON engagements(workspace_id,owner_id);

CREATE TABLE projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 name text NOT NULL,
 goal text,
 start_date date,
 due_date date,
 notes text,
 status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','active','on_hold','completed','cancelled'))
);

CREATE INDEX projects_workspace_updated_idx ON projects(workspace_id,company_id,updated_at DESC);

CREATE INDEX projects_owner_idx ON projects(workspace_id,owner_id);

CREATE TABLE project_members (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 project_id uuid NOT NULL,
 user_id text NOT NULL,
 responsibility text,
 notes text
);

CREATE INDEX project_members_workspace_updated_idx ON project_members(workspace_id,company_id,updated_at DESC);

CREATE INDEX project_members_owner_idx ON project_members(workspace_id,owner_id);

CREATE TABLE milestones (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 title text NOT NULL,
 project_id uuid NOT NULL,
 due_date date,
 notes text,
 status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','active','completed'))
);

CREATE INDEX milestones_workspace_updated_idx ON milestones(workspace_id,company_id,updated_at DESC);

CREATE INDEX milestones_owner_idx ON milestones(workspace_id,owner_id);

CREATE TABLE tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 title text NOT NULL,
 project_id uuid,
 milestone_id uuid,
 parent_task_id uuid,
 priority text CHECK(priority IN ('low','normal','high','urgent')),
 start_date date,
 due_date date,
 deliverable text,
 source_resource text,
 source_id uuid,
 notes text,
 status text NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','blocked','review','done','cancelled'))
);

CREATE INDEX tasks_workspace_updated_idx ON tasks(workspace_id,company_id,updated_at DESC);

CREATE INDEX tasks_owner_idx ON tasks(workspace_id,owner_id);

CREATE TABLE task_collaborators (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 task_id uuid NOT NULL,
 user_id text NOT NULL,
 responsibility text,
 notes text
);

CREATE INDEX task_collaborators_workspace_updated_idx ON task_collaborators(workspace_id,company_id,updated_at DESC);

CREATE INDEX task_collaborators_owner_idx ON task_collaborators(workspace_id,owner_id);

CREATE TABLE task_dependencies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 task_id uuid NOT NULL,
 depends_on_id uuid NOT NULL,
 notes text
);

CREATE INDEX task_dependencies_workspace_updated_idx ON task_dependencies(workspace_id,company_id,updated_at DESC);

CREATE INDEX task_dependencies_owner_idx ON task_dependencies(workspace_id,owner_id);

CREATE TABLE task_checklist (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 title text NOT NULL,
 task_id uuid NOT NULL,
 completed boolean DEFAULT false,
 notes text
);

CREATE INDEX task_checklist_workspace_updated_idx ON task_checklist(workspace_id,company_id,updated_at DESC);

CREATE INDEX task_checklist_owner_idx ON task_checklist(workspace_id,owner_id);

CREATE TABLE task_comments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 task_id uuid NOT NULL,
 body text NOT NULL,
 notes text
);

CREATE INDEX task_comments_workspace_updated_idx ON task_comments(workspace_id,company_id,updated_at DESC);

CREATE INDEX task_comments_owner_idx ON task_comments(workspace_id,owner_id);

CREATE TABLE handoffs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 title text NOT NULL,
 task_id uuid NOT NULL,
 from_user_id text,
 to_user_id text NOT NULL,
 progress text,
 remaining_work text,
 next_step text,
 due_date date,
 reason text,
 notes text,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','needs_info','withdrawn')),
 submitted_at timestamptz, approved_at timestamptz, paid_at timestamptz, posted_at timestamptz, resolved_at timestamptz
);

CREATE INDEX handoffs_workspace_updated_idx ON handoffs(workspace_id,company_id,updated_at DESC);

CREATE INDEX handoffs_owner_idx ON handoffs(workspace_id,owner_id);

CREATE TABLE work_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 title text NOT NULL,
 kind text CHECK(kind IN ('help','review','information','decision','payment')),
 requester_id text,
 recipient_id text NOT NULL,
 project_id uuid,
 task_id uuid,
 due_date date,
 purpose text,
 result text,
 reason text,
 notes text,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','needs_info','declined','in_progress','submitted','completed','withdrawn')),
 submitted_at timestamptz, approved_at timestamptz, paid_at timestamptz, posted_at timestamptz, resolved_at timestamptz
);

CREATE INDEX work_requests_workspace_updated_idx ON work_requests(workspace_id,company_id,updated_at DESC);

CREATE INDEX work_requests_owner_idx ON work_requests(workspace_id,owner_id);

CREATE TABLE reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 title text NOT NULL,
 task_id uuid,
 document_id uuid,
 reviewer_id text NOT NULL,
 submitted_version integer DEFAULT 0,
 snapshot text,
 comments text,
 notes text,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','returned')),
 submitted_at timestamptz, approved_at timestamptz, paid_at timestamptz, posted_at timestamptz, resolved_at timestamptz
);

CREATE INDEX reviews_workspace_updated_idx ON reviews(workspace_id,company_id,updated_at DESC);

CREATE INDEX reviews_owner_idx ON reviews(workspace_id,owner_id);

CREATE TABLE events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 title text NOT NULL,
 project_id uuid,
 contact_id uuid,
 start_at timestamptz,
 end_at timestamptz,
 all_day boolean DEFAULT false,
 start_date date,
 end_date date,
 time_zone text NOT NULL,
 location text,
 video_url text,
 reminder_minutes integer DEFAULT 0,
 recurrence_rule text,
 recurrence_parent_id uuid,
 recurrence_date date,
 source_resource text,
 source_id uuid,
 notes text,
 status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','cancelled'))
);

CREATE INDEX events_workspace_updated_idx ON events(workspace_id,company_id,updated_at DESC);

CREATE INDEX events_owner_idx ON events(workspace_id,owner_id);

CREATE TABLE event_participants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 event_id uuid NOT NULL,
 user_id text,
 contact_id uuid,
 response text CHECK(response IN ('pending','accepted','declined','tentative')),
 notes text
);

CREATE INDEX event_participants_workspace_updated_idx ON event_participants(workspace_id,company_id,updated_at DESC);

CREATE INDEX event_participants_owner_idx ON event_participants(workspace_id,owner_id);

CREATE TABLE expense_claims (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 title text NOT NULL,
 project_id uuid,
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 expense_date date,
 payment_method text,
 total_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(total_minor>=0),
 approved_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(approved_minor>=0),
 paid_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(paid_minor>=0),
 base_currency text CHECK(base_currency ~ '^[A-Z]{3}$'),
 exchange_rate numeric(24,12) CHECK(exchange_rate>0),
 exchange_rate_date date,
 exchange_rate_source text,
 base_total_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(base_total_minor>=0),
 notes text,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','returned','approved','partially_paid','paid','posted','cancelled')),
 submitted_at timestamptz, approved_at timestamptz, paid_at timestamptz, posted_at timestamptz, resolved_at timestamptz,
 journal_entry_id uuid
);

CREATE INDEX expense_claims_workspace_updated_idx ON expense_claims(workspace_id,company_id,updated_at DESC);

CREATE INDEX expense_claims_owner_idx ON expense_claims(workspace_id,owner_id);

CREATE TABLE expense_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 description text NOT NULL,
 claim_id uuid NOT NULL,
 project_id uuid,
 category_id uuid,
 expense_date date NOT NULL,
 amount_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(amount_minor>=0),
 tax_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(tax_minor>=0),
 paid_by text,
 notes text,
 approved_minor numeric(20,0) CHECK(approved_minor>=0)
);

CREATE INDEX expense_lines_workspace_updated_idx ON expense_lines(workspace_id,company_id,updated_at DESC);

CREATE INDEX expense_lines_owner_idx ON expense_lines(workspace_id,owner_id);

CREATE TABLE approvals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 claim_id uuid,
 reviewer_id text,
 approved_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(approved_minor>=0),
 reason text,
 notes text
);

CREATE INDEX approvals_workspace_updated_idx ON approvals(workspace_id,company_id,updated_at DESC);

CREATE INDEX approvals_owner_idx ON approvals(workspace_id,owner_id);

CREATE TABLE approval_policies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 name text NOT NULL,
 min_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(min_minor>=0),
 max_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(max_minor>=0),
 category_id uuid,
 project_id uuid,
 reviewer_id text NOT NULL,
 delegate_id text,
 notes text
);

CREATE INDEX approval_policies_workspace_updated_idx ON approval_policies(workspace_id,company_id,updated_at DESC);

CREATE INDEX approval_policies_owner_idx ON approval_policies(workspace_id,owner_id);

CREATE TABLE expense_categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 name text NOT NULL,
 account_id uuid,
 notes text
);

CREATE INDEX expense_categories_workspace_updated_idx ON expense_categories(workspace_id,company_id,updated_at DESC);

CREATE INDEX expense_categories_owner_idx ON expense_categories(workspace_id,owner_id);

CREATE TABLE customer_quotes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 title text NOT NULL,
 organization_id uuid,
 contact_id uuid,
 project_id uuid,
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 due_date date,
 total_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(total_minor>=0),
 payment_terms text,
 number text,
 notes text,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','issued','accepted','converted','cancelled'))
);

CREATE INDEX customer_quotes_workspace_updated_idx ON customer_quotes(workspace_id,company_id,updated_at DESC);

CREATE INDEX customer_quotes_owner_idx ON customer_quotes(workspace_id,owner_id);

CREATE TABLE quote_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 description text NOT NULL,
 quote_id uuid NOT NULL,
 quantity numeric(20,6) DEFAULT 0,
 unit_price_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(unit_price_minor>=0),
 tax_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(tax_minor>=0),
 notes text
);

CREATE INDEX quote_lines_workspace_updated_idx ON quote_lines(workspace_id,company_id,updated_at DESC);

CREATE INDEX quote_lines_owner_idx ON quote_lines(workspace_id,owner_id);

CREATE TABLE customer_invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 title text NOT NULL,
 organization_id uuid,
 contact_id uuid,
 project_id uuid,
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 due_date date,
 quote_id uuid,
 total_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(total_minor>=0),
 paid_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(paid_minor>=0),
 credit_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(credit_minor>=0),
 payment_terms text,
 number text,
 notes text,
 base_currency text CHECK(base_currency ~ '^[A-Z]{3}$'),
 exchange_rate numeric(24,12) CHECK(exchange_rate>0),
 exchange_rate_date date,
 exchange_rate_source text,
 base_total_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(base_total_minor>=0),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','issued','partially_paid','paid','posted','cancelled')),
 submitted_at timestamptz, approved_at timestamptz, paid_at timestamptz, posted_at timestamptz, resolved_at timestamptz,
 journal_entry_id uuid
);

CREATE INDEX customer_invoices_workspace_updated_idx ON customer_invoices(workspace_id,company_id,updated_at DESC);

CREATE INDEX customer_invoices_owner_idx ON customer_invoices(workspace_id,owner_id);

CREATE TABLE invoice_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 description text NOT NULL,
 invoice_id uuid NOT NULL,
 quantity numeric(20,6) DEFAULT 0,
 unit_price_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(unit_price_minor>=0),
 tax_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(tax_minor>=0),
 notes text
);

CREATE INDEX invoice_lines_workspace_updated_idx ON invoice_lines(workspace_id,company_id,updated_at DESC);

CREATE INDEX invoice_lines_owner_idx ON invoice_lines(workspace_id,owner_id);

CREATE TABLE vendor_bills (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 title text NOT NULL,
 supplier_id uuid,
 project_id uuid,
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 due_date date,
 purchase_order_id uuid,
 total_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(total_minor>=0),
 paid_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(paid_minor>=0),
 credit_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(credit_minor>=0),
 payment_terms text,
 number text,
 notes text,
 base_currency text CHECK(base_currency ~ '^[A-Z]{3}$'),
 exchange_rate numeric(24,12) CHECK(exchange_rate>0),
 exchange_rate_date date,
 exchange_rate_source text,
 base_total_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(base_total_minor>=0),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','partially_paid','paid','posted','cancelled')),
 submitted_at timestamptz, approved_at timestamptz, paid_at timestamptz, posted_at timestamptz, resolved_at timestamptz,
 journal_entry_id uuid
);

CREATE INDEX vendor_bills_workspace_updated_idx ON vendor_bills(workspace_id,company_id,updated_at DESC);

CREATE INDEX vendor_bills_owner_idx ON vendor_bills(workspace_id,owner_id);

CREATE TABLE bill_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 description text NOT NULL,
 bill_id uuid NOT NULL,
 purchase_order_line_id uuid,
 quantity numeric(20,6) DEFAULT 0,
 unit_price_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(unit_price_minor>=0),
 tax_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(tax_minor>=0),
 notes text
);

CREATE INDEX bill_lines_workspace_updated_idx ON bill_lines(workspace_id,company_id,updated_at DESC);

CREATE INDEX bill_lines_owner_idx ON bill_lines(workspace_id,owner_id);

CREATE TABLE payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 reference text,
 source_resource text,
 source_id uuid,
 direction text CHECK(direction IN ('outgoing','incoming','refund')),
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 amount_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(amount_minor>=0),
 paid_at timestamptz,
 idempotency_key text,
 notes text,
 source_currency text NOT NULL, allocated_minor numeric(20,0) NOT NULL CHECK(allocated_minor>0),exchange_rate numeric(24,12) NOT NULL DEFAULT 1,exchange_rate_date date,exchange_rate_source text
);

CREATE INDEX payments_workspace_updated_idx ON payments(workspace_id,company_id,updated_at DESC);

CREATE INDEX payments_owner_idx ON payments(workspace_id,owner_id);

CREATE TABLE payment_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 payment_id uuid NOT NULL,
 source_resource text,
 source_id uuid,
 amount_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(amount_minor>=0),
 notes text
);

CREATE INDEX payment_allocations_workspace_updated_idx ON payment_allocations(workspace_id,company_id,updated_at DESC);

CREATE INDEX payment_allocations_owner_idx ON payment_allocations(workspace_id,owner_id);

CREATE TABLE credit_notes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 source_resource text,
 source_id uuid,
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 amount_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(amount_minor>=0),
 reason text,
 notes text
);

CREATE INDEX credit_notes_workspace_updated_idx ON credit_notes(workspace_id,company_id,updated_at DESC);

CREATE INDEX credit_notes_owner_idx ON credit_notes(workspace_id,owner_id);

CREATE TABLE budgets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 name text NOT NULL,
 project_id uuid,
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 start_date date,
 end_date date,
 notes text
);

CREATE INDEX budgets_workspace_updated_idx ON budgets(workspace_id,company_id,updated_at DESC);

CREATE INDEX budgets_owner_idx ON budgets(workspace_id,owner_id);

CREATE TABLE budget_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 budget_id uuid NOT NULL,
 category_id uuid,
 amount_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(amount_minor>=0),
 notes text
);

CREATE INDEX budget_lines_workspace_updated_idx ON budget_lines(workspace_id,company_id,updated_at DESC);

CREATE INDEX budget_lines_owner_idx ON budget_lines(workspace_id,owner_id);

CREATE TABLE accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 code text NOT NULL,
 name text NOT NULL,
 kind text CHECK(kind IN ('asset','liability','equity','revenue','expense')),
 active boolean DEFAULT true,
 notes text
);

CREATE INDEX accounts_workspace_updated_idx ON accounts(workspace_id,company_id,updated_at DESC);

CREATE INDEX accounts_owner_idx ON accounts(workspace_id,owner_id);

CREATE TABLE fiscal_periods (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 name text NOT NULL,
 start_date date NOT NULL,
 end_date date NOT NULL,
 notes text,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed'))
);

CREATE INDEX fiscal_periods_workspace_updated_idx ON fiscal_periods(workspace_id,company_id,updated_at DESC);

CREATE INDEX fiscal_periods_owner_idx ON fiscal_periods(workspace_id,owner_id);

CREATE TABLE journal_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 title text NOT NULL,
 entry_date date NOT NULL,
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 number text,
 source_resource text,
 source_id uuid,
 reversal_of uuid,
 notes text,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','posted','reversed')),
 submitted_at timestamptz, approved_at timestamptz, paid_at timestamptz, posted_at timestamptz, resolved_at timestamptz
);

CREATE INDEX journal_entries_workspace_updated_idx ON journal_entries(workspace_id,company_id,updated_at DESC);

CREATE INDEX journal_entries_owner_idx ON journal_entries(workspace_id,owner_id);

CREATE TABLE journal_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 entry_id uuid NOT NULL,
 account_id uuid NOT NULL,
 project_id uuid,
 debit_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(debit_minor>=0),
 credit_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(credit_minor>=0),
 description text,
 notes text
);

CREATE INDEX journal_lines_workspace_updated_idx ON journal_lines(workspace_id,company_id,updated_at DESC);

CREATE INDEX journal_lines_owner_idx ON journal_lines(workspace_id,owner_id);

CREATE TABLE exchange_rates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 from_currency text NOT NULL CHECK(from_currency ~ '^[A-Z]{3}$'),
 to_currency text NOT NULL CHECK(to_currency ~ '^[A-Z]{3}$'),
 rate numeric(24,12) CHECK(rate>0) NOT NULL,
 rate_date date NOT NULL,
 source text NOT NULL,
 notes text
);

CREATE INDEX exchange_rates_workspace_updated_idx ON exchange_rates(workspace_id,company_id,updated_at DESC);

CREATE INDEX exchange_rates_owner_idx ON exchange_rates(workspace_id,owner_id);

CREATE TABLE currencies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 code text NOT NULL,
 name text NOT NULL,
 minor_digits integer DEFAULT 0,
 notes text
);

CREATE INDEX currencies_workspace_updated_idx ON currencies(workspace_id,company_id,updated_at DESC);

CREATE INDEX currencies_owner_idx ON currencies(workspace_id,owner_id);

CREATE TABLE tax_rates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 name text NOT NULL,
 rate numeric(24,12) CHECK(rate>0) NOT NULL,
 account_id uuid,
 jurisdiction text,
 notes text
);

CREATE INDEX tax_rates_workspace_updated_idx ON tax_rates(workspace_id,company_id,updated_at DESC);

CREATE INDEX tax_rates_owner_idx ON tax_rates(workspace_id,owner_id);

CREATE TABLE bank_transactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 reference text NOT NULL,
 transaction_date date NOT NULL,
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 amount_minor numeric(20,0) NOT NULL DEFAULT 0,
 description text,
 bank_account text,
 notes text,
 status text NOT NULL DEFAULT 'unmatched' CHECK(status IN ('unmatched','matched'))
);

CREATE INDEX bank_transactions_workspace_updated_idx ON bank_transactions(workspace_id,company_id,updated_at DESC);

CREATE INDEX bank_transactions_owner_idx ON bank_transactions(workspace_id,owner_id);

CREATE TABLE reconciliations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 bank_transaction_id uuid NOT NULL,
 payment_id uuid NOT NULL,
 matched_at timestamptz,
 notes text
);

CREATE INDEX reconciliations_workspace_updated_idx ON reconciliations(workspace_id,company_id,updated_at DESC);

CREATE INDEX reconciliations_owner_idx ON reconciliations(workspace_id,owner_id);

CREATE TABLE suppliers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 name text NOT NULL,
 organization_id uuid,
 contact_id uuid,
 email text,
 payment_terms text,
 notes text
);

CREATE INDEX suppliers_workspace_updated_idx ON suppliers(workspace_id,company_id,updated_at DESC);

CREATE INDEX suppliers_owner_idx ON suppliers(workspace_id,owner_id);

CREATE TABLE purchase_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 title text NOT NULL,
 supplier_id uuid,
 project_id uuid,
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 estimated_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(estimated_minor>=0),
 justification text,
 quote_comparison text,
 notes text,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','returned','ordered','cancelled'))
);

CREATE INDEX purchase_requests_workspace_updated_idx ON purchase_requests(workspace_id,company_id,updated_at DESC);

CREATE INDEX purchase_requests_owner_idx ON purchase_requests(workspace_id,owner_id);

CREATE TABLE purchase_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 title text NOT NULL,
 supplier_id uuid,
 project_id uuid,
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 request_id uuid,
 due_date date,
 number text,
 notes text,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','partially_received','received','closed','cancelled')),
 submitted_at timestamptz, approved_at timestamptz, paid_at timestamptz, posted_at timestamptz, resolved_at timestamptz
);

CREATE INDEX purchase_orders_workspace_updated_idx ON purchase_orders(workspace_id,company_id,updated_at DESC);

CREATE INDEX purchase_orders_owner_idx ON purchase_orders(workspace_id,owner_id);

CREATE TABLE purchase_order_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 description text NOT NULL,
 order_id uuid NOT NULL,
 quantity numeric(20,6) DEFAULT 0,
 unit_price_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(unit_price_minor>=0),
 received_quantity numeric(20,6) DEFAULT 0,
 billed_quantity numeric(20,6) DEFAULT 0,
 notes text
);

CREATE INDEX purchase_order_lines_workspace_updated_idx ON purchase_order_lines(workspace_id,company_id,updated_at DESC);

CREATE INDEX purchase_order_lines_owner_idx ON purchase_order_lines(workspace_id,owner_id);

CREATE TABLE receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 order_id uuid NOT NULL,
 line_id uuid NOT NULL,
 quantity numeric(20,6) DEFAULT 0,
 acceptance_notes text,
 notes text
);

CREATE INDEX receipts_workspace_updated_idx ON receipts(workspace_id,company_id,updated_at DESC);

CREATE INDEX receipts_owner_idx ON receipts(workspace_id,owner_id);

CREATE TABLE subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 name text NOT NULL,
 supplier_id uuid,
 project_id uuid,
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 amount_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(amount_minor>=0),
 cycle text CHECK(cycle IN ('monthly','quarterly','yearly','other')),
 purpose text,
 account_holder_id text,
 payer_id text,
 due_date date,
 cancel_by date,
 reminder_days integer DEFAULT 0,
 notes text,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled','expired'))
);

CREATE INDEX subscriptions_workspace_updated_idx ON subscriptions(workspace_id,company_id,updated_at DESC);

CREATE INDEX subscriptions_owner_idx ON subscriptions(workspace_id,owner_id);

CREATE TABLE assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 name text NOT NULL,
 asset_number text NOT NULL,
 category text,
 supplier_id uuid,
 purchase_date date,
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 cost_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(cost_minor>=0),
 location text,
 custodian_id text,
 warranty_until date,
 notes text,
 status text NOT NULL DEFAULT 'available' CHECK(status IN ('available','assigned','disposed'))
);

CREATE INDEX assets_workspace_updated_idx ON assets(workspace_id,company_id,updated_at DESC);

CREATE INDEX assets_owner_idx ON assets(workspace_id,owner_id);

CREATE TABLE asset_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 asset_id uuid NOT NULL,
 user_id text NOT NULL,
 assigned_at timestamptz,
 returned_at timestamptz,
 notes text
);

CREATE INDEX asset_assignments_workspace_updated_idx ON asset_assignments(workspace_id,company_id,updated_at DESC);

CREATE INDEX asset_assignments_owner_idx ON asset_assignments(workspace_id,owner_id);

CREATE TABLE documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 title text NOT NULL,
 project_id uuid,
 contact_id uuid,
 organization_id uuid,
 category text,
 url text,
 content text,
 drive_file_id text,
 related_resource text,
 related_id uuid,
 notes text
);

CREATE INDEX documents_workspace_updated_idx ON documents(workspace_id,company_id,updated_at DESC);

CREATE INDEX documents_owner_idx ON documents(workspace_id,owner_id);

CREATE TABLE document_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 document_id uuid NOT NULL,
 version_number integer DEFAULT 0,
 content text,
 url text,
 notes text
);

CREATE INDEX document_versions_workspace_updated_idx ON document_versions(workspace_id,company_id,updated_at DESC);

CREATE INDEX document_versions_owner_idx ON document_versions(workspace_id,owner_id);

CREATE TABLE contracts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 title text NOT NULL,
 organization_id uuid,
 contact_id uuid,
 project_id uuid,
 document_id uuid,
 kind text CHECK(kind IN ('contract','nda','ip_assignment','other')),
 parties text,
 effective_date date,
 end_date date,
 renewal_date date,
 obligations text,
 signed_document_url text,
 notes text,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','under_review','signed','expired','cancelled'))
);

CREATE INDEX contracts_workspace_updated_idx ON contracts(workspace_id,company_id,updated_at DESC);

CREATE INDEX contracts_owner_idx ON contracts(workspace_id,owner_id);

CREATE TABLE license_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 title text NOT NULL,
 organization_id uuid,
 project_id uuid,
 document_id uuid,
 license_type text,
 scope text,
 effective_date date,
 end_date date,
 obligations text,
 notes text
);

CREATE INDEX license_records_workspace_updated_idx ON license_records(workspace_id,company_id,updated_at DESC);

CREATE INDEX license_records_owner_idx ON license_records(workspace_id,owner_id);

CREATE TABLE meetings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 title text NOT NULL,
 project_id uuid,
 event_id uuid,
 participants text,
 agenda text,
 discussion text,
 minutes text,
 notes text
);

CREATE INDEX meetings_workspace_updated_idx ON meetings(workspace_id,company_id,updated_at DESC);

CREATE INDEX meetings_owner_idx ON meetings(workspace_id,owner_id);

CREATE TABLE decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 title text NOT NULL,
 project_id uuid,
 meeting_id uuid,
 content text NOT NULL,
 decision_date date,
 notes text,
 status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','adopted','rejected','superseded'))
);

CREATE INDEX decisions_workspace_updated_idx ON decisions(workspace_id,company_id,updated_at DESC);

CREATE INDEX decisions_owner_idx ON decisions(workspace_id,owner_id);

CREATE TABLE interviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 title text NOT NULL,
 contact_id uuid,
 organization_id uuid,
 project_id uuid,
 event_id uuid,
 guide text,
 direct_record text,
 interpretation text,
 evidence_source text,
 notes text,
 status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','completed','documented'))
);

CREATE INDEX interviews_workspace_updated_idx ON interviews(workspace_id,company_id,updated_at DESC);

CREATE INDEX interviews_owner_idx ON interviews(workspace_id,owner_id);

CREATE TABLE feedback (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 title text NOT NULL,
 contact_id uuid,
 organization_id uuid,
 project_id uuid,
 interview_id uuid,
 observation text,
 direct_quote text,
 interpretation text,
 need text,
 importance text CHECK(importance IN ('low','normal','high','critical')),
 evidence_source text,
 notes text
);

CREATE INDEX feedback_workspace_updated_idx ON feedback(workspace_id,company_id,updated_at DESC);

CREATE INDEX feedback_owner_idx ON feedback(workspace_id,owner_id);

CREATE TABLE trials (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 title text NOT NULL,
 contact_id uuid,
 organization_id uuid,
 project_id uuid,
 product_version text,
 goal text,
 start_date date,
 end_date date,
 result text,
 notes text,
 status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','active','completed','cancelled'))
);

CREATE INDEX trials_workspace_updated_idx ON trials(workspace_id,company_id,updated_at DESC);

CREATE INDEX trials_owner_idx ON trials(workspace_id,owner_id);

CREATE TABLE validation_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 title text NOT NULL,
 trial_id uuid,
 project_id uuid,
 product_version text,
 method text,
 result text,
 evidence_source text,
 limitations text,
 notes text
);

CREATE INDEX validation_records_workspace_updated_idx ON validation_records(workspace_id,company_id,updated_at DESC);

CREATE INDEX validation_records_owner_idx ON validation_records(workspace_id,owner_id);

CREATE TABLE product_issues (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 title text NOT NULL,
 project_id uuid,
 feedback_id uuid,
 trial_id uuid,
 severity text CHECK(severity IN ('low','normal','high','critical')),
 description text,
 notes text,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved','closed'))
);

CREATE INDEX product_issues_workspace_updated_idx ON product_issues(workspace_id,company_id,updated_at DESC);

CREATE INDEX product_issues_owner_idx ON product_issues(workspace_id,owner_id);

CREATE TABLE communication_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 name text NOT NULL,
 subject text NOT NULL,
 body text NOT NULL,
 notes text
);

CREATE INDEX communication_templates_workspace_updated_idx ON communication_templates(workspace_id,company_id,updated_at DESC);

CREATE INDEX communication_templates_owner_idx ON communication_templates(workspace_id,owner_id);

CREATE TABLE audience_groups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 name text NOT NULL,
 description text,
 notes text
);

CREATE INDEX audience_groups_workspace_updated_idx ON audience_groups(workspace_id,company_id,updated_at DESC);

CREATE INDEX audience_groups_owner_idx ON audience_groups(workspace_id,owner_id);

CREATE TABLE audience_members (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 group_id uuid NOT NULL,
 contact_id uuid NOT NULL,
 notes text
);

CREATE INDEX audience_members_workspace_updated_idx ON audience_members(workspace_id,company_id,updated_at DESC);

CREATE INDEX audience_members_owner_idx ON audience_members(workspace_id,owner_id);

CREATE TABLE campaigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid NOT NULL REFERENCES companies(id), created_by text NOT NULL REFERENCES "user"(id), updated_by text NOT NULL REFERENCES "user"(id), owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0), archived boolean NOT NULL DEFAULT false, UNIQUE(workspace_id,id), UNIQUE(id,workspace_id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
 title text NOT NULL,
 template_id uuid,
 group_id uuid,
 purpose text,
 notes text,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','reviewed','closed'))
);

CREATE INDEX campaigns_workspace_updated_idx ON campaigns(workspace_id,company_id,updated_at DESC);

CREATE INDEX campaigns_owner_idx ON campaigns(workspace_id,owner_id);

ALTER TABLE contact_affiliations ADD CONSTRAINT contact_affiliations_contact_id_fk FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id);

ALTER TABLE contact_affiliations ADD CONSTRAINT contact_affiliations_organization_id_fk FOREIGN KEY(workspace_id,organization_id) REFERENCES organizations(workspace_id,id);

ALTER TABLE relationships ADD CONSTRAINT relationships_contact_id_fk FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id);

ALTER TABLE relationships ADD CONSTRAINT relationships_related_contact_id_fk FOREIGN KEY(workspace_id,related_contact_id) REFERENCES contacts(workspace_id,id);

ALTER TABLE relationships ADD CONSTRAINT relationships_organization_id_fk FOREIGN KEY(workspace_id,organization_id) REFERENCES organizations(workspace_id,id);

ALTER TABLE activities ADD CONSTRAINT activities_contact_id_fk FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id);

ALTER TABLE activities ADD CONSTRAINT activities_organization_id_fk FOREIGN KEY(workspace_id,organization_id) REFERENCES organizations(workspace_id,id);

ALTER TABLE activities ADD CONSTRAINT activities_project_id_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id);

ALTER TABLE activities ADD CONSTRAINT activities_engagement_id_fk FOREIGN KEY(workspace_id,engagement_id) REFERENCES engagements(workspace_id,id);

ALTER TABLE pipeline_stages ADD CONSTRAINT pipeline_stages_pipeline_id_fk FOREIGN KEY(workspace_id,pipeline_id) REFERENCES pipelines(workspace_id,id);

ALTER TABLE engagements ADD CONSTRAINT engagements_pipeline_id_fk FOREIGN KEY(workspace_id,pipeline_id) REFERENCES pipelines(workspace_id,id);

ALTER TABLE engagements ADD CONSTRAINT engagements_stage_id_fk FOREIGN KEY(workspace_id,stage_id) REFERENCES pipeline_stages(workspace_id,id);

ALTER TABLE engagements ADD CONSTRAINT engagements_contact_id_fk FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id);

ALTER TABLE engagements ADD CONSTRAINT engagements_organization_id_fk FOREIGN KEY(workspace_id,organization_id) REFERENCES organizations(workspace_id,id);

ALTER TABLE engagements ADD CONSTRAINT engagements_project_id_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id);

ALTER TABLE project_members ADD CONSTRAINT project_members_project_id_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id);

ALTER TABLE project_members ADD CONSTRAINT project_members_user_id_fk FOREIGN KEY(user_id) REFERENCES "user"(id);

ALTER TABLE milestones ADD CONSTRAINT milestones_project_id_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id);

ALTER TABLE tasks ADD CONSTRAINT tasks_project_id_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id);

ALTER TABLE tasks ADD CONSTRAINT tasks_milestone_id_fk FOREIGN KEY(workspace_id,milestone_id) REFERENCES milestones(workspace_id,id);

ALTER TABLE tasks ADD CONSTRAINT tasks_parent_task_id_fk FOREIGN KEY(workspace_id,parent_task_id) REFERENCES tasks(workspace_id,id);

ALTER TABLE task_collaborators ADD CONSTRAINT task_collaborators_task_id_fk FOREIGN KEY(workspace_id,task_id) REFERENCES tasks(workspace_id,id);

ALTER TABLE task_collaborators ADD CONSTRAINT task_collaborators_user_id_fk FOREIGN KEY(user_id) REFERENCES "user"(id);

ALTER TABLE task_dependencies ADD CONSTRAINT task_dependencies_task_id_fk FOREIGN KEY(workspace_id,task_id) REFERENCES tasks(workspace_id,id);

ALTER TABLE task_dependencies ADD CONSTRAINT task_dependencies_depends_on_id_fk FOREIGN KEY(workspace_id,depends_on_id) REFERENCES tasks(workspace_id,id);

ALTER TABLE task_checklist ADD CONSTRAINT task_checklist_task_id_fk FOREIGN KEY(workspace_id,task_id) REFERENCES tasks(workspace_id,id);

ALTER TABLE task_comments ADD CONSTRAINT task_comments_task_id_fk FOREIGN KEY(workspace_id,task_id) REFERENCES tasks(workspace_id,id);

ALTER TABLE handoffs ADD CONSTRAINT handoffs_task_id_fk FOREIGN KEY(workspace_id,task_id) REFERENCES tasks(workspace_id,id);

ALTER TABLE handoffs ADD CONSTRAINT handoffs_from_user_id_fk FOREIGN KEY(from_user_id) REFERENCES "user"(id);

ALTER TABLE handoffs ADD CONSTRAINT handoffs_to_user_id_fk FOREIGN KEY(to_user_id) REFERENCES "user"(id);

ALTER TABLE work_requests ADD CONSTRAINT work_requests_requester_id_fk FOREIGN KEY(requester_id) REFERENCES "user"(id);

ALTER TABLE work_requests ADD CONSTRAINT work_requests_recipient_id_fk FOREIGN KEY(recipient_id) REFERENCES "user"(id);

ALTER TABLE work_requests ADD CONSTRAINT work_requests_project_id_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id);

ALTER TABLE work_requests ADD CONSTRAINT work_requests_task_id_fk FOREIGN KEY(workspace_id,task_id) REFERENCES tasks(workspace_id,id);

ALTER TABLE reviews ADD CONSTRAINT reviews_task_id_fk FOREIGN KEY(workspace_id,task_id) REFERENCES tasks(workspace_id,id);

ALTER TABLE reviews ADD CONSTRAINT reviews_document_id_fk FOREIGN KEY(workspace_id,document_id) REFERENCES documents(workspace_id,id);

ALTER TABLE reviews ADD CONSTRAINT reviews_reviewer_id_fk FOREIGN KEY(reviewer_id) REFERENCES "user"(id);

ALTER TABLE events ADD CONSTRAINT events_project_id_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id);

ALTER TABLE events ADD CONSTRAINT events_contact_id_fk FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id);

ALTER TABLE events ADD CONSTRAINT events_recurrence_parent_id_fk FOREIGN KEY(workspace_id,recurrence_parent_id) REFERENCES events(workspace_id,id);

ALTER TABLE event_participants ADD CONSTRAINT event_participants_event_id_fk FOREIGN KEY(workspace_id,event_id) REFERENCES events(workspace_id,id);

ALTER TABLE event_participants ADD CONSTRAINT event_participants_user_id_fk FOREIGN KEY(user_id) REFERENCES "user"(id);

ALTER TABLE event_participants ADD CONSTRAINT event_participants_contact_id_fk FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id);

ALTER TABLE expense_claims ADD CONSTRAINT expense_claims_project_id_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id);

ALTER TABLE expense_lines ADD CONSTRAINT expense_lines_claim_id_fk FOREIGN KEY(workspace_id,claim_id) REFERENCES expense_claims(workspace_id,id);

ALTER TABLE expense_lines ADD CONSTRAINT expense_lines_project_id_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id);

ALTER TABLE expense_lines ADD CONSTRAINT expense_lines_category_id_fk FOREIGN KEY(workspace_id,category_id) REFERENCES expense_categories(workspace_id,id);

ALTER TABLE expense_lines ADD CONSTRAINT expense_lines_paid_by_fk FOREIGN KEY(paid_by) REFERENCES "user"(id);

ALTER TABLE approvals ADD CONSTRAINT approvals_claim_id_fk FOREIGN KEY(workspace_id,claim_id) REFERENCES expense_claims(workspace_id,id);

ALTER TABLE approvals ADD CONSTRAINT approvals_reviewer_id_fk FOREIGN KEY(reviewer_id) REFERENCES "user"(id);

ALTER TABLE approval_policies ADD CONSTRAINT approval_policies_category_id_fk FOREIGN KEY(workspace_id,category_id) REFERENCES expense_categories(workspace_id,id);

ALTER TABLE approval_policies ADD CONSTRAINT approval_policies_project_id_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id);

ALTER TABLE approval_policies ADD CONSTRAINT approval_policies_reviewer_id_fk FOREIGN KEY(reviewer_id) REFERENCES "user"(id);

ALTER TABLE approval_policies ADD CONSTRAINT approval_policies_delegate_id_fk FOREIGN KEY(delegate_id) REFERENCES "user"(id);

ALTER TABLE expense_categories ADD CONSTRAINT expense_categories_account_id_fk FOREIGN KEY(workspace_id,account_id) REFERENCES accounts(workspace_id,id);

ALTER TABLE customer_quotes ADD CONSTRAINT customer_quotes_organization_id_fk FOREIGN KEY(workspace_id,organization_id) REFERENCES organizations(workspace_id,id);

ALTER TABLE customer_quotes ADD CONSTRAINT customer_quotes_contact_id_fk FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id);

ALTER TABLE customer_quotes ADD CONSTRAINT customer_quotes_project_id_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id);

ALTER TABLE quote_lines ADD CONSTRAINT quote_lines_quote_id_fk FOREIGN KEY(workspace_id,quote_id) REFERENCES customer_quotes(workspace_id,id);

ALTER TABLE customer_invoices ADD CONSTRAINT customer_invoices_organization_id_fk FOREIGN KEY(workspace_id,organization_id) REFERENCES organizations(workspace_id,id);

ALTER TABLE customer_invoices ADD CONSTRAINT customer_invoices_contact_id_fk FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id);

ALTER TABLE customer_invoices ADD CONSTRAINT customer_invoices_project_id_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id);

ALTER TABLE customer_invoices ADD CONSTRAINT customer_invoices_quote_id_fk FOREIGN KEY(workspace_id,quote_id) REFERENCES customer_quotes(workspace_id,id);

ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_invoice_id_fk FOREIGN KEY(workspace_id,invoice_id) REFERENCES customer_invoices(workspace_id,id);

ALTER TABLE vendor_bills ADD CONSTRAINT vendor_bills_supplier_id_fk FOREIGN KEY(workspace_id,supplier_id) REFERENCES suppliers(workspace_id,id);

ALTER TABLE vendor_bills ADD CONSTRAINT vendor_bills_project_id_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id);

ALTER TABLE vendor_bills ADD CONSTRAINT vendor_bills_purchase_order_id_fk FOREIGN KEY(workspace_id,purchase_order_id) REFERENCES purchase_orders(workspace_id,id);

ALTER TABLE bill_lines ADD CONSTRAINT bill_lines_bill_id_fk FOREIGN KEY(workspace_id,bill_id) REFERENCES vendor_bills(workspace_id,id);

ALTER TABLE bill_lines ADD CONSTRAINT bill_lines_purchase_order_line_id_fk FOREIGN KEY(workspace_id,purchase_order_line_id) REFERENCES purchase_order_lines(workspace_id,id);

ALTER TABLE payment_allocations ADD CONSTRAINT payment_allocations_payment_id_fk FOREIGN KEY(workspace_id,payment_id) REFERENCES payments(workspace_id,id);

ALTER TABLE budgets ADD CONSTRAINT budgets_project_id_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id);

ALTER TABLE budget_lines ADD CONSTRAINT budget_lines_budget_id_fk FOREIGN KEY(workspace_id,budget_id) REFERENCES budgets(workspace_id,id);

ALTER TABLE budget_lines ADD CONSTRAINT budget_lines_category_id_fk FOREIGN KEY(workspace_id,category_id) REFERENCES expense_categories(workspace_id,id);

ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_reversal_of_fk FOREIGN KEY(workspace_id,reversal_of) REFERENCES journal_entries(workspace_id,id);

ALTER TABLE journal_lines ADD CONSTRAINT journal_lines_entry_id_fk FOREIGN KEY(workspace_id,entry_id) REFERENCES journal_entries(workspace_id,id);

ALTER TABLE journal_lines ADD CONSTRAINT journal_lines_account_id_fk FOREIGN KEY(workspace_id,account_id) REFERENCES accounts(workspace_id,id);

ALTER TABLE journal_lines ADD CONSTRAINT journal_lines_project_id_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id);

ALTER TABLE tax_rates ADD CONSTRAINT tax_rates_account_id_fk FOREIGN KEY(workspace_id,account_id) REFERENCES accounts(workspace_id,id);

ALTER TABLE reconciliations ADD CONSTRAINT reconciliations_bank_transaction_id_fk FOREIGN KEY(workspace_id,bank_transaction_id) REFERENCES bank_transactions(workspace_id,id);

ALTER TABLE reconciliations ADD CONSTRAINT reconciliations_payment_id_fk FOREIGN KEY(workspace_id,payment_id) REFERENCES payments(workspace_id,id);

ALTER TABLE suppliers ADD CONSTRAINT suppliers_organization_id_fk FOREIGN KEY(workspace_id,organization_id) REFERENCES organizations(workspace_id,id);

ALTER TABLE suppliers ADD CONSTRAINT suppliers_contact_id_fk FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id);

ALTER TABLE purchase_requests ADD CONSTRAINT purchase_requests_supplier_id_fk FOREIGN KEY(workspace_id,supplier_id) REFERENCES suppliers(workspace_id,id);

ALTER TABLE purchase_requests ADD CONSTRAINT purchase_requests_project_id_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id);

ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_supplier_id_fk FOREIGN KEY(workspace_id,supplier_id) REFERENCES suppliers(workspace_id,id);

ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_project_id_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id);

ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_request_id_fk FOREIGN KEY(workspace_id,request_id) REFERENCES purchase_requests(workspace_id,id);

ALTER TABLE purchase_order_lines ADD CONSTRAINT purchase_order_lines_order_id_fk FOREIGN KEY(workspace_id,order_id) REFERENCES purchase_orders(workspace_id,id);

ALTER TABLE receipts ADD CONSTRAINT receipts_order_id_fk FOREIGN KEY(workspace_id,order_id) REFERENCES purchase_orders(workspace_id,id);

ALTER TABLE receipts ADD CONSTRAINT receipts_line_id_fk FOREIGN KEY(workspace_id,line_id) REFERENCES purchase_order_lines(workspace_id,id);

ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_supplier_id_fk FOREIGN KEY(workspace_id,supplier_id) REFERENCES suppliers(workspace_id,id);

ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_project_id_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id);

ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_account_holder_id_fk FOREIGN KEY(account_holder_id) REFERENCES "user"(id);

ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_payer_id_fk FOREIGN KEY(payer_id) REFERENCES "user"(id);

ALTER TABLE assets ADD CONSTRAINT assets_supplier_id_fk FOREIGN KEY(workspace_id,supplier_id) REFERENCES suppliers(workspace_id,id);

ALTER TABLE assets ADD CONSTRAINT assets_custodian_id_fk FOREIGN KEY(custodian_id) REFERENCES "user"(id);

ALTER TABLE asset_assignments ADD CONSTRAINT asset_assignments_asset_id_fk FOREIGN KEY(workspace_id,asset_id) REFERENCES assets(workspace_id,id);

ALTER TABLE asset_assignments ADD CONSTRAINT asset_assignments_user_id_fk FOREIGN KEY(user_id) REFERENCES "user"(id);

ALTER TABLE documents ADD CONSTRAINT documents_project_id_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id);

ALTER TABLE documents ADD CONSTRAINT documents_contact_id_fk FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id);

ALTER TABLE documents ADD CONSTRAINT documents_organization_id_fk FOREIGN KEY(workspace_id,organization_id) REFERENCES organizations(workspace_id,id);

ALTER TABLE document_versions ADD CONSTRAINT document_versions_document_id_fk FOREIGN KEY(workspace_id,document_id) REFERENCES documents(workspace_id,id);

ALTER TABLE contracts ADD CONSTRAINT contracts_organization_id_fk FOREIGN KEY(workspace_id,organization_id) REFERENCES organizations(workspace_id,id);

ALTER TABLE contracts ADD CONSTRAINT contracts_contact_id_fk FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id);

ALTER TABLE contracts ADD CONSTRAINT contracts_project_id_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id);

ALTER TABLE contracts ADD CONSTRAINT contracts_document_id_fk FOREIGN KEY(workspace_id,document_id) REFERENCES documents(workspace_id,id);

ALTER TABLE license_records ADD CONSTRAINT license_records_organization_id_fk FOREIGN KEY(workspace_id,organization_id) REFERENCES organizations(workspace_id,id);

ALTER TABLE license_records ADD CONSTRAINT license_records_project_id_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id);

ALTER TABLE license_records ADD CONSTRAINT license_records_document_id_fk FOREIGN KEY(workspace_id,document_id) REFERENCES documents(workspace_id,id);

ALTER TABLE meetings ADD CONSTRAINT meetings_project_id_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id);

ALTER TABLE meetings ADD CONSTRAINT meetings_event_id_fk FOREIGN KEY(workspace_id,event_id) REFERENCES events(workspace_id,id);

ALTER TABLE decisions ADD CONSTRAINT decisions_project_id_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id);

ALTER TABLE decisions ADD CONSTRAINT decisions_meeting_id_fk FOREIGN KEY(workspace_id,meeting_id) REFERENCES meetings(workspace_id,id);

ALTER TABLE interviews ADD CONSTRAINT interviews_contact_id_fk FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id);

ALTER TABLE interviews ADD CONSTRAINT interviews_organization_id_fk FOREIGN KEY(workspace_id,organization_id) REFERENCES organizations(workspace_id,id);

ALTER TABLE interviews ADD CONSTRAINT interviews_project_id_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id);

ALTER TABLE interviews ADD CONSTRAINT interviews_event_id_fk FOREIGN KEY(workspace_id,event_id) REFERENCES events(workspace_id,id);

ALTER TABLE feedback ADD CONSTRAINT feedback_contact_id_fk FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id);

ALTER TABLE feedback ADD CONSTRAINT feedback_organization_id_fk FOREIGN KEY(workspace_id,organization_id) REFERENCES organizations(workspace_id,id);

ALTER TABLE feedback ADD CONSTRAINT feedback_project_id_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id);

ALTER TABLE feedback ADD CONSTRAINT feedback_interview_id_fk FOREIGN KEY(workspace_id,interview_id) REFERENCES interviews(workspace_id,id);

ALTER TABLE trials ADD CONSTRAINT trials_contact_id_fk FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id);

ALTER TABLE trials ADD CONSTRAINT trials_organization_id_fk FOREIGN KEY(workspace_id,organization_id) REFERENCES organizations(workspace_id,id);

ALTER TABLE trials ADD CONSTRAINT trials_project_id_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id);

ALTER TABLE validation_records ADD CONSTRAINT validation_records_trial_id_fk FOREIGN KEY(workspace_id,trial_id) REFERENCES trials(workspace_id,id);

ALTER TABLE validation_records ADD CONSTRAINT validation_records_project_id_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id);

ALTER TABLE product_issues ADD CONSTRAINT product_issues_project_id_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id);

ALTER TABLE product_issues ADD CONSTRAINT product_issues_feedback_id_fk FOREIGN KEY(workspace_id,feedback_id) REFERENCES feedback(workspace_id,id);

ALTER TABLE product_issues ADD CONSTRAINT product_issues_trial_id_fk FOREIGN KEY(workspace_id,trial_id) REFERENCES trials(workspace_id,id);

ALTER TABLE audience_members ADD CONSTRAINT audience_members_group_id_fk FOREIGN KEY(workspace_id,group_id) REFERENCES audience_groups(workspace_id,id);

ALTER TABLE audience_members ADD CONSTRAINT audience_members_contact_id_fk FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id);

ALTER TABLE campaigns ADD CONSTRAINT campaigns_template_id_fk FOREIGN KEY(workspace_id,template_id) REFERENCES communication_templates(workspace_id,id);

ALTER TABLE campaigns ADD CONSTRAINT campaigns_group_id_fk FOREIGN KEY(workspace_id,group_id) REFERENCES audience_groups(workspace_id,id);

CREATE TABLE record_grants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),resource text NOT NULL,record_id uuid NOT NULL,user_id text NOT NULL REFERENCES "user"(id),can_edit boolean NOT NULL DEFAULT false,UNIQUE(workspace_id,resource,record_id,user_id));

CREATE TABLE action_keys (workspace_id uuid NOT NULL,user_id text NOT NULL,resource text NOT NULL,record_id uuid NOT NULL,action text NOT NULL,idempotency_key text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,user_id,idempotency_key));

CREATE UNIQUE INDEX affiliations_unique ON contact_affiliations(workspace_id,contact_id,organization_id) WHERE NOT archived;

CREATE UNIQUE INDEX project_members_unique ON project_members(workspace_id,project_id,user_id) WHERE NOT archived;

CREATE UNIQUE INDEX collaborators_unique ON task_collaborators(workspace_id,task_id,user_id) WHERE NOT archived;

CREATE UNIQUE INDEX dependencies_unique ON task_dependencies(workspace_id,task_id,depends_on_id) WHERE NOT archived;

ALTER TABLE task_dependencies ADD CONSTRAINT dependency_not_self CHECK(task_id<>depends_on_id);

CREATE UNIQUE INDEX accounts_unique_code ON accounts(workspace_id,company_id,code);

CREATE UNIQUE INDEX assets_unique_number ON assets(workspace_id,company_id,asset_number);

CREATE UNIQUE INDEX periods_unique_name ON fiscal_periods(workspace_id,company_id,name);

ALTER TABLE fiscal_periods ADD CONSTRAINT period_date_order CHECK(start_date<=end_date);

CREATE UNIQUE INDEX reconciliation_bank_unique ON reconciliations(workspace_id,bank_transaction_id);

CREATE UNIQUE INDEX reconciliation_payment_unique ON reconciliations(workspace_id,payment_id);

CREATE UNIQUE INDEX payment_idempotency_unique ON payments(workspace_id,idempotency_key);

CREATE UNIQUE INDEX document_versions_unique ON document_versions(workspace_id,document_id,version_number);

CREATE UNIQUE INDEX one_active_assignment ON asset_assignments(workspace_id,asset_id) WHERE returned_at IS NULL;

CREATE UNIQUE INDEX audience_member_unique ON audience_members(workspace_id,group_id,contact_id) WHERE NOT archived;

CREATE UNIQUE INDEX event_exception_unique ON events(workspace_id,recurrence_parent_id,recurrence_date) WHERE recurrence_parent_id IS NOT NULL;

CREATE UNIQUE INDEX journal_reversal_unique ON journal_entries(workspace_id,reversal_of) WHERE reversal_of IS NOT NULL;

CREATE UNIQUE INDEX invoices_quote_unique ON customer_invoices(workspace_id,quote_id) WHERE quote_id IS NOT NULL;

CREATE UNIQUE INDEX currencies_code_unique ON currencies(workspace_id,code);

CREATE UNIQUE INDEX bank_reference_unique ON bank_transactions(workspace_id,company_id,bank_account,reference);

ALTER TABLE purchase_order_lines ADD CONSTRAINT po_quantities CHECK(quantity>0 AND received_quantity>=0 AND billed_quantity>=0 AND received_quantity<=quantity AND billed_quantity<=received_quantity);

ALTER TABLE journal_lines ADD CONSTRAINT debit_or_credit CHECK((debit_minor>0 AND credit_minor=0) OR (credit_minor>0 AND debit_minor=0));

ALTER TABLE events ADD CONSTRAINT event_time_semantics CHECK((all_day AND start_date IS NOT NULL AND end_date>start_date AND start_at IS NULL AND end_at IS NULL) OR (NOT all_day AND start_at IS NOT NULL AND end_at>start_at AND start_date IS NULL AND end_date IS NULL));

CREATE FUNCTION protect_posted_journal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='journal_entries' THEN
  IF OLD.status IN ('posted','reversed') AND (TG_OP='DELETE' OR NEW.title IS DISTINCT FROM OLD.title OR NEW.entry_date IS DISTINCT FROM OLD.entry_date OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.source_resource IS DISTINCT FROM OLD.source_resource OR NEW.source_id IS DISTINCT FROM OLD.source_id OR NEW.status NOT IN ('posted','reversed')) THEN RAISE EXCEPTION 'posted_journal_immutable'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM journal_entries WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.entry_id ELSE NEW.entry_id END AND status IN ('posted','reversed')) THEN RAISE EXCEPTION 'posted_journal_immutable'; END IF;
 END IF; IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END; $$;

CREATE TRIGGER protect_journal_entry BEFORE UPDATE OR DELETE ON journal_entries FOR EACH ROW EXECUTE FUNCTION protect_posted_journal();

CREATE TRIGGER protect_journal_lines BEFORE INSERT OR UPDATE OR DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION protect_posted_journal();

CREATE UNIQUE INDEX customer_quotes_number_unique ON customer_quotes(workspace_id,number);

CREATE UNIQUE INDEX customer_invoices_number_unique ON customer_invoices(workspace_id,number);

CREATE UNIQUE INDEX vendor_bills_number_unique ON vendor_bills(workspace_id,number);

CREATE UNIQUE INDEX purchase_orders_number_unique ON purchase_orders(workspace_id,number);

CREATE UNIQUE INDEX journal_entries_number_unique ON journal_entries(workspace_id,number);
