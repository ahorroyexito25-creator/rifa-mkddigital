import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import fs from 'fs';

// Capturar errores no controlados para mostrarlos en los logs de Railway en lugar de apagar el contenedor en silencio
process.on('uncaughtException', (err) => {
    console.error('❌ EXCEPCIÓN NO CAPTURADA:', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('❌ PROMESA RECHAZADA NO CAPTURADA:', reason);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// 🗄️ Inicialización blindada con manejo de errores de esquema y volumen
let db;
try {
    const primaryDir = '/data';
    if (!fs.existsSync(primaryDir)) {
        fs.mkdirSync(primaryDir, { recursive: true });
    }
    const dbPath = path.join(primaryDir, 'rifa.db');
    console.log(`✅ Conectando a SQLite en: ${dbPath}`);
    
    db = new Database(dbPath);
    db.pragma('journal_mode = DELETE');

    // Creación de tablas e inserción protegidas dentro del bloque try
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

    const configRow = db.prepare('SELECT * FROM config WHERE id = 1').get();
    if (!configRow) {
        db.prepare(`
            INSERT INTO config (id, loteria_nombre, sorteo_horario, precio_boleto, nequi_numero, admin_password)
            VALUES (1, 'Chontico Noche', 'Lunes a Viernes - 7:00 p.m.', 10000, '3150000000', '1234')
        `).run();
    }
    console.log('✅ Base de datos inicializada y lista.');
} catch (error) {
    console.error('❌ ERROR FATAL AL INICIALIZAR LA BASE DE DATOS:', error);
    process.exit(1);
}

// ⏱️ Función para liberar reservas vencidas con control de errores
function verificarReservasExpiradas() {
    try {
        const ahora = Date.now();
        const tiempoLimite = 5 * 60 * 1000;
        
        const expirados = db.prepare("SELECT numero FROM boletos WHERE estado = 'RESERVADO' AND ? - fechaReserva > ?").all(ahora, tiempoLimite);
        const deleteStmt = db.prepare("DELETE FROM boletos WHERE numero = ?");
        
        for (const exp of expirados) {
            deleteStmt.run(exp.numero);
            console.log(`⏰ Boleto #${exp.numero} expiró y volvió a estar disponible.`);
        }
    } catch (e) {
        console.error('Error en verificarReservasExpiradas:', e.message);
    }
}

setInterval(verificarReservasExpiradas, 30000);

// Endpoints con bloques seguros de manejo de errores
app.get('/api/config', (req, res) => {
    try {
        const row = db.prepare('SELECT loteria_nombre, sorteo_horario, precio_boleto, nequi_numero FROM config WHERE id = 1').get();
        res.json(row);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/config', (req, res) => {
    try {
        const { loteria_nombre, sorteo_horario, precio_boleto, nequi_numero } = req.body;
        const current = db.prepare('SELECT * FROM config WHERE id = 1').get();

        const nuevoNombre = loteria_nombre || current.loteria_nombre;
        const nuevoHorario = sorteo_horario || current.sorteo_horario;
        const nuevoPrecio = precio_boleto ? Number(precio_boleto) : current.precio_boleto;
        const nuevoNequi = nequi_numero || current.nequi_numero;

        db.prepare(`
            UPDATE config SET loteria_nombre = ?, sorteo_horario = ?, precio_boleto = ?, nequi_numero = ? WHERE id = 1
        `).run(nuevoNombre, nuevoHorario, nuevoPrecio, nuevoNequi);

        res.json({ success: true, mensaje: "Configuración actualizada con éxito." });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/login', (req, res) => {
    try {
        const { password } = req.body;
        const row = db.prepare('SELECT admin_password FROM config WHERE id = 1').get();
        if (row && row.admin_password === password) {
            res.json({ success: true });
        } else {
            res.status(401).json({ success: false, error: "Contraseña incorrecta" });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/password', (req, res) => {
    try {
        const { nuevaPassword } = req.body;
        if (!nuevaPassword || nuevaPassword.trim() === "") {
            return res.status(400).json({ success: false, error: "Contraseña inválida" });
        }
        db.prepare('UPDATE config SET admin_password = ? WHERE id = 1').run(nuevaPassword);
        res.json({ success: true, mensaje: "Contraseña actualizada correctamente" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/historial', (req, res) => {
    try {
        const historial = db.prepare('SELECT * FROM historial ORDER BY id DESC').all();
        res.json(historial);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/liberar/:numero', (req, res) => {
    try {
        const { numero } = req.params;
        db.prepare('DELETE FROM boletos WHERE numero = ?').run(numero);
        res.json({ success: true, mensaje: `Boleto #${numero} liberado con éxito.` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/boletos', (req, res) => {
    try {
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
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/reservar', (req, res) => {
    try {
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

        res.json({ success: true, mensaje: "Reserva exitosa. Tienes 5 minutos para reportar tu pago." });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/pagar/:numero', (req, res) => {
    try {
        const { numero } = req.params;
        const existing = db.prepare('SELECT * FROM boletos WHERE numero = ?').get(numero);
        if (existing) {
            db.prepare("UPDATE boletos SET estado = 'PAGADO' WHERE numero = ?").run(numero);
            res.json({ success: true, mensaje: `Boleto ${numero} marcado como pagado.` });
        } else {
            res.status(404).json({ success: false, mensaje: 'Boleto no encontrado.' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});