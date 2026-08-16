-- Plan-review store. Own database only. Never apply to cortex-prod / atoms / smart-files.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE plan_review_engagements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_node_id text NOT NULL,
  project_type text NOT NULL,
  jurisdiction text,
  stage text NOT NULL DEFAULT 'Submitted',
  org_id text NOT NULL,
  user_id text NOT NULL,
  files_folder_id text,
  scope_text text,
  cotality_calls integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_review_engagements_stage_check
    CHECK (stage IN (
      'Submitted',
      'In Review',
      'Approved',
      'Approved with Conditions',
      'Denied'
    )),
  CONSTRAINT plan_review_engagements_cotality_check
    CHECK (cotality_calls = 0)
);

CREATE INDEX plan_review_engagements_stage_idx ON plan_review_engagements (stage);
CREATE INDEX plan_review_engagements_parcel_idx ON plan_review_engagements (parcel_node_id);

CREATE TABLE plan_review_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid NOT NULL REFERENCES plan_review_engagements (id) ON DELETE CASCADE,
  section_atom_id text NOT NULL,
  book_id text,
  section_id text,
  citation text NOT NULL,
  heading text,
  analysis text,
  determination text NOT NULL,
  confidence jsonb NOT NULL,
  icc_deep_link text,
  body_verbatim boolean NOT NULL DEFAULT false,
  original_determination text,
  override_reason text,
  adjudication_atom_did text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_review_findings_determination_check
    CHECK (determination IN ('Pass', 'Fail', 'Uncertain', 'Unchecked')),
  CONSTRAINT plan_review_findings_no_verbatim_check
    CHECK (body_verbatim = false)
);

CREATE INDEX plan_review_findings_engagement_idx ON plan_review_findings (engagement_id);
CREATE INDEX plan_review_findings_section_idx ON plan_review_findings (section_id);

CREATE TABLE plan_review_canned (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id text,
  label text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plan_review_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid NOT NULL REFERENCES plan_review_engagements (id) ON DELETE CASCADE,
  html text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX plan_review_letters_engagement_uniq ON plan_review_letters (engagement_id);
