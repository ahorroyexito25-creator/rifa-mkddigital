import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Detectar automáticamente dónde está el frontend para evitar errores 502
let publicDir = path.join(__dirname, 'frontend');
if (!fs.existsSync(publicDir)) {
    publicDir = path.join(__dirname, 'public');
}
if (!fs.existsSync(publicDir) && fs.existsSync(path.join(__dirname, 'index.html'))) {
    publicDir = __dirname;
}

app.use(express.static(publicDir));

app.get('/', (req, res) => {
    const indexPath = path.join(publicDir, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.send(`
            <!DOCTYPE html>
            <html lang="es">
            <head><meta charset="UTF-8"><title>Backend Activo</title></head>
            <body style="font-family: Arial; text-align: center; padding-top: 50px; background: #0f172a; color: white;">
                <h1>🚀 ¡El Servidor Backend está en línea!</h1>
                <p>El backend funciona correctamente. Asegúrate de que tu archivo <b>index.html</b> esté en el repositorio.</p>
            </body>
            </html>
        `);
    }
});

// Ruta del archivo de base de datos en el volumen persistente de Railway
const DATA_DIR = '/data';
const DB_FILE = path.join(DATA_DIR, 'rifa.json');

function cargarBD() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        if (!fs.existsSync(DB_FILE)) {
            const initialData = {
                config: {
                    id: 1,
                    loteria_nombre: 'Chontico Noche',
                    sorteo_horario: 'Lunes a Viernes - 7:00 p.m.',
                    precio_boleto: 10000,
                    nequi_numero: '3150000000',
                    admin_password: '1234'
                },
                boletos: {},
                historial: []
            };
            fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), 'utf8');
        }
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('❌ Error al cargar la base de datos:', error);
        return {
            config: { id: 1, loteria_nombre: 'Chontico Noche', sorteo_horario: 'Lunes a Viernes - 7:00 p.m.', precio_boleto: 10000, nequi_numero: '3150000000', admin_password: '1234' },
            boletos: {},
            historial: []
        };
    }
}

function guardarBD(db) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    } catch (error) {
        console.error('❌ Error al guardar la base de datos:', error);
    }
}

function verificarReservasExpiradas() {
    const db = cargarBD();
    const ahora = Date.now();
    const tiempoLimite = 5 * 60 * 1000;
    let modificado = false;

    for (const numero in db.boletos) {
        const boleto = db.boletos[numero];
        if (boleto.estado === 'RESERVADO' && (ahora - boleto.fechaReserva > tiempoLimite)) {
            delete db.boletos[numero];
            modificado = true;
        }
    }

    if (modificado) {
        guardarBD(db);
    }
}

setInterval(verificarReservasExpiradas, 30000);

// Endpoints API
app.get('/api/config', (req, res) => {
    try {
        const db = cargarBD();
        res.json({
            loteria_nombre: db.config.loteria_nombre,
            sorteo_horario: db.config.sorteo_horario,
            precio_boleto: db.config.precio_boleto,
            nequi_numero: db.config.nequi_numero
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/config', (req, res) => {
    try {
        const db = cargarBD();
        const { loteria_nombre, sorteo_horario, precio_boleto, nequi_numero } = req.body;
        db.config.loteria_nombre = loteria_nombre || db.config.loteria_nombre;
        db.config.sorteo_horario = sorteo_horario || db.config.sorteo_horario;
        db.config.precio_boleto = precio_boleto ? Number(precio_boleto) : db.config.precio_boleto;
        db.config.nequi_numero = nequi_numero || db.config.nequi_numero;
        guardarBD(db);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/login', (req, res) => {
    try {
        const db = cargarBD();
        const { password } = req.body;
        if (db.config.admin_password === password) {
            res.json({ success: true });
        } else {
            res.status(401).json({ success: false, error: "Contraseña incorrecta" });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/historial', (req, res) => {
    try {
        const db = cargarBD();
        res.json([...db.historial].reverse());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/liberar/:numero', (req, res) => {
    try {
        const db = cargarBD();
        const { numero } = req.params;
        if (db.boletos[numero]) {
            delete db.boletos[numero];
            guardarBD(db);
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/boletos', (req, res) => {
    try {
        verificarReservasExpiradas();
        const db = cargarBD();
        res.json(db.boletos);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/reservar', (req, res) => {
    try {
        verificarReservasExpiradas();
        const db = cargarBD();
        const { numero, nombre, telefono, ciudad, email, loteria, horaSorteo, acepta_datos } = req.body;

        if (!acepta_datos) {
            return res.status(400).json({ error: "Debe aceptar el tratamiento de datos." });
        }

        if (db.boletos[numero] && db.boletos[numero].estado !== 'DISPONIBLE') {
            return res.status(400).json({ error: "El boleto ya no está disponible." });
        }

        db.boletos[numero] = {
            estado: 'RESERVADO',
            nombre,
            telefono,
            ciudad,
            email,
            loteria,
            horaSorteo,
            fechaReserva: Date.now()
        };

        db.historial.push({
            id: db.historial.length + 1,
            numero,
            nombre,
            telefono,
            ciudad,
            email,
            loteria,
            fecha: new Date().toISOString()
        });

        guardarBD(db);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/pagar/:numero', (req, res) => {
    try {
        const db = cargarBD();
        const { numero } = req.params;
        if (db.boletos[numero]) {
            db.boletos[numero].estado = 'PAGADO';
            guardarBD(db);
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});