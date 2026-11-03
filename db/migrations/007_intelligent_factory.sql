-- MOBRIX INTELLIGENT FACTORY: automacao, engenharia reversa, CNC, showroom, IoT e ciclo de vida.
CREATE TABLE IF NOT EXISTS studio_autopilot_actions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 action_key VARCHAR(180) NOT NULL, category VARCHAR(40) NOT NULL, severity VARCHAR(16) NOT NULL DEFAULT 'info'
 CHECK(severity IN ('info','warning','critical')), title VARCHAR(180) NOT NULL, description TEXT NOT NULL,
 recommendation TEXT NOT NULL, source_ref UUID, status VARCHAR(20) NOT NULL DEFAULT 'open'
 CHECK(status IN ('open','dismissed','done')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(company_id,action_key)
);
CREATE TABLE IF NOT EXISTS studio_reverse_engineering (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 project_id UUID REFERENCES projects(id) ON DELETE SET NULL, title VARCHAR(180) NOT NULL, image_url TEXT NOT NULL,
 width_mm NUMERIC(10,2), height_mm NUMERIC(10,2), depth_mm NUMERIC(10,2), notes TEXT,
 extracted_spec JSONB NOT NULL DEFAULT '{}'::jsonb, status VARCHAR(20) NOT NULL DEFAULT 'review'
 CHECK(status IN ('review','approved','rejected')), created_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS studio_cnc_exports (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, format VARCHAR(24) NOT NULL DEFAULT 'csv',
 machine_profile VARCHAR(100), rows_count INTEGER NOT NULL DEFAULT 0, payload JSONB NOT NULL,
 created_by UUID REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS studio_vision_reviews (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 project_id UUID REFERENCES projects(id) ON DELETE SET NULL, photo_url TEXT NOT NULL, title VARCHAR(180) NOT NULL,
 checklist JSONB NOT NULL DEFAULT '[]', annotations JSONB NOT NULL DEFAULT '[]',
 result VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(result IN ('pending','approved','adjustments','rejected')),
 notes TEXT, reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS studio_showroom_configs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 project_id UUID REFERENCES projects(id) ON DELETE SET NULL, title VARCHAR(180) NOT NULL, model_url TEXT NOT NULL,
 config JSONB NOT NULL DEFAULT '{}'::jsonb, share_token_hash CHAR(64) UNIQUE, expires_at TIMESTAMPTZ,
 created_by UUID REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS studio_factory_simulations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 title VARCHAR(180) NOT NULL, parameters JSONB NOT NULL, result JSONB NOT NULL,
 created_by UUID REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS studio_inventory_scans (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 photo_url TEXT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'review' CHECK(status IN ('review','confirmed','rejected')),
 items JSONB NOT NULL DEFAULT '[]'::jsonb, notes TEXT, created_by UUID REFERENCES users(id) ON DELETE SET NULL,
 confirmed_by UUID REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), confirmed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS studio_assembly_guides (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 project_id UUID REFERENCES projects(id) ON DELETE CASCADE, title VARCHAR(180) NOT NULL, model_url TEXT,
 steps JSONB NOT NULL DEFAULT '[]'::jsonb, created_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS studio_predictive_snapshots (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 period_days INTEGER NOT NULL DEFAULT 30 CHECK(period_days BETWEEN 7 AND 365),
 forecast JSONB NOT NULL, created_by UUID REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS studio_iot_devices (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 machine_id UUID NOT NULL REFERENCES studio_machines(id) ON DELETE CASCADE, name VARCHAR(120) NOT NULL,
 token_hash CHAR(64) NOT NULL UNIQUE, last_seen_at TIMESTAMPTZ, active BOOLEAN NOT NULL DEFAULT TRUE,
 created_by UUID REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS studio_machine_telemetry (
 id BIGSERIAL PRIMARY KEY, company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 machine_id UUID NOT NULL REFERENCES studio_machines(id) ON DELETE CASCADE,
 temperature_c NUMERIC(8,2), vibration_mm_s NUMERIC(8,3), power_kw NUMERIC(10,3),
 energy_kwh NUMERIC(12,3), runtime_hours NUMERIC(10,2), state VARCHAR(24),
 payload JSONB NOT NULL DEFAULT '{}'::jsonb, recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS studio_collaboration_comments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, parent_id UUID REFERENCES studio_collaboration_comments(id) ON DELETE CASCADE,
 content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 5000), mentions JSONB NOT NULL DEFAULT '[]'::jsonb,
 created_by UUID REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 edited_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS studio_product_history (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, event_type VARCHAR(40) NOT NULL,
 title VARCHAR(180) NOT NULL, details JSONB NOT NULL DEFAULT '{}'::jsonb, is_public BOOLEAN NOT NULL DEFAULT FALSE,
 created_by UUID REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_autopilot_open ON studio_autopilot_actions(company_id,status,severity);
CREATE INDEX IF NOT EXISTS idx_reverse_project ON studio_reverse_engineering(company_id,project_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cnc_project ON studio_cnc_exports(company_id,project_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vision_project ON studio_vision_reviews(company_id,project_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_showroom_project ON studio_showroom_configs(company_id,project_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_simulations_company ON studio_factory_simulations(company_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_scans ON studio_inventory_scans(company_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assembly_project ON studio_assembly_guides(company_id,project_id);
CREATE INDEX IF NOT EXISTS idx_predictive_company ON studio_predictive_snapshots(company_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iot_machine ON studio_iot_devices(company_id,machine_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_machine ON studio_machine_telemetry(company_id,machine_id,recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_collab_project ON studio_collaboration_comments(company_id,project_id,created_at);
CREATE INDEX IF NOT EXISTS idx_product_history ON studio_product_history(company_id,project_id,created_at DESC);
CREATE OR REPLACE FUNCTION mobrix_assert_intelligent_company() RETURNS trigger AS $$
BEGIN
 IF NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND company_id=NEW.company_id) THEN
  RAISE EXCEPTION 'Projeto não pertence à empresa' USING ERRCODE='23503';
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['studio_reverse_engineering','studio_cnc_exports','studio_vision_reviews','studio_showroom_configs','studio_assembly_guides','studio_collaboration_comments','studio_product_history'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I','trg_'||t||'_company',t);
  EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF company_id,project_id ON %I FOR EACH ROW EXECUTE FUNCTION mobrix_assert_intelligent_company()','trg_'||t||'_company',t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION mobrix_track_project_history() RETURNS trigger AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO studio_product_history(company_id,project_id,event_type,title,details,is_public)
  VALUES(NEW.company_id,NEW.id,'created','Projeto cadastrado',jsonb_build_object('status',NEW.status),FALSE);
 ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
  INSERT INTO studio_product_history(company_id,project_id,event_type,title,details,is_public)
  VALUES(NEW.company_id,NEW.id,'status','Situação do projeto atualizada',jsonb_build_object('from',OLD.status,'to',NEW.status),TRUE);
 ELSIF OLD.deadline IS DISTINCT FROM NEW.deadline THEN
  INSERT INTO studio_product_history(company_id,project_id,event_type,title,details,is_public)
  VALUES(NEW.company_id,NEW.id,'deadline','Prazo do projeto atualizado',jsonb_build_object('deadline',NEW.deadline),FALSE);
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_studio_project_history ON projects;
CREATE TRIGGER trg_studio_project_history AFTER INSERT OR UPDATE OF status,deadline ON projects
 FOR EACH ROW EXECUTE FUNCTION mobrix_track_project_history();
CREATE OR REPLACE FUNCTION mobrix_track_order_history() RETURNS trigger AS $$
BEGIN
 IF OLD.stage IS DISTINCT FROM NEW.stage AND NEW.project_id IS NOT NULL THEN
  INSERT INTO studio_product_history(company_id,project_id,event_type,title,details,is_public)
  VALUES(NEW.company_id,NEW.project_id,'production','Etapa de fabricação atualizada',jsonb_build_object('from',OLD.stage,'to',NEW.stage,'order_id',NEW.id),TRUE);
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_studio_order_history ON production_orders;
CREATE TRIGGER trg_studio_order_history AFTER UPDATE OF stage ON production_orders
 FOR EACH ROW EXECUTE FUNCTION mobrix_track_order_history();
