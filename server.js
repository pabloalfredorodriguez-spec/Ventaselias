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
        precio_unitario NUMERIC NOT NULL,
        precio_mayorista NUMERIC,
        stock INTEGER DEFAULT 0
      )
    `);
    console.log("DB inicializada correctamente");
  } catch (err) {
    console.error("Error inicializando DB:", err.message);
  }
}
initDB();

// ====================== HELPERS ======================
const formatGs = (n) => "Gs. " + Number(n).toLocaleString("es-PY");

// ====================== LOGIN ======================
const ADMIN = { user: "admin", pass: "1234" };

app.get("/", (req, res) => res.redirect("/login"));

app.get("/login", (req, res) => {
  res.send(`
    <html>
      <body>
        <h2>Login Ventas</h2>
        <form method="POST" action="/login">
          <input name="user" placeholder="Usuario" required>
          <input name="pass" type="password" placeholder="Contraseña" required>
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
    res.send(
      "<script>alert('Credenciales incorrectas');window.location='/login';</script>"
    );
  }
});

// ====================== ADMIN DASHBOARD ======================
app.get("/admin", async (req, res) => {
  if (!req.session.admin) return res.redirect("/login");

  try {
    const clientes = (await pool.query("SELECT * FROM clientes")).rows;
    const productos = (await pool.query("SELECT * FROM productos")).rows;

    res.send(`
      <html>
        <body>
          <h2>Dashboard Ventas</h2>

          <h3>Agregar Cliente</h3>
          <form method="POST" action="/admin/clientes">
            <input name="nombre" placeholder="Nombre" required>
            <input name="tipo" placeholder="Tipo (mostrador/otro)" value="mostrador">
            <input name="documento" placeholder="Documento">
            <input name="telefono" placeholder="Teléfono">
            <button>Agregar Cliente</button>
          </form>

          <h3>Clientes</h3>
          <ul>
            ${clientes.map((c) => `<li>${c.nombre} (${c.tipo})</li>`).join("")}
          </ul>

          <h3>Agregar Producto</h3>
          <form method="POST" action="/admin/productos">
            <input name="nombre" placeholder="Nombre" required>
            <input name="categoria" placeholder="Categoría">
            <input name="precio_unitario" type="number" step="0.01" placeholder="Precio Unitario" required>
            <input name="precio_mayorista" type="number" step="0.01" placeholder="Precio Mayorista">
            <input name="stock" type="number" placeholder="Stock" value="0">
            <button>Agregar Producto</button>
          </form>

          <h3>Productos</h3>
          <ul>
            ${productos
              .map(
                (p) =>
                  `<li>${p.nombre} - Stock: ${p.stock} - Precio: ${formatGs(
                    p.precio_unitario
                  )}${p.precio_mayorista ? ' - Mayorista: ' + formatGs(p.precio_mayorista) : ''}</li>`
              )
              .join("")}
          </ul>
        </body>
      </html>
    `);
  } catch (err) {
    res.send(`<h2>Error cargando dashboard:</h2><pre>${err.message}</pre>`);
  }
});

// ====================== ROUTES AGREGAR CLIENTES / PRODUCTOS ======================
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
  const { nombre, categoria, precio_unitario, precio_mayorista, stock } = req.body;
  try {
    await pool.query(
      "INSERT INTO productos (nombre, categoria, precio_unitario, precio_mayorista, stock) VALUES ($1,$2,$3,$4,$5)",
      [nombre, categoria, precio_unitario, precio_mayorista || null, stock || 0]
    );
    res.redirect("/admin");
  } catch (err) {
    res.send(`<h2>Error agregando producto:</h2><pre>${err.message}</pre>`);
  }
});

// ====================== START SERVER ======================
const server = app.listen(PORT, "0.0.0.0", () =>
  console.log("Servidor Ventaselias activo en puerto", PORT)
);
server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;