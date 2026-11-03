-- MOBRIX FACTORY INTELLIGENCE: rastreabilidade, custos, aprovação e levantamento.
CREATE TABLE IF NOT EXISTS project_measurements (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, room VARCHAR(120) NOT NULL,
 wall VARCHAR(120), width_mm NUMERIC(10,2), height_mm NUMERIC(10,2), depth_mm NUMERIC(10,2),
 doors JSONB NOT NULL DEFAULT '[]'::jsonb, windows JSONB NOT NULL DEFAULT '[]'::jsonb,
 outlets JSONB NOT NULL DEFAULT '[]'::jsonb, notes TEXT, photo_url TEXT,
 measured_by UUID REFERENCES users(id) ON DELETE SET NULL, measured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS project_cost_items (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, category VARCHAR(40) NOT NULL CHECK(category IN ('material','mao_de_obra','terceiro','frete','retrabalho','outro')),
 description VARCHAR(180) NOT NULL, quantity NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK(quantity>0),
 unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(unit_cost>=0), incurred_on DATE NOT NULL DEFAULT CURRENT_DATE,
 notes TEXT, created_by UUID REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS production_trace_labels (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, part_id UUID REFERENCES project_parts(id) ON DELETE SET NULL,
 order_id UUID REFERENCES production_orders(id) ON DELETE SET NULL, label_code VARCHAR(40) NOT NULL,
 part_name VARCHAR(160) NOT NULL, dimensions VARCHAR(100), unit_number INTEGER NOT NULL DEFAULT 1,
 status VARCHAR(30) NOT NULL DEFAULT 'aguardando' CHECK(status IN ('aguardando','corte','usinagem','montagem','acabamento','instalacao','concluida','problema')),
 notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(company_id,label_code)
);
CREATE TABLE IF NOT EXISTS production_trace_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 label_id UUID NOT NULL REFERENCES production_trace_labels(id) ON DELETE CASCADE,
 from_status VARCHAR(30), to_status VARCHAR(30) NOT NULL, notes TEXT,
 changed_by UUID REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS project_approvals (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, token_hash CHAR(64) NOT NULL UNIQUE,
 status VARCHAR(20) NOT NULL DEFAULT 'aguardando' CHECK(status IN ('aguardando','aprovado','ajustes','revogado','expirado')),
 expires_at TIMESTAMPTZ NOT NULL, responded_at TIMESTAMPTZ, response_notes TEXT,
 created_by UUID REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS cnc_exports (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, format VARCHAR(20) NOT NULL,
 file_name VARCHAR(180) NOT NULL, created_by UUID REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS production_capacity (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 stage VARCHAR(40) NOT NULL, daily_minutes INTEGER NOT NULL DEFAULT 480 CHECK(daily_minutes BETWEEN 1 AND 1440),
 UNIQUE(company_id,stage)
);
CREATE INDEX IF NOT EXISTS idx_measurements_project ON project_measurements(company_id,project_id,measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_items_project ON project_cost_items(company_id,project_id,incurred_on DESC);
CREATE INDEX IF NOT EXISTS idx_trace_project ON production_trace_labels(company_id,project_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trace_events ON production_trace_events(company_id,label_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approvals_project ON project_approvals(company_id,project_id,created_at DESC);
CREATE OR REPLACE FUNCTION mobrix_assert_innovation_company() RETURNS trigger AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND company_id=NEW.company_id) THEN
  RAISE EXCEPTION 'Projeto não pertence à empresa' USING ERRCODE='23503';
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['project_measurements','project_cost_items','production_trace_labels','project_approvals','cnc_exports'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_company ON %I',t,t);
  EXECUTE format('CREATE TRIGGER trg_%I_company BEFORE INSERT OR UPDATE OF company_id,project_id ON %I FOR EACH ROW EXECUTE FUNCTION mobrix_assert_innovation_company()',t,t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION mobrix_assert_trace_part_company() RETURNS trigger AS $$
BEGIN
 IF NEW.part_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM project_parts WHERE id=NEW.part_id AND project_id=NEW.project_id AND company_id=NEW.company_id) THEN
  RAISE EXCEPTION 'Peça não pertence ao projeto' USING ERRCODE='23503';
 END IF;
 IF NEW.order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM production_orders WHERE id=NEW.order_id AND project_id=NEW.project_id AND company_id=NEW.company_id) THEN
  RAISE EXCEPTION 'Ordem não pertence ao projeto' USING ERRCODE='23503';
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_trace_part_company ON production_trace_labels;
CREATE TRIGGER trg_trace_part_company BEFORE INSERT OR UPDATE OF company_id,project_id,part_id,order_id ON production_trace_labels FOR EACH ROW EXECUTE FUNCTION mobrix_assert_trace_part_company();
