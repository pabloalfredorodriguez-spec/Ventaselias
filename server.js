// ====================== IMPORTS ======================
const express = require("express");
const session = require("express-session");
const { Pool } = require("pg");

// ====================== APP ======================
const app = express();
const PORT = process.env.PORT || 10000;

// ====================== MIDDLEWARE ======================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: "ventas-secret",
    resave: false,
    saveUninitialized: false,
  })
);

// ====================== DB ======================
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://postgres:1234@localhost:5432/ventaselias1";

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

// ====================== INIT DB ======================
async function initDB() {
  try {
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
        codigo TEXT,
        precio_unitario NUMERIC NOT NULL,
        precio_mayorista NUMERIC,
        costo_unitario NUMERIC DEFAULT 0,
        stock INTEGER DEFAULT 0
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ventas (
        id SERIAL PRIMARY KEY,
        cliente_id INTEGER REFERENCES clientes(id),
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        total NUMERIC NOT NULL,
        tipo TEXT NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS detalle_ventas (
        id SERIAL PRIMARY KEY,
        venta_id INTEGER REFERENCES ventas(id) ON DELETE CASCADE,
        producto_id INTEGER REFERENCES productos(id),
        cantidad INTEGER NOT NULL,
        precio_unitario NUMERIC NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS caja (
        id SERIAL PRIMARY KEY,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        tipo TEXT NOT NULL,
        monto NUMERIC NOT NULL,
        descripcion TEXT
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cuotas_ventas (
        id SERIAL PRIMARY KEY,
        venta_id INTEGER REFERENCES ventas(id) ON DELETE CASCADE,
        numero INTEGER NOT NULL,
        monto NUMERIC NOT NULL,
        fecha_vencimiento DATE NOT NULL,
        pagada BOOLEAN DEFAULT false
      )
    `);
    console.log("DB inicializada correctamente");
  } catch (err) {
    console.error("Error inicializando DB:", err.message);
  }
}

// ====================== FORMAT HELPERS ======================
const formatGs = (n) => "Gs. " + Number(n).toLocaleString("es-PY");

// ====================== LOGIN ======================
const ADMIN = { user: "admin", pass: "1234" };
app.get("/", (req, res) => res.redirect("/login"));
app.get("/login", (req, res) => {
  res.send(`
    <html>
      <head>
        <style>
          body { font-family: Arial; background:#f5f5f5; text-align:center; padding:50px; }
          input { padding:10px; margin:5px; width:200px; }
          button { padding:10px 20px; background:#007bff; color:white; border:none; border-radius:5px; cursor:pointer; }
        </style>
      </head>
      <body>
        <h2>Login Ventas</h2>
        <form method="POST" action="/login">
          <input name="user" placeholder="Usuario" required><br/>
          <input name="pass" type="password" placeholder="Contraseña" required><br/>
          <button>Ingresar</button>
        </form>
      </body>
    </html>
  `);
});
app.post("/login", (req, res) => {
  const { user, pass } = req.body;
  if (user === ADMIN.user && pass === ADMIN.pass) {
    req.session.admin = true;
    res.redirect("/admin");
  } else {
    res.send("<script>alert('Credenciales incorrectas');window.location='/login';</script>");
  }
});

// ====================== ADMIN DASHBOARD ======================
app.get("/admin", async (req, res) => {
  if (!req.session.admin) return res.redirect("/login");
  const clientes = (await pool.query("SELECT * FROM clientes")).rows;
  const productos = (await pool.query("SELECT * FROM productos")).rows;

  res.send(`
  <html>
    <head>
      <style>
        body { font-family: Arial; background:#f0f2f5; padding:20px; }
        h2,h3 { color:#333; }
        form { margin-bottom:20px; }
        input, select { padding:8px; margin:5px; border-radius:5px; border:1px solid #ccc; }
        button { padding:8px 15px; border:none; border-radius:5px; cursor:pointer; }
        .btn-primary { background:#007bff; color:white; }
        .btn-success { background:#28a745; color:white; }
        .btn-link { background:#6c757d; color:white; text-decoration:none; padding:5px 10px; border-radius:5px; }
        ul { list-style:none; padding:0; }
        li { background:white; margin:5px 0; padding:10px; border-radius:5px; }
      </style>
    </head>
    <body>
      <h2>Dashboard Ventas</h2>

      <h3>Menú</h3>
      <a class="btn-primary btn-link" href="/admin/registrar-venta">➕ Registrar Venta</a>
      <a class="btn-primary btn-link" href="/admin/ventas">📄 Ventas</a>
      <a class="btn-success btn-link" href="/admin/caja">💰 Caja</a>
      <a class="btn-success btn-link" href="/admin/cuotas">🧾 Cuotas</a>

      <hr/>

      <h3>Agregar Cliente</h3>
      <form method="POST" action="/admin/clientes">
        <input name="nombre" placeholder="Nombre" required>
        <input name="tipo" placeholder="Tipo (mostrador/otro)" value="mostrador">
        <input name="documento" placeholder="Documento">
        <input name="telefono" placeholder="Teléfono">
        <button class="btn-primary">Agregar Cliente</button>
      </form>

      <h3>Clientes</h3>
      <ul>
        ${clientes.map(c => `<li>${c.nombre} (${c.tipo})</li>`).join("")}
      </ul>

      <h3>Agregar Producto</h3>
      <form method="POST" action="/admin/productos">
        <input name="nombre" placeholder="Nombre" required>
        <input name="categoria" placeholder="Categoría">
        <input name="codigo" placeholder="Código">
        <input name="precio_unitario" type="number" step="0.01" placeholder="Precio Unitario" required>
        <input name="precio_mayorista" type="number" step="0.01" placeholder="Precio Mayorista">
        <input name="costo_unitario" type="number" step="0.01" placeholder="Costo Unitario">
        <input name="stock" type="number" placeholder="Stock" value="0">
        <button class="btn-primary">Agregar Producto</button>
      </form>

      <h3>Productos</h3>
      <ul>
        ${productos.map(p => `
          <li>
            ${p.nombre} - Stock: ${p.stock} - Precio: ${formatGs(p.precio_unitario)}
            ${p.precio_mayorista ? ' - Mayorista: ' + formatGs(p.precio_mayorista) : ''}
            - Costo: ${formatGs(p.costo_unitario)} - Utilidad: ${formatGs(p.precio_unitario - p.costo_unitario)}
          </li>`).join("")}
      </ul>
    </body>
  </html>
  `);
});

// ====================== RUTAS AGREGAR CLIENTES / PRODUCTOS ======================
app.post("/admin/clientes", async (req, res) => {
  const { nombre, tipo, documento, telefono } = req.body;
  try {
    await pool.query(
      "INSERT INTO clientes (nombre, tipo, documento, telefono) VALUES ($1,$2,$3,$4)",
      [nombre, tipo || "mostrador", documento, telefono]
    );
    res.redirect("/admin");
  } catch (err) {
    res.send(`<h2>Error agregando cliente:</h2><pre>${err.message}</pre>`);
  }
});

app.post("/admin/productos", async (req, res) => {
  const { nombre, categoria, codigo, precio_unitario, precio_mayorista, costo_unitario, stock } = req.body;
  try {
    const existing = await pool.query("SELECT * FROM productos WHERE codigo = $1", [codigo]);
    if(existing.rows.length > 0){
      // Si existe, solo actualizar
      await pool.query(
        `UPDATE productos 
         SET stock = stock + $1, nombre=$2, categoria=$3, precio_unitario=$4, precio_mayorista=$5, costo_unitario=$6
         WHERE codigo=$7`,
        [Number(stock), nombre, categoria, precio_unitario, precio_mayorista || null, costo_unitario || 0, codigo]
      );
    } else {
      // Crear nuevo
      await pool.query(
        "INSERT INTO productos(nombre,categoria,codigo,precio_unitario,precio_mayorista,costo_unitario,stock) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [nombre, categoria, codigo, precio_unitario, precio_mayorista || null, costo_unitario || 0, Number(stock) || 0]
      );
    }
    res.redirect("/admin");
  } catch(err){
    res.send(`<h2>Error agregando producto:</h2><pre>${err.message}</pre>`);
  }
});

// ====================== START SERVER ======================
(async function startServer() {
  await initDB();
  const server = app.listen(PORT, "0.0.0.0", () => 
    console.log("Servidor Ventaselias activo en puerto", PORT)
  );
  server.keepAliveTimeout = 120000;
  server.headersTimeout = 120000;
})();