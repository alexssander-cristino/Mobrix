-- Compras, reservas e consumo de materiais por projeto.
CREATE TABLE IF NOT EXISTS purchase_orders (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
 supplier VARCHAR(180),
 status VARCHAR(20) NOT NULL DEFAULT 'rascunho' CHECK(status IN ('rascunho','solicitada','recebida','cancelada')),
 notes TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS purchase_order_items (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
 material_id UUID NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
 quantity NUMERIC(12,3) NOT NULL CHECK(quantity>0),
 unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(unit_cost>=0),
 received_quantity NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK(received_quantity>=0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS material_reservations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 material_id UUID NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
 quantity NUMERIC(12,3) NOT NULL CHECK(quantity>0),
 consumed_quantity NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK(consumed_quantity>=0),
 status VARCHAR(20) NOT NULL DEFAULT 'reservado' CHECK(status IN ('reservado','consumido','liberado')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(company_id,project_id,material_id)
);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_company ON purchase_orders(company_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_items_order ON purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_reservations_project ON material_reservations(company_id,project_id,status);
CREATE OR REPLACE FUNCTION madevix_purchase_company_guard() RETURNS trigger AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM purchase_orders WHERE id=NEW.purchase_order_id AND company_id=NEW.company_id) OR NOT EXISTS(SELECT 1 FROM materials WHERE id=NEW.material_id AND company_id=NEW.company_id) THEN
  RAISE EXCEPTION 'Compra e material devem pertencer à empresa' USING ERRCODE='23503';
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_purchase_item_company ON purchase_order_items;
CREATE TRIGGER trg_purchase_item_company BEFORE INSERT OR UPDATE OF company_id,purchase_order_id,material_id ON purchase_order_items FOR EACH ROW EXECUTE FUNCTION madevix_purchase_company_guard();
