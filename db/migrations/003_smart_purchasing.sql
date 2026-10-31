ALTER TABLE materials ADD COLUMN IF NOT EXISTS sheet_length_mm INTEGER CHECK (sheet_length_mm IS NULL OR sheet_length_mm > 0);
ALTER TABLE materials ADD COLUMN IF NOT EXISTS sheet_width_mm INTEGER CHECK (sheet_width_mm IS NULL OR sheet_width_mm > 0);
