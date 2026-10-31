-- MOBRIX 2.0: módulos industriais adicionais.
-- Migração incremental: não remove nem recria dados existentes.

CREATE TABLE IF NOT EXISTS project_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  material_id UUID REFERENCES materials(id) ON DELETE SET NULL,
  name VARCHAR(160) NOT NULL,
  length_mm INTEGER NOT NULL CHECK (length_mm > 0),
  width_mm INTEGER NOT NULL CHECK (width_mm > 0),
  thickness_mm NUMERIC(8,2) NOT NULL CHECK (thickness_mm > 0),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  grain_direction VARCHAR(20) NOT NULL DEFAULT 'livre' CHECK (grain_direction IN ('livre','comprimento','largura')),
  edge_banding VARCHAR(30),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS offcuts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  material_id UUID REFERENCES materials(id) ON DELETE SET NULL,
  label VARCHAR(120) NOT NULL,
  length_mm INTEGER NOT NULL CHECK (length_mm > 0),
  width_mm INTEGER NOT NULL CHECK (width_mm > 0),
  thickness_mm NUMERIC(8,2) NOT NULL CHECK (thickness_mm > 0),
  grain_direction VARCHAR(20) NOT NULL DEFAULT 'livre' CHECK (grain_direction IN ('livre','comprimento','largura')),
  status VARCHAR(20) NOT NULL DEFAULT 'disponivel' CHECK (status IN ('disponivel','reservado','consumido','descartado')),
  source_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  order_id UUID REFERENCES production_orders(id) ON DELETE SET NULL,
  employee_name VARCHAR(120) NOT NULL,
  operation VARCHAR(80) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE TABLE IF NOT EXISTS production_stage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  from_stage VARCHAR(40),
  to_stage VARCHAR(40) NOT NULL,
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parts_company_project ON project_parts(company_id, project_id);
CREATE INDEX IF NOT EXISTS idx_offcuts_company_status ON offcuts(company_id, status);
CREATE INDEX IF NOT EXISTS idx_time_entries_company_project ON time_entries(company_id, project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_stage_logs_company_order ON production_stage_logs(company_id, order_id, created_at DESC);

-- Impede referências cruzadas entre empresas nos novos módulos.
CREATE OR REPLACE FUNCTION mobrix_assert_project_company() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id=NEW.project_id AND company_id=NEW.company_id) THEN
    RAISE EXCEPTION 'Projeto não pertence à empresa autenticada' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_parts_company ON project_parts;
CREATE TRIGGER trg_parts_company BEFORE INSERT OR UPDATE OF company_id, project_id ON project_parts
FOR EACH ROW EXECUTE FUNCTION mobrix_assert_project_company();

DROP TRIGGER IF EXISTS trg_time_entries_company ON time_entries;
CREATE TRIGGER trg_time_entries_company BEFORE INSERT OR UPDATE OF company_id, project_id ON time_entries
FOR EACH ROW EXECUTE FUNCTION mobrix_assert_project_company();

CREATE OR REPLACE FUNCTION mobrix_assert_order_company() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM production_orders WHERE id=NEW.order_id AND company_id=NEW.company_id) THEN
    RAISE EXCEPTION 'Ordem não pertence à empresa autenticada' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stage_logs_company ON production_stage_logs;
CREATE TRIGGER trg_stage_logs_company BEFORE INSERT OR UPDATE OF company_id, order_id ON production_stage_logs
FOR EACH ROW EXECUTE FUNCTION mobrix_assert_order_company();

