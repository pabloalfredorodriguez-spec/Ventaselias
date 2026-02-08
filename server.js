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
    saveUninitialized: true,
    cookie: { secure: false },
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

    console.log("DB inicializada correctamente ✅");
  } catch (err) {
    console.error("Error inicializando DB:", err.message);
  }
}

// ====================== FORMAT HELPERS ======================
const formatGs = (n) => "Gs. " + Number(n || 0).toLocaleString("es-PY");

// ====================== AUTH MIDDLEWARE ======================
function requireAuth(req, res, next) {
  if (!req.session.admin) return res.redirect("/login");
  next();
}

// ====================== LOGIN ======================
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "1234";

app.get("/", (req, res) => res.redirect("/login"));

app.get("/login", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Login - Ventas</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    </head>
    <body class="bg-light d-flex align-items-center justify-content-center vh-100">
      <div class="card shadow-lg p-5" style="max-width: 400px; width: 100%;">
        <h3 class="text-center mb-4 text-primary">Iniciar Sesión</h3>
        <form method="POST" action="/login">
          <div class="mb-3">
            <input name="user" class="form-control form-control-lg" placeholder="Usuario" required autofocus>
          </div>
          <div class="mb-3">
            <input name="pass" type="password" class="form-control form-control-lg" placeholder="Contraseña" required>
          </div>
          <button class="btn btn-primary btn-lg w-100">Ingresar</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

app.post("/login", (req, res) => {
  const { user, pass } = req.body;
  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    req.session.admin = true;
    res.redirect("/admin");
  } else {
    res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
      <body class="bg-light d-flex align-items-center justify-content-center vh-100">
        <div class="alert alert-danger text-center p-5 shadow" style="max-width: 500px;">
          <h4>Credenciales incorrectas</h4>
          <p>Usuario o contraseña inválidos. Intente nuevamente.</p>
          <a href="/login" class="btn btn-primary">Volver al login</a>
        </div>
      </body>
      </html>
    `);
  }
});

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
      <title>Dashboard - Ventas</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    </head>
    <body>
      <nav class="navbar navbar-expand-lg navbar-dark bg-dark fixed-top">
        <div class="container-fluid">
          <a class="navbar-brand" href="/admin">Ventas Dashboard</a>
          <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
            <span class="navbar-toggler-icon"></span>
          </button>
          <div class="collapse navbar-collapse" id="navbarNav">
            <ul class="navbar-nav ms-auto">
              <li class="nav-item"><a class="nav-link" href="/admin/registrar-venta">Registrar Venta</a></li>
              <li class="nav-item"><a class="nav-link" href="/admin/ventas">Ventas</a></li>
              <li class="nav-item"><a class="nav-link" href="/admin/caja">Caja</a></li>
              <li class="nav-item"><a class="nav-link" href="/admin/creditos">Créditos</a></li>
            </ul>
          </div>
        </div>
      </nav>

      <div class="container mt-5 pt-5">
        <h2 class="mb-4 text-center">Panel Principal</h2>

        <!-- Agregar Cliente -->
        <div class="card mb-4 shadow">
          <div class="card-header bg-primary text-white"><h5>Agregar Cliente</h5></div>
          <div class="card-body">
            <form method="POST" action="/admin/clientes" class="row g-3">
              <div class="col-md-3"><input name="nombre" class="form-control" placeholder="Nombre" required></div>
              <div class="col-md-3"><input name="tipo" class="form-control" placeholder="Tipo" value="mostrador"></div>
              <div class="col-md-3"><input name="documento" class="form-control" placeholder="Documento"></div>
              <div class="col-md-3"><input name="telefono" class="form-control" placeholder="Teléfono"></div>
              <div class="col-12"><button class="btn btn-primary">Agregar Cliente</button></div>
            </form>
          </div>
        </div>

        <!-- Clientes -->
        <div class="card mb-4 shadow">
          <div class="card-header bg-info text-white"><h5>Clientes Registrados</h5></div>
          <div class="card-body">
            <div class="table-responsive">
              <table class="table table-striped table-hover">
                <thead><tr><th>Nombre</th><th>Tipo</th><th>Documento</th><th>Teléfono</th><th>Acción</th></tr></thead>
                <tbody>
                  ${clientes.map(c => `
                    <tr>
                      <td>${c.nombre}</td>
                      <td>${c.tipo}</td>
                      <td>${c.documento || '-'}</td>
                      <td>${c.telefono || '-'}</td>
                      <td>
                        <form method="POST" action="/admin/clientes/eliminar" style="display:inline">
                          <input type="hidden" name="id" value="${c.id}">
                          <button type="submit" class="btn btn-danger btn-sm" onclick="return confirm('¿Eliminar cliente ${c.nombre}?');">Eliminar</button>
                        </form>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- Agregar Producto -->
        <div class="card mb-4 shadow">
          <div class="card-header bg-success text-white"><h5>Agregar / Actualizar Producto</h5></div>
          <div class="card-body">
            <form method="POST" action="/admin/productos" class="row g-3">
              <div class="col-md-3">
                <label class="form-label">Código</label>
                <input type="text" name="codigo" id="codigo" class="form-control" required>
              </div>
              <div class="col-md-4">
                <label class="form-label">Nombre</label>
                <input type="text" name="nombre" id="nombre" class="form-control" required>
              </div>
              <div class="col-md-3">
                <label class="form-label">Categoría</label>
                <input type="text" name="categoria" id="categoria" class="form-control">
              </div>
              <div class="col-md-3">
                <label class="form-label">Precio unitario</label>
                <input type="number" name="precio_unitario" step="0.01" class="form-control" required>
              </div>
              <div class="col-md-3">
                <label class="form-label">Precio mayorista</label>
                <input type="number" name="precio_mayorista" step="0.01" class="form-control">
              </div>
              <div class="col-md-3">
                <label class="form-label">Costo unitario</label>
                <input type="number" name="costo_unitario" step="0.01" class="form-control">
              </div>
              <div class="col-md-3">
                <label class="form-label">Stock a sumar</label>
                <input type="number" name="stock" class="form-control" value="0">
              </div>
              <div class="col-12">
                <button class="btn btn-success">Guardar Producto</button>
              </div>
            </form>

            <script>
              document.getElementById("codigo").addEventListener("blur", async function () {
                const codigo = this.value.trim();
                if (!codigo) return;
                try {
                  const res = await fetch("/admin/productos/buscar/" + encodeURIComponent(codigo));
                  const producto = await res.json();
                  if (producto) {
                    document.getElementById("nombre").value = producto.nombre || "";
                    document.getElementById("categoria").value = producto.categoria || "";
                  }
                } catch(e) { console.error(e); }
              });
            </script>
          </div>
        </div>

        <!-- Productos -->
        <div class="card shadow">
          <div class="card-header bg-warning text-dark"><h5>Lista de Productos</h5></div>
          <div class="card-body">
            <div class="table-responsive">
              <table class="table table-striped table-hover">
                <thead>
                  <tr>
                    <th>Código</th><th>Nombre</th><th>Categoría</th><th>Stock</th>
                    <th>Precio Unit.</th><th>Mayorista</th><th>Costo</th><th>Utilidad</th>
                  </tr>
                </thead>
                <tbody>
                  ${productos.map(p => `
                    <tr>
                      <td>${p.codigo || '-'}</td>
                      <td>${p.nombre}</td>
                      <td>${p.categoria || '-'}</td>
                      <td>${p.stock}</td>
                      <td>${formatGs(p.precio_unitario)}</td>
                      <td>${p.precio_mayorista ? formatGs(p.precio_mayorista) : '-'}</td>
                      <td>${formatGs(p.costo_unitario || 0)}</td>
                      <td class="fw-bold">${formatGs((p.precio_unitario || 0) - (p.costo_unitario || 0))}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
    </body>
    </html>
  `);
});

// ====================== BUSCAR PRODUCTO ======================
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
    <div class="form-check mb-2 border-bottom pb-2">
      <input class="form-check-input" type="checkbox" name="productos[]" value="${p.id}" id="prod-${p.id}">
      <label class="form-check-label fw-bold" for="prod-${p.id}">${p.nombre}</label>
      <div class="d-flex align-items-center mt-1">
        <small class="text-muted me-2">Stock: ${p.stock}</small>
        <input type="number" name="cant_${p.id}" class="form-control form-control-sm w-25 me-2" placeholder="Cant." min="1" max="${p.stock}">
        <select name="precio_${p.id}" class="form-select form-select-sm w-50">
          <option value="${p.precio_unitario}">Minorista: ${formatGs(p.precio_unitario)}</option>
          ${p.precio_mayorista ? `<option value="${p.precio_mayorista}">Mayorista: ${formatGs(p.precio_mayorista)}</option>` : ""}
        </select>
      </div>
    </div>
  `
    )
    .join("");

  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Registrar Venta</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    </head>
    <body>
      <nav class="navbar navbar-expand-lg navbar-dark bg-dark fixed-top">
        <div class="container-fluid">
          <a class="navbar-brand" href="/admin">Ventas Dashboard</a>
          <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
            <span class="navbar-toggler-icon"></span>
          </button>
          <div class="collapse navbar-collapse" id="navbarNav">
            <ul class="navbar-nav ms-auto">
              <li class="nav-item"><a class="nav-link active" href="/admin/registrar-venta">Registrar Venta</a></li>
              <li class="nav-item"><a class="nav-link" href="/admin/ventas">Ventas</a></li>
              <li class="nav-item"><a class="nav-link" href="/admin/caja">Caja</a></li>
              <li class="nav-item"><a class="nav-link" href="/admin/creditos">Créditos</a></li>
            </ul>
          </div>
        </div>
      </nav>

      <div class="container mt-5 pt-5">
        <h2 class="mb-4 text-center">Registrar Nueva Venta</h2>

        <form method="POST" action="/admin/registrar-venta">
          <div class="card mb-4 shadow">
            <div class="card-header bg-primary text-white">Información de la Venta</div>
            <div class="card-body">
              <div class="row g-3">
                <div class="col-md-6">
                  <label class="form-label">Cliente</label>
                  <select name="cliente_id" class="form-select form-select-lg" required>
                    ${clientes.map((c) => `<option value="${c.id}">${c.nombre} (${c.tipo})</option>`).join("")}
                  </select>
                </div>
                <div class="col-md-6">
                  <label class="form-label">Tipo de venta</label>
                  <select name="tipo" class="form-select form-select-lg" id="tipoVenta">
                    <option value="contado">Contado</option>
                    <option value="credito">Crédito</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div class="card shadow">
            <div class="card-header bg-success text-white">Selección de Productos</div>
            <div class="card-body">
              ${productosHtml || '<p class="text-muted">No hay productos registrados aún.</p>'}
            </div>
          </div>

          <div class="d-grid mt-4">
            <button class="btn btn-success btn-lg">Registrar Venta</button>
          </div>
        </form>

        <a href="/admin" class="btn btn-secondary mt-3">⬅ Volver al Dashboard</a>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
    </body>
    </html>
  `);
});

// ====================== POST REGISTRAR VENTA ======================
app.post("/admin/registrar-venta", requireAuth, async (req, res) => {
  const { cliente_id, tipo, productos: prodIds } = req.body;
  if (!prodIds || !Array.isArray(prodIds) && !prodIds) {
    return res.send(`
      <div class="alert alert-danger m-5 text-center">
        <h4>Seleccione al menos un producto</h4>
        <a href="/admin/registrar-venta" class="btn btn-primary">Volver</a>
      </div>
    `);
  }

  const ids = Array.isArray(prodIds) ? prodIds : [prodIds];
  let total = 0;
  let detalles = [];

  try {
    for (const pid of ids) {
      const cant = Number(req.body[`cant_${pid}`] || 0);
      if (cant <= 0) continue;

      const precio = Number(req.body[`precio_${pid}`]);
      if (!precio) continue;

      const stockRes = await pool.query("SELECT stock FROM productos WHERE id = $1", [pid]);
      if (stockRes.rows.length === 0) throw new Error("Producto no encontrado");
      if (stockRes.rows[0].stock < cant) throw new Error("Stock insuficiente");

      total += cant * precio;
      detalles.push({ pid, cant, precio });
    }

    if (detalles.length === 0) throw new Error("No se seleccionaron productos válidos");

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
      // Crédito simple (1 cuota por ahora, puedes expandir)
      await pool.query(
        "INSERT INTO cuotas_ventas(venta_id, numero, monto, fecha_vencimiento) VALUES($1, 1, $2, CURRENT_DATE + 30)",
        [venta_id, total]
      );
    }

    res.send(`
      <div class="alert alert-success m-5 text-center">
        <h4>¡Venta registrada con éxito!</h4>
        <p>Total: ${formatGs(total)}</p>
        <a href="/admin/ventas" class="btn btn-primary">Ver ventas</a>
        <a href="/admin/registrar-venta" class="btn btn-success">Nueva venta</a>
        <a href="/admin" class="btn btn-secondary">Volver al dashboard</a>
      </div>
    `);
  } catch (err) {
    res.send(`
      <div class="alert alert-danger m-5 text-center">
        <h4>Error al registrar venta</h4>
        <p>${err.message}</p>
        <a href="/admin/registrar-venta" class="btn btn-primary">Volver</a>
      </div>
    `);
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
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Listado de Ventas</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    </head>
    <body>
      <nav class="navbar navbar-expand-lg navbar-dark bg-dark fixed-top">
        <div class="container-fluid">
          <a class="navbar-brand" href="/admin">Ventas Dashboard</a>
          <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
            <span class="navbar-toggler-icon"></span>
          </button>
          <div class="collapse navbar-collapse" id="navbarNav">
            <ul class="navbar-nav ms-auto">
              <li class="nav-item"><a class="nav-link" href="/admin/registrar-venta">Registrar Venta</a></li>
              <li class="nav-item"><a class="nav-link active" href="/admin/ventas">Ventas</a></li>
              <li class="nav-item"><a class="nav-link" href="/admin/caja">Caja</a></li>
              <li class="nav-item"><a class="nav-link" href="/admin/creditos">Créditos</a></li>
            </ul>
          </div>
        </div>
      </nav>

      <div class="container mt-5 pt-5">
        <h2 class="mb-4 text-center">Listado de Ventas</h2>
        <div class="table-responsive">
          <table class="table table-striped table-hover shadow">
            <thead class="table-dark">
              <tr>
                <th>ID</th><th>Fecha</th><th>Cliente</th><th>Total</th><th>Tipo</th><th>Acción</th>
              </tr>
            </thead>
            <tbody>
              ${ventas.map(v => `
                <tr>
                  <td>${v.id}</td>
                  <td>${new Date(v.fecha).toLocaleString()}</td>
                  <td>${v.cliente || 'Mostrador'}</td>
                  <td class="fw-bold">${formatGs(v.total)}</td>
                  <td><span class="badge bg-${v.tipo === 'contado' ? 'success' : 'warning'}">${v.tipo}</span></td>
                  <td><a href="/admin/ventas/${v.id}" class="btn btn-info btn-sm">Ver Detalle</a></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <a href="/admin" class="btn btn-secondary mt-3">⬅ Volver al Dashboard</a>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
    </body>
    </html>
  `);
});

// ====================== DETALLE VENTA ======================
app.get("/admin/ventas/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const venta = (
      await pool.query(
        `SELECT v.*, c.nombre AS cliente FROM ventas v LEFT JOIN clientes c ON v.cliente_id = c.id WHERE v.id = $1`,
        [id]
      )
    ).rows[0];
    if (!venta) return res.send('<div class="alert alert-danger m-5">Venta no encontrada</div>');

    const detalles = (
      await pool.query(
        `SELECT d.*, p.nombre, p.costo_unitario FROM detalle_ventas d JOIN productos p ON d.producto_id = p.id WHERE d.venta_id = $1`,
        [id]
      )
    ).rows;

    let utilidadTotal = 0;
    const detallesHtml = detalles
      .map(d => {
        const utilidad = (d.precio_unitario - (d.costo_unitario || 0)) * d.cantidad;
        utilidadTotal += utilidad;
        return `
          <tr>
            <td>${d.nombre}</td>
            <td>${d.cantidad}</td>
            <td>${formatGs(d.precio_unitario)}</td>
            <td>${formatGs(d.costo_unitario || 0)}</td>
            <td class="fw-bold">${formatGs(utilidad)}</td>
          </tr>
        `;
      })
      .join("");

    res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Detalle Venta #${id}</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
      </head>
      <body>
        <nav class="navbar navbar-expand-lg navbar-dark bg-dark fixed-top">
          <div class="container-fluid">
            <a class="navbar-brand" href="/admin">Ventas Dashboard</a>
            <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
              <span class="navbar-toggler-icon"></span>
            </button>
            <div class="collapse navbar-collapse" id="navbarNav">
              <ul class="navbar-nav ms-auto">
                <li class="nav-item"><a class="nav-link" href="/admin/registrar-venta">Registrar Venta</a></li>
                <li class="nav-item"><a class="nav-link" href="/admin/ventas">Ventas</a></li>
                <li class="nav-item"><a class="nav-link" href="/admin/caja">Caja</a></li>
                <li class="nav-item"><a class="nav-link" href="/admin/creditos">Créditos</a></li>
              </ul>
            </div>
          </div>
        </nav>

        <div class="container mt-5 pt-5">
          <div class="card shadow">
            <div class="card-header bg-info text-white">
              <h4>Detalle de Venta #${id}</h4>
            </div>
            <div class="card-body">
              <p><strong>Cliente:</strong> ${venta.cliente || "Mostrador"}</p>
              <p><strong>Fecha:</strong> ${new Date(venta.fecha).toLocaleString()}</p>
              <p><strong>Total:</strong> ${formatGs(venta.total)}</p>
              <p><strong>Tipo:</strong> <span class="badge bg-${venta.tipo === 'contado' ? 'success' : 'warning'}">${venta.tipo}</span></p>
              <p><strong>Utilidad Total:</strong> <span class="badge bg-success fs-5">${formatGs(utilidadTotal)}</span></p>

              <h5 class="mt-4">Productos Vendidos</h5>
              <div class="table-responsive">
                <table class="table table-striped">
                  <thead><tr><th>Producto</th><th>Cantidad</th><th>Precio Unit.</th><th>Costo Unit.</th><th>Utilidad</th></tr></thead>
                  <tbody>${detallesHtml}</tbody>
                </table>
              </div>
            </div>
          </div>

          <a href="/admin/ventas" class="btn btn-secondary mt-4">⬅ Volver a Ventas</a>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
      </body>
      </html>
    `);
  } catch (err) {
    res.send(`<div class="alert alert-danger m-5">Error: ${err.message}</div>`);
  }
});

// ====================== CAJA ======================
app.get("/admin/caja", requireAuth, async (req, res) => {
  const caja = (await pool.query("SELECT * FROM caja ORDER BY fecha DESC")).rows;
  const totalCaja = caja.reduce((acc, c) => (c.tipo === "ingreso" ? acc + Number(c.monto) : acc - Number(c.monto)), 0);

  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Caja</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    </head>
    <body>
      <nav class="navbar navbar-expand-lg navbar-dark bg-dark fixed-top">
        <div class="container-fluid">
          <a class="navbar-brand" href="/admin">Ventas Dashboard</a>
          <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
            <span class="navbar-toggler-icon"></span>
          </button>
          <div class="collapse navbar-collapse" id="navbarNav">
            <ul class="navbar-nav ms-auto">
              <li class="nav-item"><a class="nav-link" href="/admin/registrar-venta">Registrar Venta</a></li>
              <li class="nav-item"><a class="nav-link" href="/admin/ventas">Ventas</a></li>
              <li class="nav-item"><a class="nav-link active" href="/admin/caja">Caja</a></li>
              <li class="nav-item"><a class="nav-link" href="/admin/creditos">Créditos</a></li>
            </ul>
          </div>
        </div>
      </nav>

      <div class="container mt-5 pt-5">
        <h2 class="text-center mb-4">Gestión de Caja</h2>

        <div class="card text-center shadow mb-4">
          <div class="card-body">
            <h3>Saldo Actual</h3>
            <h1 class="display-4 fw-bold text-${totalCaja >= 0 ? 'success' : 'danger'}">${formatGs(totalCaja)}</h1>
          </div>
        </div>

        <div class="card shadow mb-4">
          <div class="card-header bg-primary text-white">Registrar Movimiento</div>
          <div class="card-body">
            <form method="POST" action="/admin/caja" class="row g-3">
              <div class="col-md-4">
                <label class="form-label">Tipo</label>
                <select name="tipo" class="form-select" required>
                  <option value="ingreso">Ingreso</option>
                  <option value="egreso">Egreso</option>
                </select>
              </div>
              <div class="col-md-4">
                <label class="form-label">Monto</label>
                <input type="number" name="monto" step="0.01" class="form-control" required>
              </div>
              <div class="col-md-4">
                <label class="form-label">Descripción</label>
                <input type="text" name="descripcion" class="form-control" required>
              </div>
              <div class="col-12">
                <button class="btn btn-primary">Agregar Movimiento</button>
              </div>
            </form>
          </div>
        </div>

        <div class="card shadow">
          <div class="card-header bg-secondary text-white">Movimientos Recientes</div>
          <div class="card-body">
            <div class="table-responsive">
              <table class="table table-striped table-hover">
                <thead><tr><th>Fecha</th><th>Tipo</th><th>Monto</th><th>Descripción</th></tr></thead>
                <tbody>
                  ${caja.map(c => `
                    <tr class="${c.tipo === 'ingreso' ? 'table-success' : 'table-danger'}">
                      <td>${new Date(c.fecha).toLocaleString()}</td>
                      <td>${c.tipo}</td>
                      <td class="fw-bold">${formatGs(c.monto)}</td>
                      <td>${c.descripcion || '-'}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <a href="/admin" class="btn btn-secondary mt-4">⬅ Volver al Dashboard</a>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
    </body>
    </html>
  `);
});

app.post("/admin/caja", requireAuth, async (req, res) => {
  const { tipo, monto, descripcion } = req.body;
  if (!tipo || !monto || !descripcion) {
    return res.send(`
      <div class="alert alert-danger m-5 text-center">
        Complete todos los campos
        <a href="/admin/caja" class="btn btn-primary mt-3">Volver</a>
      </div>
    `);
  }

  try {
    await pool.query("INSERT INTO caja(tipo, monto, descripcion) VALUES($1, $2, $3)", [tipo, monto, descripcion]);
    res.redirect("/admin/caja");
  } catch (err) {
    res.send(`
      <div class="alert alert-danger m-5 text-center">
        Error: ${err.message}
        <a href="/admin/caja" class="btn btn-primary mt-3">Volver</a>
      </div>
    `);
  }
});

// ====================== CREDITOS ======================
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
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Créditos Pendientes</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    </head>
    <body>
      <nav class="navbar navbar-expand-lg navbar-dark bg-dark fixed-top">
        <div class="container-fluid">
          <a class="navbar-brand" href="/admin">Ventas Dashboard</a>
          <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
            <span class="navbar-toggler-icon"></span>
          </button>
          <div class="collapse navbar-collapse" id="navbarNav">
            <ul class="navbar-nav ms-auto">
              <li class="nav-item"><a class="nav-link" href="/admin/registrar-venta">Registrar Venta</a></li>
              <li class="nav-item"><a class="nav-link" href="/admin/ventas">Ventas</a></li>
              <li class="nav-item"><a class="nav-link" href="/admin/caja">Caja</a></li>
              <li class="nav-item"><a class="nav-link active" href="/admin/creditos">Créditos</a></li>
            </ul>
          </div>
        </div>
      </nav>

      <div class="container mt-5 pt-5">
        <h2 class="text-center mb-4">Créditos Pendientes</h2>

        <div class="table-responsive">
          <table class="table table-striped table-hover shadow">
            <thead class="table-dark">
              <tr>
                <th>Cuota ID</th><th>Venta ID</th><th>Cliente</th>
                <th>Monto Pendiente</th><th>Vencimiento</th><th>Acción</th>
              </tr>
            </thead>
            <tbody>
              ${creditos.map(c => `
                <tr>
                  <td>${c.cuota_id}</td>
                  <td>${c.venta_id}</td>
                  <td>${c.cliente}</td>
                  <td class="fw-bold text-danger">${formatGs(c.monto)}</td>
                  <td>${new Date(c.fecha_vencimiento).toLocaleDateString()}</td>
                  <td>
                    <form method="POST" action="/admin/creditos/pagar" class="d-flex gap-2">
                      <input type="hidden" name="cuota_id" value="${c.cuota_id}">
                      <input type="number" name="pago" step="0.01" max="${c.monto}" class="form-control" placeholder="Monto a pagar" required>
                      <button class="btn btn-success btn-sm">Pagar</button>
                    </form>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <a href="/admin" class="btn btn-secondary mt-4">⬅ Volver al Dashboard</a>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
    </body>
    </html>
  `);
});

app.post("/admin/creditos/pagar", requireAuth, async (req, res) => {
  const { cuota_id, pago } = req.body;
  const montoPago = Number(pago);

  if (!montoPago || montoPago <= 0) {
    return res.send(`
      <div class="alert alert-danger m-5 text-center">
        Monto inválido
        <a href="/admin/creditos" class="btn btn-primary mt-3">Volver</a>
      </div>
    `);
  }

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

    await pool.query(
      "INSERT INTO caja(tipo, monto, descripcion) VALUES('ingreso', $1, $2)",
      [montoPago, `Pago parcial cuota ID ${cuota_id}`]
    );

    res.redirect("/admin/creditos");
  } catch (err) {
    res.send(`
      <div class="alert alert-danger m-5 text-center">
        Error: ${err.message}
        <a href="/admin/creditos" class="btn btn-primary mt-3">Volver</a>
      </div>
    `);
  }
});

// ====================== CLIENTES / PRODUCTOS ======================
app.post("/admin/clientes", requireAuth, async (req, res) => {
  const { nombre, tipo, documento, telefono } = req.body;
  try {
    await pool.query(
      "INSERT INTO clientes(nombre, tipo, documento, telefono) VALUES($1, $2, $3, $4)",
      [nombre, tipo || "mostrador", documento, telefono]
    );
    res.redirect("/admin");
  } catch (err) {
    res.send(`
      <div class="alert alert-danger m-5 text-center">
        Error al agregar cliente: ${err.message}
        <a href="/admin" class="btn btn-primary mt-3">Volver</a>
      </div>
    `);
  }
});

app.post("/admin/clientes/eliminar", requireAuth, async (req, res) => {
  const { id } = req.body;
  try {
    await pool.query("DELETE FROM clientes WHERE id=$1", [id]);
    res.redirect("/admin");
  } catch (err) {
    res.send(`
      <div class="alert alert-danger m-5 text-center">
        Error al eliminar cliente: ${err.message}
        <a href="/admin" class="btn btn-primary mt-3">Volver</a>
      </div>
    `);
  }
});

app.post("/admin/productos", requireAuth, async (req, res) => {
  const { nombre, categoria, codigo, precio_unitario, precio_mayorista, costo_unitario, stock } = req.body;
  try {
    const existing = await pool.query("SELECT * FROM productos WHERE codigo=$1", [codigo]);
    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE productos SET stock=stock+$1, nombre=$2, categoria=$3, precio_unitario=$4, precio_mayorista=$5, costo_unitario=$6 WHERE codigo=$7`,
        [Number(stock) || 0, nombre, categoria, precio_unitario, precio_mayorista || null, costo_unitario || 0, codigo]
      );
    } else {
      await pool.query(
        "INSERT INTO productos(nombre, categoria, codigo, precio_unitario, precio_mayorista, costo_unitario, stock) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [nombre, categoria, codigo, precio_unitario, precio_mayorista || null, costo_unitario || 0, Number(stock) || 0]
      );
    }
    res.redirect("/admin");
  } catch (err) {
    res.send(`
      <div class="alert alert-danger m-5 text-center">
        Error al guardar producto: ${err.message}
        <a href="/admin" class="btn btn-primary mt-3">Volver</a>
      </div>
    `);
  }
});

app.post("/admin/productos/eliminar", requireAuth, async (req, res) => {
  const { id } = req.body;
  try {
    await pool.query("DELETE FROM productos WHERE id=$1", [id]);
    res.redirect("/admin");
  } catch (err) {
    res.send(`
      <div class="alert alert-danger m-5 text-center">
        Error al eliminar producto: ${err.message}
        <a href="/admin" class="btn btn-primary mt-3">Volver</a>
      </div>
    `);
  }
});

// ====================== START SERVER ======================
(async function startServer() {
  await initDB();
  app.listen(PORT, "0.0.0.0", () =>
    console.log(`Servidor activo en puerto ${PORT}`)
  );
})();