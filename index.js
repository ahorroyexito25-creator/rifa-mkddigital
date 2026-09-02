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
                    bancolombia_numero: '000-00000-00',
                    pago_movil_datos: 'Banco: Mercantil | Tel: 0414-0000000 | C.I: V-12345678',
                    whatsapp_numero: '573150000000',
                    whatsapp_mensaje: 'Hola, deseo confirmar mi pago y reserva para el boleto #{numero} de la rifa {loteria}.',
                    admin_password: '1234'
                },
                boletos: {},
                historial: []
            };
            fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), 'utf8');
        }
        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        // Garantizar retrocompatibilidad si la base de datos existente no tiene los campos de WhatsApp
        if (data.config) {
            if (data.config.whatsapp_numero === undefined) data.config.whatsapp_numero = '573150000000';
            if (data.config.whatsapp_mensaje === undefined) data.config.whatsapp_mensaje = 'Hola, deseo confirmar mi pago y reserva para el boleto #{numero} de la rifa {loteria}.';
        }
        return data;
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
                bancolombia_numero: '000-00000-00',
                pago_movil_datos: 'Banco: Mercantil | Tel: 0414-0000000 | C.I: V-12345678',
                whatsapp_numero: '573150000000',
                whatsapp_mensaje: 'Hola, deseo confirmar mi pago y reserva para el boleto #{numero} de la rifa {loteria}.',
                admin_password: '1234' 
            },
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

app.get('/api/config', (req, res) => {
    const db = cargarBD();
    res.json(db.config);
});

app.post('/api/config', (req, res) => {
    const db = cargarBD();
    const { pais, moneda, simbolo_moneda, loteria_nombre, fecha_sorteo, precio_boleto, premio_mayor, nequi_numero, bancolombia_numero, pago_movil_datos, whatsapp_numero, whatsapp_mensaje } = req.body;
    
    db.config.pais = pais || db.config.pais;
    db.config.moneda = moneda || db.config.moneda;
    db.config.simbolo_moneda = simbolo_moneda || db.config.simbolo_moneda;
    db.config.loteria_nombre = loteria_nombre || db.config.loteria_nombre;
    db.config.fecha_sorteo = fecha_sorteo || db.config.fecha_sorteo;
    db.config.precio_boleto = precio_boleto ? Number(precio_boleto) : db.config.precio_boleto;
    db.config.premio_mayor = premio_mayor || db.config.premio_mayor;
    db.config.nequi_numero = nequi_numero !== undefined ? nequi_numero : db.config.nequi_numero;
    db.config.bancolombia_numero = bancolombia_numero !== undefined ? bancolombia_numero : db.config.bancolombia_numero;
    db.config.pago_movil_datos = pago_movil_datos !== undefined ? pago_movil_datos : db.config.pago_movil_datos;
    db.config.whatsapp_numero = whatsapp_numero !== undefined ? whatsapp_numero : db.config.whatsapp_numero;
    db.config.whatsapp_mensaje = whatsapp_mensaje !== undefined ? whatsapp_mensaje : db.config.whatsapp_mensaje;
    
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
    const { numero, nombre, telefono, ciudad, email, loteria, fechaSorteo, acepta_datos } = req.body;

    if (!acepta_datos) {
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

    const codigoAntifraude = 'RIFA-' + Math.random().toString(36).substring(2, 8).toUpperCase();

    db.boletos[numero] = {
        estado: 'RESERVADO',
        nombre, telefono, ciudad, email, loteria, fechaSorteo,
        fechaCompra,
        codigoAntifraude,
        timestampReserva: Date.now()
    };

    db.historial.push({
        id: db.historial.length + 1,
        numero, nombre, telefono, ciudad, email, loteria,
        codigoAntifraude,
        fecha: new Date().toISOString()
    });

    guardarBD(db);
    res.json({ success: true, codigoAntifraude });
});

app.post('/api/pagar/:numero', (req, res) => {
    const db = cargarBD();
    if (db.boletos[req.params.numero]) {
        db.boletos[req.params.numero].estado = 'PAGADO';
        if (!db.boletos[req.params.numero].codigoAntifraude) {
            db.boletos[req.params.numero].codigoAntifraude = 'RIFA-' + Math.random().toString(36).substring(2, 8).toUpperCase();
        }
        guardarBD(db);
        res.json({ success: true, codigoAntifraude: db.boletos[req.params.numero].codigoAntifraude });
    } else {
        res.status(404).json({ success: false });
    }
});

// Endpoint integrado para generación automática de enlaces y comprobantes de WhatsApp
app.get('/api/whatsapp/generar/:numero', (req, res) => {
    const db = cargarBD();
    const numeroBoleto = req.params.numero;
    const boleto = db.boletos[numeroBoleto];
    
    const whatsappNum = db.config.whatsapp_numero || '573150000000';
    
    let mensaje = '';
    if (boleto) {
        mensaje = `Hola, confirmo el pago y reserva del boleto *#${numeroBoleto}* para la lotería *${db.config.loteria_nombre}*.\n` +
                  `Nombre: ${boleto.nombre}\n` +
                  `Teléfono: ${boleto.telefono}\n` +
                  `Estado: ${boleto.estado}\n` +
                  `Código Antifraude: ${boleto.codigoAntifraude || 'N/A'}\n` +
                  `Adjunto mi comprobante de pago.`;
    } else {
        mensaje = `Hola, deseo consultar sobre los boletos disponibles para la rifa ${db.config.loteria_nombre}.`;
    }
    
    const urlWhatsApp = `https://wa.me/${whatsappNum}?text=${encodeURIComponent(mensaje)}`;
    res.json({ success: true, url: urlWhatsApp });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
