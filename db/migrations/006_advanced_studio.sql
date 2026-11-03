-- MOBRIX ADVANCED STUDIO: máquinas, planejamento, nesting, cotações, configurador, inspeções e passaporte.
CREATE TABLE IF NOT EXISTS studio_machines (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 name VARCHAR(140) NOT NULL, code VARCHAR(50), area VARCHAR(100), status VARCHAR(24) NOT NULL DEFAULT 'operacional'
 CHECK(status IN ('operacional','parada','manutencao','inativa')),
 maintenance_interval_hours NUMERIC(10,2) NOT NULL DEFAULT 500 CHECK(maintenance_interval_hours>0),
 operating_hours NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(operating_hours>=0),
 last_service_at DATE, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS studio_machine_logs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 machine_id UUID NOT NULL REFERENCES studio_machines(id) ON DELETE CASCADE, kind VARCHAR(24) NOT NULL CHECK(kind IN ('uso','manutencao','parada')),
 description VARCHAR(240) NOT NULL, hours NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK(hours>=0), logged_at DATE NOT NULL DEFAULT CURRENT_DATE,
 created_by UUID REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS studio_schedule (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 order_id UUID NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE, project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 stage VARCHAR(40) NOT NULL, planned_start TIMESTAMPTZ NOT NULL, planned_end TIMESTAMPTZ NOT NULL,
 planned_minutes INTEGER NOT NULL CHECK(planned_minutes>0), status VARCHAR(20) NOT NULL DEFAULT 'planejado'
 CHECK(status IN ('planejado','em_execucao','concluido','reprogramar')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(company_id,order_id,stage)
);
CREATE TABLE IF NOT EXISTS studio_nesting_runs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, sheet_width NUMERIC(10,2) NOT NULL,
 sheet_height NUMERIC(10,2) NOT NULL, kerf_mm NUMERIC(6,2) NOT NULL DEFAULT 3,
 result JSONB NOT NULL, utilization NUMERIC(6,2) NOT NULL, created_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS studio_supplier_quotes (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 supplier_name VARCHAR(160) NOT NULL, material_id UUID REFERENCES materials(id) ON DELETE SET NULL,
 description VARCHAR(180) NOT NULL, unit_price NUMERIC(12,2) NOT NULL CHECK(unit_price>=0),
 quantity NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK(quantity>0), lead_days INTEGER CHECK(lead_days>=0),
 quoted_at DATE NOT NULL DEFAULT CURRENT_DATE, notes TEXT, created_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS studio_configurations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 project_id UUID REFERENCES projects(id) ON DELETE SET NULL, name VARCHAR(160) NOT NULL,
 config JSONB NOT NULL, parts JSONB NOT NULL, material_area_m2 NUMERIC(12,4) NOT NULL DEFAULT 0,
 estimated_cost NUMERIC(12,2) NOT NULL DEFAULT 0, created_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS studio_inspections (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, order_id UUID REFERENCES production_orders(id) ON DELETE SET NULL,
 stage VARCHAR(40) NOT NULL, result VARCHAR(20) NOT NULL CHECK(result IN ('aprovado','ajustes','reprovado')),
 checklist JSONB NOT NULL DEFAULT '[]', notes TEXT, photo_url TEXT,
 inspected_by UUID REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS studio_passports (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, token_hash CHAR(64) NOT NULL UNIQUE,
 warranty_until DATE, expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ,
 created_by UUID REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_studio_machines_company ON studio_machines(company_id,status);
CREATE INDEX IF NOT EXISTS idx_studio_schedule_company ON studio_schedule(company_id,planned_start);
CREATE INDEX IF NOT EXISTS idx_studio_quotes_material ON studio_supplier_quotes(company_id,material_id,unit_price);
CREATE INDEX IF NOT EXISTS idx_studio_inspections_project ON studio_inspections(company_id,project_id,created_at DESC);
CREATE OR REPLACE FUNCTION mobrix_assert_studio_project() RETURNS trigger AS $$
BEGIN
 IF NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND company_id=NEW.company_id) THEN
  RAISE EXCEPTION 'Projeto não pertence à empresa' USING ERRCODE='23503';
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['studio_nesting_runs','studio_configurations','studio_inspections','studio_passports'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I','trg_'||t||'_company',t);
  EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF company_id,project_id ON %I FOR EACH ROW EXECUTE FUNCTION mobrix_assert_studio_project()','trg_'||t||'_company',t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION mobrix_assert_studio_machine() RETURNS trigger AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM studio_machines WHERE id=NEW.machine_id AND company_id=NEW.company_id) THEN
  RAISE EXCEPTION 'Máquina não pertence à empresa' USING ERRCODE='23503';
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_studio_machine_log_company ON studio_machine_logs;
CREATE TRIGGER trg_studio_machine_log_company BEFORE INSERT OR UPDATE OF company_id,machine_id ON studio_machine_logs
 FOR EACH ROW EXECUTE FUNCTION mobrix_assert_studio_machine();
