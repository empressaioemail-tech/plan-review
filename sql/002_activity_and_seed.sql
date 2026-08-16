-- Activity cache for /icc/activity. Source of truth later is the inbound ledger.
-- File bytes do not live here. Documents are Smart Files.
CREATE TABLE IF NOT EXISTS plan_review_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_did text NOT NULL DEFAULT 'did:hauska:actor:org:icc',
  source text NOT NULL,
  book_id text,
  section_id text,
  engagement_id uuid REFERENCES plan_review_engagements (id) ON DELETE SET NULL,
  rate numeric NOT NULL DEFAULT 0.01,
  amount numeric NOT NULL DEFAULT 0.01,
  tier text NOT NULL DEFAULT 'poc-fixture',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plan_review_activity_actor_idx
  ON plan_review_activity (actor_did, created_at DESC);

INSERT INTO plan_review_canned (section_id, label, body)
SELECT 'R311.7', 'Stair geometry', 'Verify stair riser and tread against the adopted IBC section. Cite the atom ID. Do not paste ICC body.'
WHERE NOT EXISTS (SELECT 1 FROM plan_review_canned WHERE section_id = 'R311.7');
