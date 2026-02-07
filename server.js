// ====================== IMPORTS ======================
const express = require("express");
const session = require("express-session");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");

// ====================== APP ======================
const app = express();
const PORT = process.env.PORT || 10000;

// ====================== MIDDLEWARE ======================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "ventas-secret-super-seguro",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: process.env.NODE_ENV === "production" },
  })
);

// Rate limiting para login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // 5 intentos max
  message: "Demasiados intentos de login, intente de nuevo en 15 minutos",
});
app.use("/login", loginLimiter);

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
    // Clientes (sin cambios)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clientes (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        tipo TEXT NOT NULL DEFAULT 'mostrador',
        documento TEXT,
        telefono TEXT
      )
    `);

    // Productos (agregar utilidad si no existe? pero calculada on-fly)
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

    // Ventas (sin cambios)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ventas (
        id SERIAL PRIMARY KEY,
        cliente_id INTEGER REFERENCES clientes(id),
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        total NUMERIC NOT NULL,
        tipo TEXT NOT NULL
      )
    `);

    // Detalle de ventas (sin cambios)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS detalle_ventas (
        id SERIAL PRIMARY KEY,
        venta_id INTEGER REFERENCES ventas(id) ON DELETE CASCADE,
        producto_id INTEGER REFERENCES productos(id),
        cantidad INTEGER NOT NULL,
        precio_unitario NUMERIC NOT NULL
      )
    `);

    // Caja (sin cambios)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS caja (
        id SERIAL PRIMARY KEY,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        tipo TEXT NOT NULL,
        monto NUMERIC NOT NULL,
        descripcion TEXT
      )
    `);

    // Cuotas / créditos (sin cambios)
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

    console.log("DB inicializada correctamente ✅");
  } catch (err) {
    console.error("Error inicializando DB:", err.message);
  }
}

// ====================== FORMAT HELPERS ======================
const formatGs = (n) => "Gs. " + Number(n).toLocaleString("es-PY");

// ====================== LOGIN ======================
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS_HASH = process.env.ADMIN_PASSWORD_HASH; // Hasheado, ej: bcrypt.hashSync('1234', 10);

app.get("/", (req, res) => res.redirect("/login"));
app.get("/login", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Login Ventas</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      </head>
      <body class="bg-light">
        <div class="container d-flex justify-content-center align-items-center vh-100">
          <div class="card p-4 shadow" style="width: 300px;">
            <h3 class="text-center mb-4">Login Ventas</h3>
            <form method="POST" action="/login">
              <div class="mb-3">
                <input name="user" class="form-control" placeholder="Usuario" required>
              </div>
              <div class="mb-3">
                <input name="pass" type="password" class="form-control" placeholder="Contraseña" required>
              </div>
              <button class="btn btn-primary w-100">Ingresar</button>
            </form>
          </div>
        </div>
      </body>
    </html>
  `);
});

app.post("/login", async (req, res) => {
  const { user, pass } = req.body;
  if (user === ADMIN_USER && ADMIN_PASS_HASH && (await bcrypt.compare(pass, ADMIN_PASS_HASH))) {
    req.session.admin = true;
    res.redirect("/admin");
  } else {
    res.send(`
      <script>alert('Credenciales incorrectas'); window.location='/login';</script>
    `);
  }
});

// Middleware de auth
function requireAuth(req, res, next) {
  if (!req.session.admin) return res.redirect("/login");
  next();
}

// ====================== DASHBOARD ======================
app.get("/admin", requireAuth, async (req, res) => {
  const clientes = (await pool.query("SELECT * FROM clientes")).rows;
  const productos = (await pool.query("SELECT * FROM productos")).rows;

  res.send(`
    <!DOCTYPE html>
    <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Dashboard Ventas</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      </head>
      <body>
        <div class="container-fluid">
          <div class="row">
            <nav class="col-md-2 d-none d-md-block bg-light sidebar">
              <div class="position-sticky pt-3">
                <h5 class="sidebar-heading">Menú</h5>
                <ul class="nav flex-column">
                  <li class="nav-item"><a class="nav-link" href="/admin/registrar-venta">➕ Registrar Venta</a></li>
                  <li class="nav-item"><a class="nav-link" href="/admin/ventas">📄 Ventas</a></li>
                  <li class="nav-item"><a class="nav-link" href="/admin/caja">💰 Caja</a></li>
                  <li class="nav-item"><a class="nav-link" href="/admin/creditos">🧾 Créditos</a></li>
                  <li class="nav-item"><a class="nav-link" href="/admin/reportes">📊 Reportes</a></li>
                </ul>
              </div>
            </nav>
            <main class="col-md-9 ms-sm-auto col-lg-10 px-md-4">
              <h2 class="mt-4">Dashboard Ventas</h2>
              <hr>

              <h3>Agregar Cliente</h3>
              <form method="POST" action="/admin/clientes" class="row g-3">
                <div class="col-md-3"><input name="nombre" class="form-control" placeholder="Nombre" required></div>
                <div class="col-md-3"><input name="tipo" class="form-control" placeholder="Tipo" value="mostrador"></div>
                <div class="col-md-3"><input name="documento" class="form-control" placeholder="Documento"></div>
                <div class="col-md-3"><input name="telefono" class="form-control" placeholder="Teléfono"></div>
                <div class="col-12"><button class="btn btn-primary">Agregar Cliente</button></div>
              </form>

              <h3 class="mt-4">Clientes</h3>
              <ul class="list-group">
                ${clientes
                  .map(
                    (c) => `
                  <li class="list-group-item d-flex justify-content-between align-items-center">
                    ${c.nombre} (${c.tipo})
                    <form method="POST" action="/admin/clientes/eliminar" style="display:inline">
                      <input type="hidden" name="id" value="${c.id}">
                      <button type="submit" class="btn btn-danger btn-sm" onclick="return confirm('¿Eliminar cliente?');">Eliminar</button>
                    </form>
                  </li>
                `
                  )
                  .join("")}
              </ul>

              <h3 class="mt-4">Agregar / Actualizar Producto</h3>
              <form method="POST" action="/admin/productos" class="row g-3">
                <div class="col-md-4"><label>Código</label><input type="text" name="codigo" id="codigo" class="form-control" required></div>
                <div class="col-md-4"><label>Nombre</label><input type="text" name="nombre" id="nombre" class="form-control" required></div>
                <div class="col-md-4"><label>Categoría</label><input type="text" name="categoria" id="categoria" class="form-control"></div>
                <div class="col-md-3"><label>Precio unitario</label><input type="number" name="precio_unitario" class="form-control" step="0.01" required></div>
                <div class="col-md-3"><label>Precio mayorista</label><input type="number" name="precio_mayorista" class="form-control" step="0.01"></div>
                <div class="col-md-3"><label>Costo unitario</label><input type="number" name="costo_unitario" class="form-control" step="0.01"></div>
                <div class="col-md-3"><label>Stock a sumar</label><input type="number" name="stock" class="form-control" value="0"></div>
                <div class="col-12"><button class="btn btn-primary">Guardar</button></div>
              </form>
              <script>
                document.getElementById("codigo").addEventListener("blur", async function () {
                  const codigo = this.value.trim();
                  if (!codigo) return;
                  const res = await fetch("/admin/productos/buscar/" + codigo);
                  const producto = await res.json();
                  if (producto) {
                    document.getElementById("nombre").value = producto.nombre;
                    document.getElementById("categoria").value = producto.categoria || "";
                  }
                });
              </script>

              <h3 class="mt-4">Productos</h3>
              <ul class="list-group">
                ${productos
                  .map(
                    (p) => `
                  <li class="list-group-item d-flex justify-content-between align-items-center">
                    ${p.codigo || "---"} - ${p.nombre} - Stock: ${p.stock} - Precio: ${formatGs(p.precio_unitario)}
                    ${p.precio_mayorista ? " - Mayorista: " + formatGs(p.precio_mayorista) : ""}
                    - Costo: ${formatGs(p.costo_unitario)} - Utilidad: ${formatGs(p.precio_unitario - p.costo_unitario)}
                    <form method="POST" action="/admin/productos/eliminar" style="display:inline">
                      <input type="hidden" name="id" value="${p.id}">
                      <button type="submit" class="btn btn-danger btn-sm" onclick="return confirm('¿Eliminar producto?');">Eliminar</button>
                    </form>
                  </li>
                `
                  )
                  .join("")}
              </ul>
            </main>
          </div>
        </div>
      </body>
    </html>
  `);
});

// ====================== BUSCAR PRODUCTO POR CÓDIGO ======================
app.get("/admin/productos/buscar/:codigo", requireAuth, async (req, res) => {
  try {
    const { codigo } = req.params;
    const result = await pool.query("SELECT * FROM productos WHERE codigo = $1", [codigo]);
    res.json(result.rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ====================== REGISTRAR VENTA ======================
app.get("/admin/registrar-venta", requireAuth, async (req, res) => {
  const clientes = (await pool.query("SELECT * FROM clientes")).rows;
  const productos = (await pool.query("SELECT * FROM productos")).rows;

  let productosHtml = productos
    .map(
      (p) => `
    <div class="form-check">
      <input class="form-check-input" type="checkbox" name="productos[]" value="${p.id}">
      <label class="form-check-label">${p.nombre} - Stock: ${p.stock}</label>
      <input type="number" name="cant_${p.id}" class="form-control d-inline-block w-auto ms-2" placeholder="Cantidad" min="1">
      <select name="precio_${p.id}" class="form-select d-inline-block w-auto ms-2">
        <option value="${p.precio_unitario}">Minorista: ${formatGs(p.precio_unitario)}</option>
        ${p.precio_mayorista ? `<option value="${p.precio_mayorista}">Mayorista: ${formatGs(p.precio_mayorista)}</option>` : ""}
      </select>
    </div>
  `
    )
    .join("");

  res.send(`
    <!DOCTYPE html>
    <html lang="es">
      <head>
        <title>Registrar Venta</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      </head>
      <body class="bg-light">
        <div class="container mt-4">
          <h2>Registrar Venta</h2>
          <form method="POST" action="/admin/registrar-venta">
            <div class="mb-3">
              <label>Cliente</label>
              <select name="cliente_id" class="form-select" required>
                ${clientes.map((c) => `<option value="${c.id}">${c.nombre} (${c.tipo})</option>`).join("")}
              </select>
            </div>
            <div class="mb-3">
              <label>Tipo de venta</label>
              <select name="tipo" class="form-select">
                <option value="contado">Contado</option>
                <option value="credito">Crédito</option>
              </select>
            </div>
            <div class="mb-3" id="cuotas-group" style="display:none;">
              <label>Número de Cuotas</label>
              <input type="number" name="cuotas" class="form-control" min="1" value="1">
            </div>
            <h3>Productos</h3>
            ${productosHtml}
            <button class="btn btn-primary mt-3">Registrar Venta</button>
          </form>
          <a href="/admin" class="btn btn-secondary mt-2">⬅ Volver</a>
        </div>
        <script>
          document.querySelector('select[name="tipo"]').addEventListener('change', (e) => {
            document.getElementById('cuotas-group').style.display = e.target.value === 'credito' ? 'block' : 'none';
          });
        </script>
      </body>
    </html>
  `);
});

app.post("/admin/registrar-venta", requireAuth, async (req, res) => {
  const { cliente_id, tipo, productos: prodIds, cuotas } = req.body;
  if (!prodIds) return res.send('<div class="alert alert-danger">Seleccione al menos un producto</div>');

  const ids = Array.isArray(prodIds) ? prodIds : [prodIds];
  let total = 0;
  let detalles = [];

  try {
    for (const pid of ids) {
      const cant = Number(req.body[`cant_${pid}`]);
      if (cant <= 0) continue;
      const precio = Number(req.body[`precio_${pid}`]);

      // Check stock
      const stockRes = await pool.query("SELECT stock, nombre FROM productos WHERE id=$1", [pid]);
      if (stockRes.rows.length === 0) throw new Error("Producto no encontrado");
      const { stock, nombre } = stockRes.rows[0];
      if (stock < cant) throw new Error(`Stock insuficiente para ${nombre}: solo ${stock} disponibles`);

      total += cant * precio;
      detalles.push({ pid, cant, precio });
    }

    if (detalles.length === 0) throw new Error("No hay productos válidos");

    const ventaRes = await pool.query(
      "INSERT INTO ventas(cliente_id, total, tipo) VALUES($1, $2, $3) RETURNING id",
      [cliente_id, total, tipo]
    );
    const venta_id = ventaRes.rows[0].id;

    for (const d of detalles) {
      await pool.query(
        "INSERT INTO detalle_ventas(venta_id, producto_id, cantidad, precio_unitario) VALUES($1, $2, $3, $4)",
        [venta_id, d.pid, d.cant, d.precio]
      );
      await pool.query("UPDATE productos SET stock = stock - $1 WHERE id = $2", [d.cant, d.pid]);
    }

    if (tipo === "contado") {
      await pool.query(
        "INSERT INTO caja(tipo, monto, descripcion) VALUES('ingreso', $1, $2)",
        [total, `Venta contado ID ${venta_id}`]
      );
    } else {
      const numCuotas = Math.max(1, Number(cuotas || 1));
      const montoCuota = total / numCuotas;
      const diasEntreCuotas = 30;

      for (let i = 1; i <= numCuotas; i++) {
        await pool.query(
          "INSERT INTO cuotas_ventas(venta_id, numero, monto, fecha_vencimiento) VALUES($1, $2, $3, CURRENT_DATE + ($4 * INTERVAL '1 day'))",
          [venta_id, i, montoCuota, i * diasEntreCuotas]
        );
      }
    }

    res.redirect("/admin/ventas");
  } catch (err) {
    res.send(`<div class="alert alert-danger">Error: ${err.message}</div><a href="/admin/registrar-venta" class="btn btn-secondary">Volver</a>`);
  }
});

// ====================== DETALLE DE VENTA ======================
app.get("/admin/ventas/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const venta = (
      await pool.query(
        `SELECT v.*, c.nombre AS cliente FROM ventas v LEFT JOIN clientes c ON v.cliente_id = c.id WHERE v.id = $1`,
        [id]
      )
    ).rows[0];
    if (!venta) return res.status(404).send("Venta no encontrada");

    const detalles = (
      await pool.query(
        `SELECT d.*, p.nombre, p.costo_unitario FROM detalle_ventas d JOIN productos p ON d.producto_id = p.id WHERE d.venta_id = $1`,
        [id]
      )
    ).rows;

    let detallesHtml = detalles
      .map(
        (d) => `
      <tr>
        <td>${d.nombre}</td>
        <td>${d.cantidad}</td>
        <td>${formatGs(d.precio_unitario)}</td>
        <td>${formatGs(d.costo_unitario)}</td>
        <td>${formatGs((d.precio_unitario - d.costo_unitario) * d.cantidad)}</td>
      </tr>
    `
      )
      .join("");

    const utilidadTotal = detalles.reduce((acc, d) => acc + (d.precio_unitario - d.costo_unitario) * d.cantidad, 0);

    res.send(`
      <!DOCTYPE html>
      <html lang="es">
        <head><title>Detalle Venta ${id}</title><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"></head>
        <body class="bg-light">
          <div class="container mt-4">
            <h2>Detalle de Venta ID ${id}</h2>
            <p><b>Cliente:</b> ${venta.cliente || "Mostrador"}</p>
            <p><b>Fecha:</b> ${new Date(venta.fecha).toLocaleString()}</p>
            <p><b>Total:</b> ${formatGs(venta.total)}</p>
            <p><b>Utilidad Total:</b> ${formatGs(utilidadTotal)}</p>
            <p><b>Tipo:</b> ${venta.tipo}</p>
            <table class="table table-striped">
              <thead><tr><th>Producto</th><th>Cant.</th><th>Precio Unit.</th><th>Costo Unit.</th><th>Utilidad</th></tr></thead>
              <tbody>${detallesHtml}</tbody>
            </table>
            <a href="/admin/ventas" class="btn btn-secondary">⬅ Volver a Ventas</a>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    res.send(`<div class="alert alert-danger">Error: ${err.message}</div>`);
  }
});

// ====================== LISTADO VENTAS ======================
app.get("/admin/ventas", requireAuth, async (req, res) => {
  const ventas = (
    await pool.query(`
    SELECT v.id, v.fecha, v.total, v.tipo, c.nombre AS cliente
    FROM ventas v
    LEFT JOIN clientes c ON v.cliente_id = c.id
    ORDER BY v.fecha DESC
  `)
  ).rows;

  res.send(`
    <!DOCTYPE html>
    <html lang="es">
      <head><title>Ventas</title><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"></head>
      <body class="bg-light">
        <div class="container mt-4">
          <h2>Ventas Realizadas</h2>
          <table class="table table-striped">
            <thead><tr><th>ID</th><th>Fecha</th><th>Cliente</th><th>Total</th><th>Tipo</th><th>Acción</th></tr></thead>
            <tbody>
              ${ventas
                .map(
                  (v) => `
                <tr>
                  <td>${v.id}</td>
                  <td>${new Date(v.fecha).toLocaleString()}</td>
                  <td>${v.cliente || "Mostrador"}</td>
                  <td>${formatGs(v.total)}</td>
                  <td>${v.tipo}</td>
                  <td><a href="/admin/ventas/${v.id}" class="btn btn-info btn-sm">Ver Detalle</a></td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
          <a href="/admin" class="btn btn-secondary">⬅ Volver al Dashboard</a>
        </div>
      </body>
    </html>
  `);
});

// ====================== CAJA ======================
app.get("/admin/caja", requireAuth, async (req, res) => {
  const caja = (await pool.query("SELECT * FROM caja ORDER BY fecha DESC")).rows;
  const totalCaja = caja.reduce((acc, c) => (c.tipo === "ingreso" ? acc + Number(c.monto) : acc - Number(c.monto)), 0);

  res.send(`
    <!DOCTYPE html>
    <html lang="es">
      <head><title>Caja</title><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"></head>
      <body class="bg-light">
        <div class="container mt-4">
          <h2>Caja</h2>
          <div class="alert alert-info"><b>Saldo actual:</b> ${formatGs(totalCaja)}</div>

          <form method="POST" action="/admin/caja" class="row g-3">
            <div class="col-md-3">
              <label>Tipo</label>
              <select name="tipo" class="form-select" required>
                <option value="ingreso">Ingreso</option>
                <option value="egreso">Egreso</option>
              </select>
            </div>
            <div class="col-md-3">
              <label>Monto</label>
              <input type="number" name="monto" class="form-control" step="0.01" required>
            </div>
            <div class="col-md-4">
              <label>Descripción</label>
              <input type="text" name="descripcion" class="form-control" required>
            </div>
            <div class="col-md-2"><button class="btn btn-primary mt-4">Agregar</button></div>
          </form>

          <button class="btn btn-secondary mt-3" type="button" data-bs-toggle="collapse" data-bs-target="#movimientos">Ver Movimientos</button>

          <div id="movimientos" class="collapse mt-3">
            <table class="table table-striped">
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Monto</th><th>Descripción</th></tr></thead>
              <tbody>
                ${caja
                  .map(
                    (c) => `
                  <tr>
                    <td>${new Date(c.fecha).toLocaleString()}</td>
                    <td>${c.tipo}</td>
                    <td>${formatGs(c.monto)}</td>
                    <td>${c.descripcion || ""}</td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
          <a href="/admin" class="btn btn-secondary mt-3">⬅ Volver</a>
        </div>
        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
      </body>
    </html>
  `);
});

app.post("/admin/caja", requireAuth, async (req, res) => {
  const { tipo, monto, descripcion } = req.body;
  if (!tipo || !monto || !descripcion) return res.send('<div class="alert alert-danger">Complete todos los campos</div>');

  await pool.query("INSERT INTO caja(tipo, monto, descripcion) VALUES($1, $2, $3)", [tipo, monto, descripcion]);
  res.redirect("/admin/caja");
});

// ====================== CREDITOS PENDIENTES ======================
app.get("/admin/creditos", requireAuth, async (req, res) => {
  const creditos = (
    await pool.query(`
    SELECT cu.id AS cuota_id, v.id AS venta_id, cl.nombre AS cliente, cu.monto, cu.fecha_vencimiento, cu.pagada
    FROM cuotas_ventas cu
    JOIN ventas v ON cu.venta_id = v.id
    JOIN clientes cl ON v.cliente_id = cl.id
    WHERE cu.pagada = false
    ORDER BY cu.fecha_vencimiento ASC
  `)
  ).rows;

  res.send(`
    <!DOCTYPE html>
    <html lang="es">
      <head><title>Créditos</title><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"></head>
      <body class="bg-light">
        <div class="container mt-4">
          <h2>Créditos Pendientes</h2>
          <table class="table table-striped">
            <thead><tr><th>Cuota ID</th><th>Venta ID</th><th>Cliente</th><th>Monto</th><th>Vencimiento</th><th>Acción</th></tr></thead>
            <tbody>
              ${creditos
                .map(
                  (c) => `
                <tr>
                  <td>${c.cuota_id}</td>
                  <td>${c.venta_id}</td>
                  <td>${c.cliente}</td>
                  <td>${formatGs(c.monto)}</td>
                  <td>${new Date(c.fecha_vencimiento).toLocaleDateString()}</td>
                  <td>
                    <form method="POST" action="/admin/creditos/pagar" class="d-flex">
                      <input type="hidden" name="cuota_id" value="${c.cuota_id}">
                      <input type="number" name="pago" class="form-control me-2" step="0.01" max="${c.monto}" placeholder="Monto a pagar" required>
                      <button class="btn btn-success btn-sm">Pagar</button>
                    </form>
                  </td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
          <a href="/admin" class="btn btn-secondary">⬅ Volver</a>
        </div>
      </body>
    </html>
  `);
});

app.post("/admin/creditos/pagar", requireAuth, async (req, res) => {
  const { cuota_id, pago } = req.body;
  const montoPago = Number(pago);

  if (!montoPago || montoPago <= 0) return res.send('<div class="alert alert-danger">Monto inválido</div>');

  try {
    const cuotaRes = await pool.query("SELECT * FROM cuotas_ventas WHERE id=$1", [cuota_id]);
    if (cuotaRes.rows.length === 0) throw new Error("Cuota no encontrada");

    const cuota = cuotaRes.rows[0];
    const nuevoMonto = cuota.monto - montoPago;

    if (nuevoMonto <= 0) {
      await pool.query("UPDATE cuotas_ventas SET monto=0, pagada=true WHERE id=$1", [cuota_id]);
    } else {
      await pool.query("UPDATE cuotas_ventas SET monto=$1 WHERE id=$2", [nuevoMonto, cuota_id]);
    }

    await pool.query("INSERT INTO caja(tipo, monto, descripcion) VALUES('ingreso', $1, $2)", [
      montoPago,
      `Pago cuota ID ${cuota_id}`,
    ]);

    res.redirect("/admin/creditos");
  } catch (err) {
    res.send(`<div class="alert alert-danger">Error: ${err.message}</div>`);
  }
});

// ====================== REPORTES ======================
app.get("/admin/reportes", requireAuth, async (req, res) => {
  // Ventas diarias
  const ventasDiarias = (
    await pool.query(`
      SELECT DATE(fecha) AS dia, SUM(total) AS total_ventas
      FROM ventas
      GROUP BY dia
      ORDER BY dia DESC
      LIMIT 7
    `)
  ).rows;

  // Utilidades mensuales
  const utilidadesMensuales = (
    await pool.query(`
      SELECT TO_CHAR(fecha, 'YYYY-MM') AS mes,
      SUM(d.cantidad * (d.precio_unitario - p.costo_unitario)) AS utilidad
      FROM ventas v
      JOIN detalle_ventas d ON v.id = d.venta_id
      JOIN productos p ON d.producto_id = p.id
      GROUP BY mes
      ORDER BY mes DESC
      LIMIT 3
    `)
  ).rows;

  // Stock bajo
  const stockBajo = (
    await pool.query("SELECT * FROM productos WHERE stock < 5 ORDER BY stock ASC")
  ).rows;

  let ventasHtml = ventasDiarias
    .map((v) => `<tr><td>${v.dia}</td><td>${formatGs(v.total_ventas || 0)}</td></tr>`)
    .join("");

  let utilidadesHtml = utilidadesMensuales
    .map((u) => `<tr><td>${u.mes}</td><td>${formatGs(u.utilidad || 0)}</td></tr>`)
    .join("");

  let stockHtml = stockBajo
    .map((p) => `<tr><td>${p.nombre}</td><td>${p.stock}</td></tr>`)
    .join("");

  res.send(`
    <!DOCTYPE html>
    <html lang="es">
      <head><title>Reportes</title><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"></head>
      <body class="bg-light">
        <div class="container mt-4">
          <h2>Reportes</h2>

          <h3>Ventas Diarias (Últimos 7 días)</h3>
          <table class="table table-striped"><thead><tr><th>Día</th><th>Total</th></tr></thead><tbody>${ventasHtml}</tbody></table>

          <h3>Utilidades Mensuales (Últimos 3 meses)</h3>
          <table class="table table-striped"><thead><tr><th>Mes</th><th>Utilidad</th></tr></thead><tbody>${utilidadesHtml}</tbody></table>

          <h3>Productos con Stock Bajo (<5)</h3>
          <table class="table table-striped"><thead><tr><th>Producto</th><th>Stock</th></tr></thead><tbody>${stockHtml}</tbody></table>

          <a href="/admin" class="btn btn-secondary">⬅ Volver</a>
        </div>
      </body>
    </html>
  `);
});

// ====================== AGREGAR CLIENTES / PRODUCTOS ======================
app.post("/admin/clientes", requireAuth, async (req, res) => {
  const { nombre, tipo, documento, telefono } = req.body;
  try {
    await pool.query("INSERT INTO clientes(nombre, tipo, documento, telefono) VALUES($1, $2, $3, $4)", [
      nombre,
      tipo || "mostrador",
      documento,
      telefono,
    ]);
    res.redirect("/admin");
  } catch (err) {
    res.send(`<div class="alert alert-danger">Error: ${err.message}</div>`);
  }
});

app.post("/admin/productos", requireAuth, async (req, res) => {
  const { nombre, categoria, codigo, precio_unitario, precio_mayorista, costo_unitario, stock } = req.body;
  try {
    const existing = await pool.query("SELECT * FROM productos WHERE codigo=$1", [codigo]);
    if (existing.rows.length > 0) {
      await pool.query(
        "UPDATE productos SET stock=stock+$1, nombre=$2, categoria=$3, precio_unitario=$4, precio_mayorista=$5, costo_unitario=$6 WHERE codigo=$7",
        [Number(stock) || 0, nombre, categoria, precio_unitario, precio_mayorista || null, costo_unitario || 0, codigo]
      );
    } else {
      await pool.query(
        "INSERT INTO productos(nombre, categoria, codigo, precio_unitario, precio_mayorista, costo_unitario, stock) VALUES($1, $2, $3, $4, $5, $6, $7)",
        [nombre, categoria, codigo, precio_unitario, precio_mayorista || null, costo_unitario || 0, Number(stock) || 0]
      );
    }
    res.redirect("/admin");
  } catch (err) {
    res.send(`<div class="alert alert-danger">Error: ${err.message}</div>`);
  }
});

app.post("/admin/clientes/eliminar", requireAuth, async (req, res) => {
  const { id } = req.body;
  try {
    await pool.query("DELETE FROM clientes WHERE id=$1", [id]);
    res.redirect("/admin");
  } catch (err) {
    res.send(`<div class="alert alert-danger">Error: ${err.message}</div>`);
  }
});

app.post("/admin/productos/eliminar", requireAuth, async (req, res) => {
  const { id } = req.body;
  try {
    await pool.query("DELETE FROM productos WHERE id=$1", [id]);
    res.redirect("/admin");
  } catch (err) {
    res.send(`<div class="alert alert-danger">Error: ${err.message}</div>`);
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