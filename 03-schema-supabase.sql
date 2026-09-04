-- ============================================================
-- Rifa MKDdigital · Esquema de base de datos para Supabase
-- Ejecutar completo en: Supabase → SQL Editor → New Query → Run
-- Es seguro volver a ejecutarlo (usa IF NOT EXISTS).
-- ============================================================

-- Tabla de configuración general de la rifa (una sola fila, id = 1)
create table if not exists config (
    id integer primary key default 1,
    pais text default 'colombia',
    moneda text default 'COP',
    simbolo_moneda text default '$',
    loteria_nombre text default 'Chontico Noche',
    fecha_sorteo text default '2026-09-05T19:00',
    precio_boleto numeric default 10000,
    premio_mayor text default '700.000 $ COP',
    nequi_numero text default '',
    nequi_qr text default '',
    bancolombia_numero text default '',
    bancolombia_qr text default '',
    pago_movil_datos text default '',
    whatsapp_numero text default '573150000000',
    reserva_duracion_valor integer default 5,
    reserva_duracion_unidad text default 'minutos',
    admin_password_hash text,
    admin_password_salt text
);

-- Tablero de boletos activos: solo existe una fila mientras el boleto
-- está RESERVADO, PAGADO o GANADOR. Si no hay fila para un número, está disponible.
create table if not exists boletos (
    numero text primary key,
    estado text not null check (estado in ('RESERVADO', 'PAGADO', 'GANADOR')),
    nombre text,
    telefono text,
    ciudad text,
    email text,
    loteria text,
    fecha_sorteo text,
    fecha_compra text,
    timestamp_reserva bigint
);

-- Historial permanente de cada intento de reserva/compra (para auditoría)
create table if not exists historial (
    id bigserial primary key,
    numero text,
    nombre text,
    telefono text,
    ciudad text,
    email text,
    loteria text,
    fecha timestamptz default now()
);

-- Historial permanente de ganadores. NO se borra al reiniciar el tablero.
create table if not exists ganadores (
    id bigserial primary key,
    numero text,
    nombre text,
    telefono text,
    ciudad text,
    loteria_nombre text,
    fecha_sorteo text,
    fecha_declaracion timestamptz default now()
);

-- ============================================================
-- Seguridad: activa Row Level Security y NO se crean políticas.
-- Esto bloquea el acceso a estas tablas desde el navegador (clave "anon"/pública).
-- Solo tu backend en Render puede leer/escribir, usando la clave "service_role"
-- (que se guarda como variable de entorno secreta, nunca en el frontend).
-- ============================================================
alter table config enable row level security;
alter table boletos enable row level security;
alter table historial enable row level security;
alter table ganadores enable row level security;
