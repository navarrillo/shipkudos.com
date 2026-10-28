CREATE TABLE profile_share_cards (
  profile_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  period integer NOT NULL CHECK (period IN (7,30)),
  version text NOT NULL,
  png bytea NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (profile_id, period, version)
);
CREATE INDEX profile_share_cards_latest ON profile_share_cards(profile_id, period, created_at DESC);
