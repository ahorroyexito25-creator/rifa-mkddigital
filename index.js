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
    const CINCO_MINUTOS = 5 * 60 * 1000;
    
    if (db.boletos) {
        for (const [numero, boleto] of Object.entries(db.boletos)) {
            if (boleto.estado === 'RESERVADO' && boleto.timestampReserva) {
                if (ahora - boleto.timestampReserva > CINCO_MINUTOS) {
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
                    admin_password: '1234'
                },
                boletos: {},
                historial: []
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
    const { 
        pais, moneda, simbolo_moneda, loteria_nombre, fecha_sorteo, 
        precio_boleto, premio_mayor, nequi_numero, nequi_qr, 
        bancolombia_numero, bancolombia_qr, pago_movil_datos, whatsapp_numero 
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
    
    guardarBD(db);
    res.json({ success: true });
});

// NUEVA RUTA: Reiniciar el tablero de boletos para un nuevo sorteo (deja todos en verde)
app.post('/api/admin/resetar-sorteo', (req, res) => {
    const db = cargarBD();
    db.boletos = {}; // Limpia los boletos activos volviéndolos todos disponibles
    guardarBD(db);
    res.json({ success: true, mensaje: "Tablero reiniciado correctamente." });
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
// 1. Obtener la configuración del temporizador
app.get('/api/configuracion', async (req, res) => {
  const { data, error } = await supabase.from('configuracion_rifa').select('*').eq('id', 1).single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// 2. Actualizar el temporizador (horas/días convertidos a horas)
app.post('/api/configuracion', async (req, res) => {
  const { horas_expiracion } = req.body;
  const { data, error } = await supabase.from('configuracion_rifa').update({ horas_expiracion }).eq('id', 1);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, message: "Temporizador actualizado con éxito" });
});

// 3. Liberar un ticket de forma inmediata (vuelve a estar disponible/libre)
app.post('/api/liberar-ticket', async (req, res) => {
  const { numero } = req.body;
  const { data, error } = await supabase
    .from('boletos')
    .update({ estado: 'libre', nombre: null, telefono: null, reservado_hasta: null })
    .eq('numero', numero);
    
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, message: `El ticket ${numero} ha sido liberado.` });
});

// 4. Registrar ganador, guardar en historial y resetear la rifa para una nueva jugada
app.post('/api/declarar-ganador-y-resetear', async (req, res) => {
  const { numero, nombre, telefono, fecha_sorteo } = req.body;

  // Guardar en el historial permanente
  const { error: errorHistorial } = await supabase.from('historial_ganadores').insert([
    { numero_ganador: numero, nombre_cliente: nombre, telefono_cliente: telefono, fecha_sorteo: fecha_sorteo }
  ]);
  if (errorHistorial) return res.status(400).json({ error: errorHistorial.message });

  // Resetear todos los boletos de la rifa actual a estado libre
  const { error: errorReset } = await supabase
    .from('boletos')
    .update({ estado: 'libre', nombre: null, telefono: null, reservado_hasta: null })
    .neq('numero', 0); // Aplica a todos los boletos

  if (errorReset) return res.status(400).json({ error: errorReset.message });
  res.json({ success: true, message: "Ganador guardado en historial y rifa reseteada correctamente." });
});
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
