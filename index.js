import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// 🗄️ Configuración de almacenamiento ultra-robusta para Railway y entornos locales
let dbPath;
let db;

try {
    const primaryDir = '/data';
    // Verificar si podemos usar y escribir en el volumen persistente de Railway
    if (!fs.existsSync(primaryDir)) {
        fs.mkdirSync(primaryDir, { recursive: true });
    }
    // Prueba de escritura para validar permisos reales del volumen
    const testFile = path.join(primaryDir, 'test-write.tmp');
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);

    dbPath = path.join(primaryDir, 'rifa.db');
    console.log(`✅ Usando volumen persistente en: ${dbPath}`);
} catch (error) {
    console.warn(`⚠️ No se pudo usar /data (${error.message}). Cambiando a almacenamiento local de respaldo...`);
    const fallbackDir = path.join(__dirname, 'data_local');
    if (!fs.existsSync(fallbackDir)) {
        fs.mkdirSync(fallbackDir, { recursive: true });
    }
    dbPath = path.join(fallbackDir, 'rifa.db');
    console.log(`📁 Usando base de datos local en: ${dbPath}`);
}

// Inicializar la base de datos de forma segura
try {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
} catch (err) {
    console.error(`❌ Error crítico al abrir la base de datos en ${dbPath}:`, err.message);
    process.exit(1);
}

// Crear tablas iniciales si no existen
db.exec(`
    CREATE TABLE IF NOT EXISTS config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        loteria_nombre TEXT,
        sorteo_horario TEXT,
        precio_boleto INTEGER,
        nequi_numero TEXT,
        admin_password TEXT
    );

    CREATE TABLE IF NOT EXISTS boletos (
        numero TEXT PRIMARY KEY,
        estado TEXT,
        nombre TEXT,
        telefono TEXT,
        ciudad TEXT,
        email TEXT,
        loteria TEXT,
        horaSorteo TEXT,
        fechaReserva INTEGER
    );

    CREATE TABLE IF NOT EXISTS historial (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        numero TEXT,
        nombre TEXT,
        telefono TEXT,
        ciudad TEXT,
        email TEXT,
        loteria TEXT,
        fecha TEXT
    );
`);

// Insertar configuración por defecto si la tabla está vacía
const configRow = db.prepare('SELECT * FROM config WHERE id = 1').get();
if (!configRow) {
    db.prepare(`
        INSERT INTO config (id, loteria_nombre, sorteo_horario, precio_boleto, nequi_numero, admin_password)
        VALUES (1, 'Chontico Noche', 'Lunes a Viernes - 7:00 p.m.', 10000, '3150000000', '1234')
    `).run();
}

// ⏱️ Función para liberar reservas vencidas (más de 5 minutos sin pagar)
function verificarReservasExpiradas() {
    const ahora = Date.now();
    const tiempoLimite = 5 * 60 * 1000; // 5 minutos
    
    const expirados = db.prepare("SELECT numero FROM boletos WHERE estado = 'RESERVADO' AND ? - fechaReserva > ?").all(ahora, tiempoLimite);
    const deleteStmt = db.prepare("DELETE FROM boletos WHERE numero = ?");
    
    for (const exp of expirados) {
        deleteStmt.run(exp.numero);
        console.log(`⏰ Boleto #${exp.numero} expiró y volvió a estar disponible.`);
    }
}

setInterval(verificarReservasExpiradas, 30000);

// 📥 Endpoint GET para consultar la configuración actual
app.get('/api/config', (req, res) => {
    const row = db.prepare('SELECT loteria_nombre, sorteo_horario, precio_boleto, nequi_numero FROM config WHERE id = 1').get();
    res.json(row);
});

// 📤 Endpoint POST para actualizar la configuración desde el admin
app.post('/api/config', (req, res) => {
    const { loteria_nombre, sorteo_horario, precio_boleto, nequi_numero } = req.body;
    const current = db.prepare('SELECT * FROM config WHERE id = 1').get();

    const nuevoNombre = loteria_nombre || current.loteria_nombre;
    const nuevoHorario = sorteo_horario || current.sorteo_horario;
    const nuevoPrecio = precio_boleto ? Number(precio_boleto) : current.precio_boleto;
    const nuevoNequi = nequi_numero || current.nequi_numero;

    db.prepare(`
        UPDATE config SET loteria_nombre = ?, sorteo_horario = ?, precio_boleto = ?, nequi_numero = ? WHERE id = 1
    `).run(nuevoNombre, nuevoHorario, nuevoPrecio, nuevoNequi);

    console.log('⚙️ Configuración de la rifa actualizada correctamente.');
    res.json({ success: true, mensaje: "Configuración actualizada con éxito." });
});

// 🔐 Endpoints de Autenticación y Seguridad para Admin
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    const row = db.prepare('SELECT admin_password FROM config WHERE id = 1').get();
    if (row && row.admin_password === password) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, error: "Contraseña incorrecta" });
    }
});

app.post('/api/admin/password', (req, res) => {
    const { nuevaPassword } = req.body;
    if (!nuevaPassword || nuevaPassword.trim() === "") {
        return res.status(400).json({ success: false, error: "Contraseña inválida" });
    }
    db.prepare('UPDATE config SET admin_password = ? WHERE id = 1').run(nuevaPassword);
    console.log('🔑 Contraseña de administrador actualizada.');
    res.json({ success: true, mensaje: "Contraseña actualizada correctamente" });
});

// 📊 Endpoints de Administración Adicionales
app.get('/api/admin/historial', (req, res) => {
    const historial = db.prepare('SELECT * FROM historial ORDER BY id DESC').all();
    res.json(historial);
});

app.post('/api/admin/liberar/:numero', (req, res) => {
    const { numero } = req.params;
    db.prepare('DELETE FROM boletos WHERE numero = ?').run(numero);
    console.log(`🔓 Boleto #${numero} liberado manualmente por el administrador.`);
    res.json({ success: true, mensaje: `Boleto #${numero} liberado con éxito.` });
});

// 1. Obtener todos los boletos
app.get('/api/boletos', (req, res) => {
    verificarReservasExpiradas();
    const rows = db.prepare('SELECT * FROM boletos').all();
    
    const boletosObj = {};
    for (const row of rows) {
        boletosObj[row.numero] = {
            estado: row.estado,
            nombre: row.nombre,
            telefono: row.telefono,
            ciudad: row.ciudad,
            email: row.email,
            loteria: row.loteria,
            horaSorteo: row.horaSorteo,
            fechaReserva: row.fechaReserva
        };
    }
    res.json(boletosObj);
});

// 2. Reservar un boleto
app.post('/api/reservar', (req, res) => {
    verificarReservasExpiradas();
    const { numero, nombre, telefono, ciudad, email, loteria, horaSorteo, acepta_datos } = req.body;

    if (!acepta_datos) {
        return res.status(400).json({ error: "Debe aceptar el tratamiento de datos para continuar." });
    }

    const existing = db.prepare('SELECT estado FROM boletos WHERE numero = ?').get(numero);
    if (existing && existing.estado !== 'DISPONIBLE') {
        return res.status(400).json({ error: "El boleto ya no está disponible." });
    }

    const fechaReserva = Date.now();

    db.prepare(`
        INSERT INTO boletos (numero, estado, nombre, telefono, ciudad, email, loteria, horaSorteo, fechaReserva)
        VALUES (?, 'RESERVADO', ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(numero) DO UPDATE SET
            estado='RESERVADO', nombre=?, telefono=?, ciudad=?, email=?, loteria=?, horaSorteo=?, fechaReserva=?
    `).run(numero, nombre, telefono, ciudad, email, loteria, horaSorteo, fechaReserva, nombre, telefono, ciudad, email, loteria, horaSorteo, fechaReserva);

    db.prepare(`
        INSERT INTO historial (numero, nombre, telefono, ciudad, email, loteria, fecha)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(numero, nombre, telefono, ciudad, email, loteria, new Date().toISOString());

    console.log(`🎟️ Boleto #${numero} reservado por ${nombre}. Expira en 5 minutos.`);
    res.json({ success: true, mensaje: "Reserva exitosa. Tienes 5 minutos para reportar tu pago." });
});

// 3. Marcar un boleto como pagado 💳
app.post('/api/pagar/:numero', (req, res) => {
    const { numero } = req.params;
    const existing = db.prepare('SELECT * FROM boletos WHERE numero = ?').get(numero);
    if (existing) {
        db.prepare("UPDATE boletos SET estado = 'PAGADO' WHERE numero = ?").run(numero);
        console.log(`✅ Boleto #${numero} pagado y confirmado (Jugando).`);
        res.json({ success: true, mensaje: `Boleto ${numero} marcado como pagado.` });
    } else {
        res.status(404).json({ success: false, mensaje: 'Boleto no encontrado.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});