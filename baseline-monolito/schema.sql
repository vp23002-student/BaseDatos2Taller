-- Modelo relacional normalizado equivalente (arquitectura de referencia)
CREATE TABLE IF NOT EXISTS clientes (
  id TEXT PRIMARY KEY, nombre TEXT NOT NULL, telefono TEXT, correo TEXT
);
CREATE TABLE IF NOT EXISTS vehiculos (
  id TEXT PRIMARY KEY, cliente_id TEXT REFERENCES clientes(id), placa TEXT UNIQUE NOT NULL,
  marca TEXT, modelo TEXT, kilometraje_actual INT, km_diario_estimado INT DEFAULT 40
);
CREATE TABLE IF NOT EXISTS repuestos (
  id TEXT PRIMARY KEY, codigo_barras TEXT UNIQUE, descripcion TEXT, existencia NUMERIC NOT NULL,
  minimo_reorden NUMERIC, precio NUMERIC
);
CREATE TABLE IF NOT EXISTS ordenes (
  id TEXT PRIMARY KEY, vehiculo_id TEXT NOT NULL REFERENCES vehiculos(id), fecha DATE NOT NULL,
  kilometraje INT NOT NULL, mecanico TEXT, costo_total NUMERIC, servicios JSONB, repuestos JSONB,
  creada_en TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS alertas (
  vehiculo_id TEXT REFERENCES vehiculos(id), tipo_servicio TEXT, fecha_programada DATE, km_programado INT,
  orden_origen TEXT, estado_envio TEXT, PRIMARY KEY (vehiculo_id, tipo_servicio)
);
CREATE INDEX IF NOT EXISTS idx_ordenes_vehiculo ON ordenes(vehiculo_id, fecha);
