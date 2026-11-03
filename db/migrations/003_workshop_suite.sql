ALTER TABLE companies ADD COLUMN IF NOT EXISTS hourly_cost NUMERIC(12,2) NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS quality_checks (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 order_id UUID REFERENCES production_orders(id) ON DELETE SET NULL,
 stage VARCHAR(60) NOT NULL,
 result VARCHAR(20) NOT NULL DEFAULT 'pendente' CHECK(result IN ('aprovado','reprovado','pendente')),
 checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
 notes TEXT,
 checked_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS project_portal_tokens (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 token_hash CHAR(64) NOT NULL UNIQUE,
 expires_at TIMESTAMPTZ NOT NULL,
 revoked_at TIMESTAMPTZ,
 created_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quality_company_created ON quality_checks(company_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_company_project ON project_portal_tokens(company_id,project_id);
CREATE INDEX IF NOT EXISTS idx_portal_token_expiry ON project_portal_tokens(token_hash,expires_at) WHERE revoked_at IS NULL;
CREATE OR REPLACE FUNCTION mobrix_assert_quality_company() RETURNS trigger AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND company_id=NEW.company_id) THEN
  RAISE EXCEPTION 'Projeto de qualidade não pertence à empresa' USING ERRCODE='23503';
 END IF;
 IF NEW.order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM production_orders WHERE id=NEW.order_id AND project_id=NEW.project_id AND company_id=NEW.company_id) THEN
  RAISE EXCEPTION 'Ordem de qualidade não pertence ao projeto' USING ERRCODE='23503';
 END IF;
 IF NEW.checked_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.checked_by AND company_id=NEW.company_id) THEN
  RAISE EXCEPTION 'Responsável pela inspeção não pertence à empresa' USING ERRCODE='23503';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_quality_company ON quality_checks;
CREATE TRIGGER trg_quality_company BEFORE INSERT OR UPDATE OF company_id,project_id,order_id ON quality_checks
FOR EACH ROW EXECUTE FUNCTION mobrix_assert_quality_company();


CREATE OR REPLACE FUNCTION mobrix_assert_portal_company() RETURNS trigger AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND company_id=NEW.company_id) THEN
  RAISE EXCEPTION 'Projeto do portal não pertence à empresa' USING ERRCODE='23503';
 END IF;
 IF NEW.created_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.created_by AND company_id=NEW.company_id) THEN
  RAISE EXCEPTION 'Criador do link não pertence à empresa' USING ERRCODE='23503';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_portal_company ON project_portal_tokens;
CREATE TRIGGER trg_portal_company BEFORE INSERT OR UPDATE OF company_id,project_id,created_by ON project_portal_tokens
FOR EACH ROW EXECUTE FUNCTION mobrix_assert_portal_company();
