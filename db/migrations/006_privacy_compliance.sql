CREATE TABLE IF NOT EXISTS privacy_acceptances (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  terms_version VARCHAR(20) NOT NULL,
  privacy_version VARCHAR(20) NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_privacy_acceptances_user
  ON privacy_acceptances(user_id, accepted_at DESC);
