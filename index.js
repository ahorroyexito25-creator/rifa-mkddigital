import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

app.get('/', (req, res) => {
    const indexPath = path.join(publicDir, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(200).json({
            status: "online",
            mensaje: "API Rifa Activa. El archivo index.html no se encuentra en la carpeta public."
        });
    }
});

// ============================================================
// Conexión a Supabase
// ============================================================
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.error('⚠️  Faltan las variables de entorno SUPABASE_URL y/o SUPABASE_KEY. El servidor no puede funcionar sin ellas.');
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ============================================================
// Utilidades de contraseña (hash + salt, sin dependencias nuevas)
// ============================================================
function hashPassword(password, salt) {
    return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function crearCredencial(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);
    return { admin_password_hash: hash, admin_password_salt: salt };
}

function verificarCredencial(password, hash, salt) {
    if (!hash || !salt) return false;
    const intento = hashPassword(password, salt);
    const bufIntento = Buffer.from(intento, 'hex');
    const bufHash = Buffer.from(hash, 'hex');
    if (bufIntento.length !== bufHash.length) return false;
    return crypto.timingSafeEqual(bufIntento, bufHash);
}

// ============================================================
// Sesiones de admin en memoria (suficiente para una sola instancia,
// como el plan Free de Render). Expiran a las 2 horas.
// ============================================================
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
const sesionesAdmin = new Map(); // token -> expiraEn

function generarToken() {
    return crypto.randomBytes(32).toString('hex');
}

function requireAdmin(req, res, next) {
    const token = req.headers['x-admin-token'];
    if (!token || !sesionesAdmin.has(token)) {
        return res.status(401).json({ success: false, error: 'No autorizado. Inicia sesión de nuevo.' });
    }
    const expiraEn = sesionesAdmin.get(token);
    if (Date.now() > expiraEn) {
        sesionesAdmin.delete(token);
        return res.status(401).json({ success: false, error: 'Sesión expirada. Inicia sesión de nuevo.' });
    }
    sesionesAdmin.set(token, Date.now() + TOKEN_TTL_MS);
    next();
}

// ============================================================
// Duración configurable de la reserva (minutos / horas / días)
// ============================================================
function calcularDuracionReservaMs(config) {
    const valor = Number(config?.reserva_duracion_valor) > 0 ? Number(config.reserva_duracion_valor) : 5;
    const unidad = config?.reserva_duracion_unidad || 'minutos';
    const factores = { minutos: 60 * 1000, horas: 60 * 60 * 1000, dias: 24 * 60 * 60 * 1000 };
    return valor * (factores[unidad] || factores.minutos);
}

function configPorDefecto() {
    const credencial = crearCredencial('1234');
    return {
        id: 1,
        pais: 'colombia',
        moneda: 'COP',
        simbolo_moneda: '$',
        loteria_nombre: 'Chontico Noche',
        fecha_sorteo: '2026-09-05T19:00',
        precio_boleto: 10000,
        premio_mayor: '700.000 $ COP',
        nequi_numero: '3150000000',
        nequi_qr: '',
        bancolombia_numero: '000-00000-00',
        bancolombia_qr: '',
        pago_movil_datos: 'Banco: Mercantil | Tel: 0414-0000000 | C.I: V-12345678',
        whatsapp_numero: '573150000000',
        reserva_duracion_valor: 5,
        reserva_duracion_unidad: 'minutos',
        ...credencial
    };
}

// ============================================================
// Acceso a datos (Supabase / Postgres)
// ============================================================

// Trae la fila de configuración (id=1). Si no existe todavía, la crea.
async function obtenerConfig() {
    const { data, error } = await supabase.from('config').select('*').eq('id', 1).maybeSingle();
    if (error) {
        console.error('Error al leer config de Supabase:', error.message);
        throw error;
    }
    if (data) return data;

    const nueva = configPorDefecto();
    const { data: creada, error: errorInsert } = await supabase.from('config').insert(nueva).select().single();
    if (errorInsert) {
        console.error('Error al crear config inicial en Supabase:', errorInsert.message);
        throw errorInsert;
    }
    return creada;
}

// Config "segura" para exponer públicamente: nunca debe salir el hash/salt de la contraseña.
function configPublica(config) {
    const { admin_password_hash, admin_password_salt, ...resto } = config;
    return resto;
}

async function actualizarConfig(cambios) {
    const { error } = await supabase.from('config').update(cambios).eq('id', 1);
    if (error) {
        console.error('Error al actualizar config en Supabase:', error.message);
        throw error;
    }
}

// Borra reservas cuyo tiempo límite ya venció, según la duración configurada.
async function limpiarReservasExpiradas(config) {
    const duracionMs = calcularDuracionReservaMs(config);
    const limite = Date.now() - duracionMs;
    const { error } = await supabase
        .from('boletos')
        .delete()
        .eq('estado', 'RESERVADO')
        .lt('timestamp_reserva', limite);
    if (error) {
        console.error('Error al limpiar reservas expiradas:', error.message);
    }
}

// Trae todos los boletos activos (reservados / pagados / ganadores) como objeto { "05": {...}, ... },
// igual que antes se leía del archivo JSON, para no tener que tocar el frontend.
async function obtenerBoletosObj() {
    const { data, error } = await supabase.from('boletos').select('*');
    if (error) {
        console.error('Error al leer boletos de Supabase:', error.message);
        throw error;
    }
    const obj = {};
    for (const fila of data) {
        obj[fila.numero] = {
            estado: fila.estado,
            nombre: fila.nombre,
            telefono: fila.telefono,
            ciudad: fila.ciudad,
            email: fila.email,
            loteria: fila.loteria,
            fechaSorteo: fila.fecha_sorteo,
            fechaCompra: fila.fecha_compra,
            timestampReserva: fila.timestamp_reserva
        };
    }
    return obj;
}

// ============================================================
// Rutas públicas
// ============================================================
app.get('/api/config', async (req, res) => {
    try {
        const config = await obtenerConfig();
        res.json(configPublica(config));
    } catch (e) {
        res.status(500).json({ error: 'Error al leer la configuración.' });
    }
});

app.get('/api/boletos', async (req, res) => {
    try {
        const boletos = await obtenerBoletosObj();
        res.json(boletos);
    } catch (e) {
        res.status(500).json({ error: 'Error al leer los boletos.' });
    }
});

app.post('/api/reservar', async (req, res) => {
    try {
        const config = await obtenerConfig();
        await limpiarReservasExpiradas(config);

        const { numero, nombre, telefono, ciudad, email, loteria, fechaSorteo, aceptas_datos } = req.body;

        if (!aceptas_datos) {
            return res.status(400).json({ error: "Debe aceptar el tratamiento de datos." });
        }
        if (!numero) {
            return res.status(400).json({ error: "Falta el número de boleto." });
        }

        const { data: existente } = await supabase.from('boletos').select('estado').eq('numero', numero).maybeSingle();
        if (existente) {
            return res.status(400).json({ error: "El boleto ya no está disponible." });
        }

        const fechaCompra = new Date().toLocaleString('es-ES', {
            timeZone: 'America/Bogota',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        const timestampReserva = Date.now();

        const { error: errorInsert } = await supabase.from('boletos').insert({
            numero, estado: 'RESERVADO', nombre, telefono, ciudad, email, loteria,
            fecha_sorteo: fechaSorteo, fecha_compra: fechaCompra, timestamp_reserva: timestampReserva
        });
        if (errorInsert) {
            // Si dos personas reservan el mismo número al mismo tiempo, la restricción UNIQUE de la tabla lo evita.
            return res.status(400).json({ error: "El boleto ya no está disponible." });
        }

        await supabase.from('historial').insert({
            numero, nombre, telefono, ciudad, email, loteria
        });

        res.json({
            success: true,
            timestampReserva,
            duracionReservaMs: calcularDuracionReservaMs(config)
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error de servidor al reservar el boleto.' });
    }
});

app.post('/api/admin/login', async (req, res) => {
    try {
        const config = await obtenerConfig();
        const ok = verificarCredencial(req.body.password, config.admin_password_hash, config.admin_password_salt);
        if (ok) {
            const token = generarToken();
            sesionesAdmin.set(token, Date.now() + TOKEN_TTL_MS);
            res.json({ success: true, token });
        } else {
            res.status(401).json({ success: false, error: "Contraseña incorrecta" });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: 'Error de servidor al iniciar sesión.' });
    }
});

// ============================================================
// Rutas protegidas de administración
// ============================================================
app.post('/api/config', requireAdmin, async (req, res) => {
    try {
        const {
            pais, moneda, simbolo_moneda, loteria_nombre, fecha_sorteo,
            precio_boleto, premio_mayor, nequi_numero, nequi_qr,
            bancolombia_numero, bancolombia_qr, pago_movil_datos, whatsapp_numero,
            reserva_duracion_valor, reserva_duracion_unidad
        } = req.body;

        const cambios = {};
        if (pais) cambios.pais = pais;
        if (moneda) cambios.moneda = moneda;
        if (simbolo_moneda) cambios.simbolo_moneda = simbolo_moneda;
        if (loteria_nombre) cambios.loteria_nombre = loteria_nombre;
        if (fecha_sorteo) cambios.fecha_sorteo = fecha_sorteo;
        if (precio_boleto) cambios.precio_boleto = Number(precio_boleto);
        if (premio_mayor) cambios.premio_mayor = premio_mayor;
        if (nequi_numero !== undefined) cambios.nequi_numero = nequi_numero;
        if (nequi_qr !== undefined) cambios.nequi_qr = nequi_qr;
        if (bancolombia_numero !== undefined) cambios.bancolombia_numero = bancolombia_numero;
        if (bancolombia_qr !== undefined) cambios.bancolombia_qr = bancolombia_qr;
        if (pago_movil_datos !== undefined) cambios.pago_movil_datos = pago_movil_datos;
        if (whatsapp_numero !== undefined) cambios.whatsapp_numero = whatsapp_numero;
        if (reserva_duracion_valor && Number(reserva_duracion_valor) > 0) cambios.reserva_duracion_valor = Number(reserva_duracion_valor);
        if (reserva_duracion_unidad && ['minutos', 'horas', 'dias'].includes(reserva_duracion_unidad)) cambios.reserva_duracion_unidad = reserva_duracion_unidad;

        await obtenerConfig(); // asegura que la fila exista antes de actualizar
        await actualizarConfig(cambios);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Error al guardar la configuración.' });
    }
});

app.post('/api/admin/password', requireAdmin, async (req, res) => {
    try {
        const { nuevaPassword } = req.body;
        if (nuevaPassword && nuevaPassword.trim() !== "") {
            const credencial = crearCredencial(nuevaPassword.trim());
            await actualizarConfig(credencial);
            res.json({ success: true });
        } else {
            res.status(400).json({ success: false, error: "Contraseña inválida" });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: 'Error al actualizar la contraseña.' });
    }
});

app.get('/api/admin/historial', requireAdmin, async (req, res) => {
    const { data, error } = await supabase.from('historial').select('*').order('fecha', { ascending: false }).limit(500);
    if (error) return res.status(500).json({ error: 'Error al leer el historial.' });
    res.json(data);
});

app.get('/api/admin/ganadores', requireAdmin, async (req, res) => {
    const { data, error } = await supabase.from('ganadores').select('*').order('fecha_declaracion', { ascending: false });
    if (error) return res.status(500).json({ error: 'Error al leer los ganadores.' });
    res.json(data);
});

app.post('/api/admin/liberar/:numero', requireAdmin, async (req, res) => {
    const { error } = await supabase.from('boletos').delete().eq('numero', req.params.numero);
    if (error) return res.status(500).json({ success: false, error: 'Error al liberar el boleto.' });
    res.json({ success: true });
});

app.post('/api/pagar/:numero', requireAdmin, async (req, res) => {
    const { data, error } = await supabase
        .from('boletos')
        .update({ estado: 'PAGADO' })
        .eq('numero', req.params.numero)
        .select()
        .maybeSingle();
    if (error || !data) return res.status(404).json({ success: false });
    res.json({ success: true, boleto: data });
});

// Declara ganador: registra en la tabla "ganadores" (permanente, sobrevive al reseteo)
// y marca el boleto como GANADOR en el tablero actual.
app.post('/api/admin/ganador/:numero', requireAdmin, async (req, res) => {
    try {
        const numero = req.params.numero;
        const { data: boleto, error: errorUpdate } = await supabase
            .from('boletos')
            .update({ estado: 'GANADOR' })
            .eq('numero', numero)
            .select()
            .maybeSingle();

        if (errorUpdate || !boleto) {
            return res.status(404).json({ success: false, error: "Ese boleto no tiene un registro activo." });
        }

        const config = await obtenerConfig();
        const registroGanador = {
            numero,
            nombre: boleto.nombre || '',
            telefono: boleto.telefono || '',
            ciudad: boleto.ciudad || '',
            loteria_nombre: config.loteria_nombre,
            fecha_sorteo: config.fecha_sorteo
        };

        const { data: guardado, error: errorInsert } = await supabase
            .from('ganadores')
            .insert(registroGanador)
            .select()
            .single();
        if (errorInsert) throw errorInsert;

        res.json({ success: true, ganador: guardado });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, error: 'Error al declarar el ganador.' });
    }
});

// Reinicia el tablero para un nuevo sorteo. Borra todos los boletos activos,
// pero la tabla "ganadores" NO se toca: queda como registro permanente.
app.post('/api/admin/resetar-sorteo', requireAdmin, async (req, res) => {
    const { error } = await supabase.from('boletos').delete().not('numero', 'is', null);
    if (error) return res.status(500).json({ success: false, error: 'Error al reiniciar el sorteo.' });
    res.json({ success: true, mensaje: "Tablero reiniciado correctamente. El historial de ganadores se conserva." });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
