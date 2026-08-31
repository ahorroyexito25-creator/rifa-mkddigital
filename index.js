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
app.use(express.static(path.join(__dirname, 'frontend')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Ruta del archivo de base de datos en el volumen persistente
const DATA_DIR = '/data';
const DB_FILE = path.join(DATA_DIR, 'rifa.json');

// Inicializar estructura de datos por defecto
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
                boletos: {}, // { "00": { estado, nombre, telefono, ciudad, email, loteria, horaSorteo, fechaReserva } }
                historial: [] // Array de registros
            };
            fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), 'utf8');
            console.log('✅ Archivo de base de datos JSON creado exitosamente.');
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

// ⏱️ Liberar reservas vencidas (más de 5 minutos)
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
            console.log(`⏰ Boleto #${numero} expiró y volvió a estar disponible.`);
        }
    }

    if (modificado) {
        guardarBD(db);
    }
}

setInterval(verificarReservasExpiradas, 30000);

// Endpoints de la API
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
        res.json({ success: true, mensaje: "Configuración actualizada con éxito." });
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

app.post('/api/admin/password', (req, res) => {
    try {
        const db = cargarBD();
        const { nuevaPassword } = req.body;
        if (!nuevaPassword || nuevaPassword.trim() === "") {
            return res.status(400).json({ success: false, error: "Contraseña inválida" });
        }
        db.config.admin_password = nuevaPassword;
        guardarBD(db);
        res.json({ success: true, mensaje: "Contraseña actualizada correctamente" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/historial', (req, res) => {
    try {
        const db = cargarBD();
        const historialOrdenado = [...db.historial].reverse();
        res.json(historialOrdenado);
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
        res.json({ success: true, mensaje: `Boleto #${numero} liberado con éxito.` });
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
            return res.status(400).json({ error: "Debe aceptar el tratamiento de datos para continuar." });
        }

        if (db.boletos[numero] && db.boletos[numero].estado !== 'DISPONIBLE') {
            return res.status(400).json({ error: "El boleto ya no está disponible." });
        }

        const fechaReserva = Date.now();

        db.boletos[numero] = {
            estado: 'RESERVADO',
            nombre,
            telefono,
            ciudad,
            email,
            loteria,
            horaSorteo,
            fechaReserva
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
        res.json({ success: true, mensaje: "Reserva exitosa. Tienes 5 minutos para reportar tu pago." });
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
    console.log(`🚀 Servidor corriendo estable en el puerto ${PORT}`);
});