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

// ====================== INICIAR SERVER ======================
(async function startServer() {
  await initDB();
  const server = app.listen(PORT, "0.0.0.0", () =>
    console.log("Servidor Ventaselias activo en puerto", PORT)
  );
  server.keepAliveTimeout = 120000;
  server.headersTimeout = 120000;
})();

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
// ====================== REGISTRAR VENTA ======================
app.get("/admin/registrar-venta", async (req, res) => {
  if (!req.session.admin) return res.redirect("/login");

  const clientes = (await pool.query("SELECT * FROM clientes")).rows;
  const productos = (await pool.query("SELECT * FROM productos")).rows;

  res.send(`
    <html>
      <body>
        <h2>Registrar Venta</h2>
        <form method="POST" action="/admin/registrar-venta">
          <label>Cliente:</label>
          <select name="cliente_id" required>
            ${clientes.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('')}
          </select><br/><br/>
          
          <label>Tipo de venta:</label>
          <select name="tipo" required>
            <option value="contado">Contado</option>
            <option value="credito">Crédito</option>
          </select><br/><br/>
          
          <h3>Productos</h3>
          ${productos.map(p => `
            <label>${p.nombre} (Stock: ${p.stock}) - Precio: ${formatGs(p.precio_unitario)}</label>
            <input type="number" name="producto_${p.id}" value="0" min="0" max="${p.stock}"><br/>
          `).join('')}
          <br/>
          <button>Registrar Venta</button>
        </form>
      </body>
    </html>
  `);
});

app.post("/admin/registrar-venta", async (req, res) => {
  if (!req.session.admin) return res.redirect("/login");

  try {
    const { cliente_id, tipo } = req.body;
    const productos = (await pool.query("SELECT * FROM productos")).rows;

    // Filtrar productos con cantidad > 0
    const items = productos
      .map(p => ({ ...p, cantidad: Number(req.body['producto_' + p.id] || 0) }))
      .filter(p => p.cantidad > 0);

    if (items.length === 0) return res.send("<script>alert('Debe seleccionar al menos un producto');window.history.back();</script>");

    // Calcular total
    const total = items.reduce((sum, p) => sum + p.precio_unitario * p.cantidad, 0);

    // Insertar venta
    const ventaRes = await pool.query(
      "INSERT INTO ventas(cliente_id, total, tipo) VALUES($1,$2,$3) RETURNING id",
      [cliente_id, total, tipo]
    );
    const venta_id = ventaRes.rows[0].id;

    // Insertar detalle de venta y actualizar stock
    for (const p of items) {
      await pool.query(
        "INSERT INTO detalle_ventas(venta_id, producto_id, cantidad, precio_unitario) VALUES($1,$2,$3,$4)",
        [venta_id, p.id, p.cantidad, p.precio_unitario]
      );
      await pool.query(
        "UPDATE productos SET stock = stock - $1 WHERE id = $2",
        [p.cantidad, p.id]
      );
    }

    // Registrar en caja si es contado
    if (tipo === "contado") {
      await pool.query(
        "INSERT INTO caja(tipo, monto, descripcion) VALUES($1,$2,$3)",
        ["ingreso", total, `Venta ID ${venta_id} - Cliente ID ${cliente_id}`]
      );
    }

    // Registrar cuotas si es crédito (3 cuotas semanales ejemplo)
    if (tipo === "credito") {
      const fecha = new Date();
      for (let i = 1; i <= 3; i++) {
        const fecha_vencimiento = new Date(fecha.getTime() + i * 7 * 24 * 60 * 60 * 1000);
        await pool.query(
          "INSERT INTO cuotas_ventas(venta_id, numero, monto, fecha_vencimiento) VALUES($1,$2,$3,$4)",
          [venta_id, i, total / 3, fecha_vencimiento.toISOString().split('T')[0]]
        );
      }
    }

    res.send("<script>alert('Venta registrada correctamente');window.location='/admin';</script>");
  } catch (err) {
    res.send(`<h2>Error registrando venta:</h2><pre>${err.message}</pre>`);
  }
});
app.get("/admin/ventas", async (req, res) => {
  if (!req.session.admin) return res.redirect("/login");

  const ventas = (await pool.query(`
    SELECT v.*, c.nombre AS cliente
    FROM ventas v
    LEFT JOIN clientes c ON c.id = v.cliente_id
    ORDER BY v.id DESC
  `)).rows;

  res.send(`
    <h2>Ventas</h2>
    <a href="/admin">⬅ Volver</a>
    <ul>
      ${ventas.map(v => `
        <li>
          Venta #${v.id} - ${v.cliente || "Mostrador"} -
          ${formatGs(v.total)} - ${v.tipo}
          <a href="/admin/ventas/${v.id}">🔍 Ver</a>
        </li>
      `).join("")}
    </ul>
  `);
});
app.get("/admin/ventas/:id", async (req, res) => {
  if (!req.session.admin) return res.redirect("/login");

  const { id } = req.params;

  const venta = (await pool.query(`
    SELECT v.*, c.nombre AS cliente
    FROM ventas v
    LEFT JOIN clientes c ON c.id = v.cliente_id
    WHERE v.id = $1
  `, [id])).rows[0];

  const detalle = (await pool.query(`
    SELECT d.*, p.nombre
    FROM detalle_ventas d
    JOIN productos p ON p.id = d.producto_id
    WHERE d.venta_id = $1
  `, [id])).rows;

  res.send(`
    <h2>Detalle Venta #${venta.id}</h2>
    <p>Cliente: ${venta.cliente || "Mostrador"}</p>
    <p>Total: ${formatGs(venta.total)}</p>
    <p>Tipo: ${venta.tipo}</p>

    <h3>Productos</h3>
    <ul>
      ${detalle.map(d => `
        <li>${d.nombre} - ${d.cantidad} x ${formatGs(d.precio_unitario)}</li>
      `).join("")}
    </ul>

    <a href="/admin/ventas">⬅ Volver</a>
  `);
});
app.get("/admin/caja", async (req, res) => {
  if (!req.session.admin) return res.redirect("/login");

  const movimientos = (await pool.query(
    "SELECT * FROM caja ORDER BY id DESC"
  )).rows;

  const ingresos = movimientos
    .filter(m => m.tipo === "ingreso")
    .reduce((s, m) => s + Number(m.monto), 0);

  const egresos = movimientos
    .filter(m => m.tipo === "egreso")
    .reduce((s, m) => s + Number(m.monto), 0);

  res.send(`
    <h2>Caja</h2>
    <p>Ingresos: ${formatGs(ingresos)}</p>
    <p>Egresos: ${formatGs(egresos)}</p>
    <p><strong>Saldo: ${formatGs(ingresos - egresos)}</strong></p>
<a href="/admin/caja/nuevo" style="padding:10px 15px;background:green;color:white;border-radius:5px;">➕ Nuevo Movimiento</a>
    <h3>Movimientos</h3>
    <ul>
      ${movimientos.map(m => `
        <li>${m.fecha} - ${m.tipo} - ${formatGs(m.monto)} (${m.descripcion})</li>
      `).join("")}
    </ul>

    <a href="/admin">⬅ Volver</a>
  `);
});
// Formulario para nuevo movimiento
app.get("/admin/caja/nuevo", (req,res) => {
  if(!req.session.admin) return res.redirect("/login");
  res.send(`
    <h2>Agregar Movimiento Caja</h2>
    <form method="POST" action="/admin/caja/nuevo">
      <label>Monto:</label><input name="monto" type="number" step="0.01" required><br/>
      <label>Tipo:</label>
      <select name="tipo">
        <option value="ingreso">Ingreso</option>
        <option value="egreso">Egreso</option>
      </select><br/>
      <label>Concepto:</label><input name="descripcion" required><br/>
      <button style="padding:10px 15px;background:green;color:white;border:none;border-radius:5px;">Guardar</button>
    </form>
    <a href="/admin/caja">⬅ Volver</a>
  `);
});

// Registrar movimiento
app.post("/admin/caja/nuevo", async (req,res) => {
  if(!req.session.admin) return res.redirect("/login");
  const { monto, tipo, descripcion } = req.body;
  try {
    await pool.query(
      "INSERT INTO caja(tipo,monto,descripcion) VALUES($1,$2,$3)",
      [tipo, Number(monto), descripcion]
    );
    res.redirect("/admin/caja");
  } catch(err){
    res.send(`<h2>Error registrando movimiento:</h2><pre>${err.message}</pre>`);
  }
});
app.get("/admin/cuotas", async (req, res) => {
  if (!req.session.admin) return res.redirect("/login");

  const cuotas = (await pool.query(`
    SELECT q.*, v.cliente_id, c.nombre
    FROM cuotas_ventas q
    JOIN ventas v ON v.id = q.venta_id
    LEFT JOIN clientes c ON c.id = v.cliente_id
    ORDER BY q.fecha_vencimiento
  `)).rows;

  res.send(`
    <h2>Cuotas</h2>
    <ul>
      ${cuotas.map(q => `
        <li>
          Venta #${q.venta_id} - ${q.nombre || "Mostrador"} -
          Cuota ${q.numero} -
          ${formatGs(q.monto)} -
          Vence: ${q.fecha_vencimiento} -
          ${q.pagada ? "✅ Pagada" : "❌ Pendiente"}
        </li>
      `).join("")}
    </ul>

    <a href="/admin">⬅ Volver</a>
  `);
});
app.get("/admin", async (req, res) => {
  if (!req.session.admin) return res.redirect("/login");

  try {
    const clientes = (await pool.query("SELECT * FROM clientes")).rows;
    const productos = (await pool.query("SELECT * FROM productos")).rows;

    res.send(`
      <html>
        <body>
          <h2>Dashboard Ventas</h2>
<h3>Menú</h3>
<ul>
  <li><a href="/admin/registrar-venta">➕ Registrar Venta</a></li>
  <li><a href="/admin/ventas">📄 Ventas</a></li>
  <li><a href="/admin/caja">💰 Caja</a></li>
  <li><a href="/admin/cuotas">🧾 Cuotas</a></li>
</ul>
<hr/>
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
  const { nombre, categoria, codigo, precio_unitario, precio_mayorista, stock } = req.body;
  try {
    const existing = await pool.query("SELECT * FROM productos WHERE codigo = $1", [codigo]);
    if(existing.rows.length > 0){
      // Si existe, solo aumenta stock
      await pool.query(
        "UPDATE productos SET stock = stock + $1, nombre=$2, categoria=$3, precio_unitario=$4, precio_mayorista=$5 WHERE codigo=$6",
        [Number(stock), nombre, categoria, precio_unitario, precio_mayorista || null, codigo]
      );
    } else {
      // Si no existe, crea producto
      await pool.query(
        "INSERT INTO productos(nombre, categoria, codigo, precio_unitario, precio_mayorista, stock) VALUES ($1,$2,$3,$4,$5,$6)",
        [nombre, categoria, codigo, precio_unitario, precio_mayorista || null, Number(stock) || 0]
      );
    }
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