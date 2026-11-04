CREATE TABLE IF NOT EXISTS privacy_requests (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  email VARCHAR(180) NOT NULL,
  company_name VARCHAR(160),
  request_type VARCHAR(32) NOT NULL CHECK (request_type IN ('confirmacao','acesso','correcao','eliminacao','compartilhamento','revogacao','outro')),
  description TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'recebida' CHECK (status IN ('recebida','em_analise','respondida','encerrada')),
  ip_address VARCHAR(64),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_created ON privacy_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_email ON privacy_requests(LOWER(email));
