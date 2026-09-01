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
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (error) {
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
        console.error('Error al guardar BD:', error);
    }
}

// Ruta raíz directa para Railway
app.get('/', (req, res) => {
    res.status(200).json({ status: "online", mensaje: "API Rifa Activa" });
});

app.get('/api/config', (req, res) => {
    const db = cargarBD();
    res.json({
        loteria_nombre: db.config.loteria_nombre,
        sorteo_horario: db.config.sorteo_horario,
        precio_boleto: db.config.precio_boleto,
        nequi_numero: db.config.nequi_numero
    });
});

app.post('/api/config', (req, res) => {
    const db = cargarBD();
    const { loteria_nombre, sorteo_horario, precio_boleto, nequi_numero } = req.body;
    db.config.loteria_nombre = loteria_nombre || db.config.loteria_nombre;
    db.config.sorteo_horario = sorteo_horario || db.config.sorteo_horario;
    db.config.precio_boleto = precio_boleto ? Number(precio_boleto) : db.config.precio_boleto;
    db.config.nequi_numero = nequi_numero || db.config.nequi_numero;
    guardarBD(db);
    res.json({ success: true });
});

app.post('/api/admin/login', (req, res) => {
    const db = cargarBD();
    if (db.config.admin_password === req.body.password) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, error: "Contraseña incorrecta" });
    }
});

app.get('/api/admin/historial', (req, res) => {
    const db = cargarBD();
    res.json([...db.historial].reverse());
});

app.post('/api/admin/liberar/:numero', (req, res) => {
    const db = cargarBD();
    delete db.boletos[req.params.numero];
    guardarBD(db);
    res.json({ success: true });
});

app.get('/api/boletos', (req, res) => {
    const db = cargarBD();
    res.json(db.boletos);
});

app.post('/api/reservar', (req, res) => {
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
        nombre, telefono, ciudad, email, loteria, horaSorteo,
        fechaReserva: Date.now()
    };

    db.historial.push({
        id: db.historial.length + 1,
        numero, nombre, telefono, ciudad, email, loteria,
        fecha: new Date().toISOString()
    });

    guardarBD(db);
    res.json({ success: true });
});

app.post('/api/pagar/:numero', (req, res) => {
    const db = cargarBD();
    if (db.boletos[req.params.numero]) {
        db.boletos[req.params.numero].estado = 'PAGADO';
        guardarBD(db);
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});