ALTER TABLE workspaces ADD COLUMN initial_admin_user_id text REFERENCES "user"(id), ADD COLUMN operational_owner_user_id text REFERENCES "user"(id);
CREATE TABLE company_information (
 workspace_id uuid NOT NULL REFERENCES workspaces(id), company_id uuid PRIMARY KEY REFERENCES companies(id),
 fields jsonb NOT NULL DEFAULT '{}', policy jsonb NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1,
 updated_by text REFERENCES "user"(id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE company_teams (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),description text NOT NULL DEFAULT '',version integer NOT NULL DEFAULT 1,
 created_by text NOT NULL REFERENCES "user"(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id)
);
CREATE TABLE company_team_members (
 workspace_id uuid NOT NULL,team_id uuid NOT NULL,user_id text NOT NULL REFERENCES "user"(id),
 role text NOT NULL CHECK(role IN ('manager','member')),can_post boolean NOT NULL DEFAULT true,
 PRIMARY KEY(team_id,user_id),FOREIGN KEY(workspace_id,team_id) REFERENCES company_teams(workspace_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,user_id) REFERENCES memberships(workspace_id,user_id)
);
CREATE TABLE team_board_posts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,team_id uuid NOT NULL,
 author_id text NOT NULL REFERENCES "user"(id),title text NOT NULL,body text NOT NULL,pinned boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,team_id) REFERENCES company_teams(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX team_board_order ON team_board_posts(team_id,pinned DESC,updated_at DESC);
CREATE TABLE team_board_versions (
 post_id uuid NOT NULL REFERENCES team_board_posts(id),version integer NOT NULL,actor_id text NOT NULL REFERENCES "user"(id),
 snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(post_id,version)
);
