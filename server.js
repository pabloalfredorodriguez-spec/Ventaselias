
// ====================== IMPORTS ======================
const express = require("express");
const session = require("express-session");
const { Pool } = require("pg");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");

// ====================== APP ======================
const app = express();
const PORT = process.env.PORT || 10000;

// ====================== MIDDLEWARE ======================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: "ventas-secret",
  resave: false,
  saveUninitialized: false
}));

// ====================== DB ======================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ====================== INIT DB ======================
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clientes (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'mostrador',
      documento TEXT,
      telefono TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS productos (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      categoria TEXT,
      precio_unitario NUMERIC NOT NULL,
      precio_mayorista NUMERIC,
      stock INTEGER DEFAULT 0
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ventas (
      id SERIAL PRIMARY KEY,
      cliente_id INTEGER REFERENCES clientes(id),
      total NUMERIC,
      fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      tipo TEXT NOT NULL DEFAULT 'contado'
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS detalle_ventas (
      id SERIAL PRIMARY KEY,
      venta_id INTEGER REFERENCES ventas(id),
      producto_id INTEGER REFERENCES productos(id),
      cantidad INTEGER,
      precio_unitario NUMERIC
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cuotas_ventas (
      id SERIAL PRIMARY KEY,
      venta_id INTEGER REFERENCES ventas(id),
      numero INTEGER,
      monto NUMERIC,
      fecha_vencimiento DATE,
      pagada BOOLEAN DEFAULT false,
      fecha_pago DATE
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS caja (
      id SERIAL PRIMARY KEY,
      tipo TEXT,
      monto NUMERIC,
      descripcion TEXT,
      fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log("DB inicializada");
}
initDB();

// ====================== HELPERS ======================
const formatGs = n => "Gs. " + Number(n).toLocaleString("es-PY");
const formatDate = d => d ? new Date(d).toISOString().split("T")[0] : "";
const today = () => new Date().toISOString().split("T")[0];

// ====================== LOGIN ======================
const ADMIN = { user: "admin", pass: "1234" };
app.get("/login", (req,res)=>{
  res.send(`
  <html><body>
  <h2>Login Ventas</h2>
  <form method="POST" action="/login">
  <input name="user" placeholder="Usuario" required>
  <input name="pass" type="password" placeholder="Contraseña" required>
  <button>Ingresar</button>
  </form>
  </body></html>`);
});
app.post("/login",(req,res)=>{
  const {user,pass} = req.body;
  if(user===ADMIN.user && pass===ADMIN.pass){
    req.session.admin = true;
    res.redirect("/admin");
  } else res.send("<script>alert('Credenciales incorrectas');window.location='/login';</script>");
});

// ====================== ADMIN DASHBOARD ======================
app.get("/admin", async (req,res)=>{
  if(!req.session.admin) return res.redirect("/login");

  const clientes = (await pool.query("SELECT * FROM clientes")).rows;
  const productos = (await pool.query("SELECT * FROM productos")).rows;
  const ventas = (await pool.query("SELECT * FROM ventas")).rows;
  const detalle = (await pool.query("SELECT * FROM detalle_ventas")).rows;
  const caja = (await pool.query("SELECT * FROM caja")).rows;
  const cuotas = (await pool.query("SELECT * FROM cuotas_ventas")).rows;

  let ingresos=0, egresos=0;
  caja.forEach(m=>m.tipo==='ingreso'? ingresos+=+m.monto: egresos+=+m.monto);
  const saldo = ingresos - egresos;

  res.send(\`
    <html><body>
    <h2>Dashboard Ventas</h2>
    <div>Caja actual: \${formatGs(saldo)}</div>
    <h3>Productos</h3>
    <ul>\${productos.map(p=>\`<li>\${p.nombre} - Stock: \${p.stock} - Precio: \${formatGs(p.precio_unitario)}\${p.precio_mayorista? " - Mayorista: "+formatGs(p.precio_mayorista):""}</li>\`).join('')}</ul>
    <h3>Clientes</h3>
    <ul>\${clientes.map(c=>\`<li>\${c.nombre} (\${c.tipo})</li>\`).join('')}</ul>
    </body></html>
  \`);
});

// ====================== START ======================
const server = app.listen(PORT,"0.0.0.0",()=>{console.log("Servidor ventas activo en puerto",PORT)});
server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;
