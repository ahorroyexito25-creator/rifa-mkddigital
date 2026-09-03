import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

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

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'rifa.json');

function limpiarReservasExpiradas(db) {
    const ahora = Date.now();
    let modificado = false;
    const horasReserva = db.config && db.config.tiempo_reserva_horas !== undefined ? Number(db.config.tiempo_reserva_horas) : 24;
    const TIEMPO_EXPIRACION = horasReserva * 60 * 60 * 1000;
    
    if (db.boletos) {
        for (const [numero, boleto] of Object.entries(db.boletos)) {
            if (boleto.estado === 'RESERVADO' && boleto.timestampReserva) {
                if (ahora - boleto.timestampReserva > TIEMPO_EXPIRACION) {
                    delete db.boletos[numero];
                    modificado = true;
                }
            }
        }
    }
    return modificado;
}

function cargarBD() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        if (!fs.existsSync(DB_FILE)) {
            const initialData = {
                config: {
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
                    admin_password: '1234',
                    tiempo_reserva_horas: 24
                },
                boletos: {},
                historial: [],
                ganadores_historicos: []
            };
            fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), 'utf8');
        }
        const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        
        if (!db.config) db.config = {};
        if (!db.config.whatsapp_numero) db.config.whatsapp_numero = '573150000000';
        if (db.config.nequi_numero === undefined) db.config.nequi_numero = '';
        if (db.config.nequi_qr === undefined) db.config.nequi_qr = '';
        if (db.config.bancolombia_numero === undefined) db.config.bancolombia_numero = '';
        if (db.config.bancolombia_qr === undefined) db.config.bancolombia_qr = '';
        if (db.config.pago_movil_datos === undefined) db.config.pago_movil_datos = '';
        if (db.config.tiempo_reserva_horas === undefined) db.config.tiempo_reserva_horas = 24;
        if (!db.ganadores_historicos) db.ganadores_historicos = [];

        if (limpiarReservasExpiradas(db)) {
            guardarBD(db);
        }

        return db;
    } catch (error) {
        console.error('Error al cargar BD:', error);
        return {
            config: { 
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
                admin_password: '1234',
                tiempo_reserva_horas: 24 
            },
            boletos: {},
            historial: [],
            ganadores_historicos: []
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

app.get('/api/config', (req, res) => {
    const db = cargarBD();
    res.json(db.config);
});

app.post('/api/config', (req, res) => {
    const db = cargarBD();
    const { 
        pais, moneda, simbolo_moneda, loteria_nombre, fecha_sorteo, 
        precio_boleto, premio_mayor, nequi_numero, nequi_qr, 
        bancolombia_numero, bancolombia_qr, pago_movil_datos, whatsapp_numero,
        tiempo_reserva_horas 
    } = req.body;
    
    db.config.pais = pais || db.config.pais;
    db.config.moneda = moneda || db.config.moneda;
    db.config.simbolo_moneda = simbolo_moneda || db.config.simbolo_moneda;
    db.config.loteria_nombre = loteria_nombre || db.config.loteria_nombre;
    db.config.fecha_sorteo = fecha_sorteo || db.config.fecha_sorteo;
    db.config.precio_boleto = precio_boleto ? Number(precio_boleto) : db.config.precio_boleto;
    db.config.premio_mayor = premio_mayor || db.config.premio_mayor;
    db.config.nequi_numero = nequi_numero !== undefined ? nequi_numero : (db.config.nequi_numero || '');
    db.config.nequi_qr = nequi_qr !== undefined ? nequi_qr : (db.config.nequi_qr || '');
    db.config.bancolombia_numero = bancolombia_numero !== undefined ? bancolombia_numero : (db.config.bancolombia_numero || '');
    db.config.bancolombia_qr = bancolombia_qr !== undefined ? bancolombia_qr : (db.config.bancolombia_qr || '');
    db.config.pago_movil_datos = pago_movil_datos !== undefined ? pago_movil_datos : (db.config.pago_movil_datos || '');
    db.config.whatsapp_numero = whatsapp_numero !== undefined ? whatsapp_numero : (db.config.whatsapp_numero || '');
    db.config.tiempo_reserva_horas = tiempo_reserva_horas !== undefined ? Number(tiempo_reserva_horas) : (db.config.tiempo_reserva_horas || 24);
    
    guardarBD(db);
    res.json({ success: true });
});

// Reiniciar el tablero de boletos guardando el ganador histórico y limpiando los activos
app.post('/api/admin/resetar-sorteo', (req, res) => {
    const db = cargarBD();
    const { numeroGanador } = req.body;

    if (numeroGanador !== undefined && db.boletos[numeroGanador]) {
        const ganador = db.boletos[numeroGanador];
        if (!db.ganadores_historicos) db.ganadores_historicos = [];
        db.ganadores_historicos.push({
            numero: numeroGanador,
            nombre: ganador.nombre,
            telefono: ganador.telefono,
            email: ganador.email,
            loteria: db.config.loteria_nombre,
            fecha: new Date().toLocaleString('es-ES', { timeZone: 'America/Bogota' })
        });
    }

    db.boletos = {}; // Limpia los boletos activos volviéndolos todos disponibles
    guardarBD(db);
    res.json({ success: true, mensaje: "Tablero reiniciado y ganador archivado correctamente." });
});

app.get('/api/admin/ganadores', (req, res) => {
    const db = cargarBD();
    res.json([...(db.ganadores_historicos || [])].reverse());
});

app.post('/api/admin/login', (req, res) => {
    const db = cargarBD();
    if (db.config.admin_password === req.body.password) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, error: "Contraseña incorrecta" });
    }
});

app.post('/api/admin/password', (req, res) => {
    const db = cargarBD();
    const { nuevaPassword } = req.body;
    if (nuevaPassword && nuevaPassword.trim() !== "") {
        db.config.admin_password = nuevaPassword.trim();
        guardarBD(db);
        res.json({ success: true });
    } else {
        res.status(400).json({ success: false, error: "Contraseña inválida" });
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
    limpiarReservasExpiradas(db);
    
    const { numero, nombre, telefono, ciudad, email, loteria, fechaSorteo, aceptas_datos } = req.body;

    if (!aceptas_datos) {
        return res.status(400).json({ error: "Debe aceptar el tratamiento de datos." });
    }

    if (db.boletos[numero] && db.boletos[numero].estado !== 'DISPONIBLE') {
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

    db.boletos[numero] = {
        estado: 'RESERVADO',
        nombre, telefono, ciudad, email, loteria, fechaSorteo,
        fechaCompra,
        timestampReserva: Date.now()
    };

    db.historial.push({
        id: db.historial.length + 1,
        numero, nombre, telefono, ciudad, email, loteria,
        fecha: new Date().toISOString()
    });

    guardarBD(db);
    res.json({ success: true, timestampReserva: db.boletos[numero].timestampReserva });
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

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
