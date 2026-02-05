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
    // Clientes
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clientes (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        tipo TEXT NOT NULL DEFAULT 'mostrador',
        documento TEXT,
        telefono TEXT
      )
    `);

    // Productos con costo, utilidad y código
    await pool.query(`
      CREATE TABLE IF NOT EXISTS productos (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        categoria TEXT,
        codigo TEXT UNIQUE,
        precio_unitario NUMERIC NOT NULL,
        precio_mayorista NUMERIC,
        costo NUMERIC,
        utilidad NUMERIC,
        stock INTEGER DEFAULT 0
      )
    `);
// Asegurar columnas adicionales
await pool.query(`ALTER TABLE productos ADD COLUMN IF NOT EXISTS codigo TEXT UNIQUE`);
await pool.query(`ALTER TABLE productos ADD COLUMN IF NOT EXISTS costo NUMERIC`);
await pool.query(`ALTER TABLE productos ADD COLUMN IF NOT EXISTS utilidad NUMERIC`);
    // Ventas y detalle
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

    // Caja
    await pool.query(`
      CREATE TABLE IF NOT EXISTS caja (
        id SERIAL PRIMARY KEY,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        tipo TEXT NOT NULL,
        monto NUMERIC NOT NULL,
        descripcion TEXT
      )
    `);

    // Cuotas
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
        // Pagos parciales
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pagos_credito (
        id SERIAL PRIMARY KEY,
        cuota_id INTEGER REFERENCES cuotas_ventas(id) ON DELETE CASCADE,
        monto NUMERIC NOT NULL,
        descripcion TEXT,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log("DB inicializada correctamente");
  } catch (err) {
    console.error("Error inicializando DB:", err.message);
  }
}

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
    res.send("<script>alert('Credenciales incorrectas');window.location='/login';</script>");
  }
});

// ======// ====================== DASHBOARD ======================
app.get("/admin", async (req, res) => {
  if (!req.session.admin) return res.redirect("/login");

  try {
    // Traer clientes y productos
    const clientes = (await pool.query("SELECT * FROM clientes")).rows;
    const productos = (await pool.query("SELECT * FROM productos")).rows;

    // Traer detalle de ventas agrupado por producto
    const detalleVentas = await pool.query(`
      SELECT producto_id, SUM(cantidad) AS total_vendido, SUM(cantidad * precio_unitario) AS total_ingresos
      FROM detalle_ventas
      GROUP BY producto_id
    `);

    const detalleMap = {};
    detalleVentas.rows.forEach(d => {
      detalleMap[d.producto_id] = d;
    });

    res.send(`
      <html>
        <body>
          <h2>Dashboard Ventas</h2>

          <h3>Menú</h3>
          <ul>
            <li><a href="/admin/registrar-venta">➕ Registrar Venta</a></li>
            <li><a href="/admin/ventas">📄 Ventas</a></li>
            <li><a href="/admin/caja">💰 Caja</a></li>
            <li><a href="/admin/creditos">💳 Créditos pendientes</a></li>
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
            ${clientes.map(c => `<li>${c.nombre} (${c.tipo})</li>`).join("")}
          </ul>

          <h3>Agregar Producto</h3>
          <form method="POST" action="/admin/productos">
            <input name="nombre" placeholder="Nombre" required>
            <input name="categoria" placeholder="Categoría">
            <input name="codigo" placeholder="Código">
            <input name="costo" type="number" step="0.01" placeholder="Costo">
            <input name="precio_unitario" type="number" step="0.01" placeholder="Precio Unitario" required>
            <input name="precio_mayorista" type="number" step="0.01" placeholder="Precio Mayorista">
            <input name="stock" type="number" placeholder="Stock" value="0">
            <button>Agregar Producto</button>
          </form>

          <h3>Productos</h3>
          <ul>
            ${productos.map(p => {
              const detalle = detalleMap[p.id];
              const totalVendido = detalle ? Number(detalle.total_vendido) : 0;
              const totalIngresos = detalle ? Number(detalle.total_ingresos) : 0;
              const totalCosto = totalVendido * (p.costo || 0);
              const utilidadReal = totalIngresos - totalCosto;

              return `<li>
                <strong>${p.nombre}</strong> - Código: ${p.codigo || '-'} - Stock: ${p.stock} - 
                Costo unitario: ${formatGs(p.costo || 0)} - Precio venta: ${formatGs(p.precio_unitario)}<br/>
                Total vendido: ${totalVendido} unidades - Utilidad real: ${formatGs(utilidadReal)}
              </li>`;
            }).join("")}
          </ul>
        </body>
      </html>
    `);

  } catch(err) {
    res.send(`<h2>Error cargando dashboard:</h2><pre>${err.message}</pre>`);
  }
});

// ====================== CLIENTES / PRODUCTOS ======================
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
  const { nombre, categoria, codigo, precio_unitario, precio_mayorista, stock, costo } = req.body;
  try {
    const utilidad = precio_unitario - (costo || 0);
    const existing = await pool.query("SELECT * FROM productos WHERE codigo = $1", [codigo]);
    if(existing.rows.length > 0){
      await pool.query(
        `UPDATE productos 
         SET stock = stock + $1, nombre=$2, categoria=$3, precio_unitario=$4, precio_mayorista=$5, costo=$6, utilidad=$7 
         WHERE codigo=$8`,
        [Number(stock), nombre, categoria, precio_unitario, precio_mayorista || null, costo || 0, utilidad, codigo]
      );
    } else {
      await pool.query(
        `INSERT INTO productos(nombre, categoria, codigo, precio_unitario, precio_mayorista, costo, utilidad, stock)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [nombre, categoria, codigo, precio_unitario, precio_mayorista || null, costo || 0, utilidad, Number(stock) || 0]
      );
    }
    res.redirect("/admin");
  } catch (err) {
    res.send(`<h2>Error agregando producto:</h2><pre>${err.message}</pre>`);
  }
});

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
          <select name="cliente_id" required id="clienteSelect" onchange="actualizarPrecios()">
            ${clientes.map(c => `<option value="${c.id}" data-tipo="${c.tipo}">${c.nombre}</option>`).join('')}
          </select><br/><br/>
          
          <label>Tipo de venta:</label>
          <select name="tipo" required>
            <option value="contado">Contado</option>
            <option value="credito">Crédito</option>
          </select><br/><br/>
          
          <h3>Productos</h3>
${productos.map(p => `
  <label>
    ${p.nombre} (Stock: ${p.stock}) - 
    Precio Normal: <span class="precio-normal">${formatGs(p.precio_unitario)}</span> 
    ${p.precio_mayorista ? `- Precio Mayorista: <span class="precio-mayorista">${formatGs(p.precio_mayorista)}</span>` : ''}
  </label>
  <input type="number" name="producto_${p.id}" value="0" min="0" max="${p.stock}"><br/>
`).join('')}

<script>
function actualizarPrecios(){
  const clienteSelect = document.getElementById('clienteSelect');
  const tipoCliente = clienteSelect.selectedOptions[0].dataset.tipo;
  document.querySelectorAll('[name^="producto_"]').forEach(input => {
    const label = input.previousElementSibling;
    const precioNormal = label.querySelector('.precio-normal');
    const precioMayorista = label.querySelector('.precio-mayorista');

    if(tipoCliente === 'mayorista' && precioMayorista){
      label.style.fontWeight = 'bold'; // resaltar el precio que se aplicará
      precioNormal.style.textDecoration = 'line-through';
    } else {
      label.style.fontWeight = 'normal';
      if(precioMayorista) precioNormal.style.textDecoration = 'none';
    }
  });
}
actualizarPrecios();
document.getElementById('clienteSelect').addEventListener('change', actualizarPrecios);
</script>
          <br/>
          <button>Registrar Venta</button>
        </form>

        <script>
          function actualizarPrecios(){
            const clienteSelect = document.getElementById('clienteSelect');
            const tipoCliente = clienteSelect.selectedOptions[0].dataset.tipo;
            const precioSpans = document.querySelectorAll('.precio');
            precioSpans.forEach(span => {
              const precioUnitario = Number(span.dataset.precioUnitario);
              const precioMayorista = span.dataset.precioMayorista ? Number(span.dataset.precioMayorista) : null;
              if(tipoCliente === 'mayorista' && precioMayorista){
                span.innerText = 'Gs. ' + precioMayorista.toLocaleString('es-PY');
              } else {
                span.innerText = 'Gs. ' + precioUnitario.toLocaleString('es-PY');
              }
            });
          }
          actualizarPrecios();
        </script>
      </body>
    </html>
  `);
});

app.post("/admin/registrar-venta", async (req, res) => {
  if (!req.session.admin) return res.redirect("/login");
  try {
    const { cliente_id, tipo } = req.body;
    const cliente = (await pool.query("SELECT * FROM clientes WHERE id=$1", [cliente_id])).rows[0];
    const productos = (await pool.query("SELECT * FROM productos")).rows;

    const items = productos.map(p => {
      const cantidad = Number(req.body['producto_' + p.id] || 0);
      let precio = p.precio_unitario;
      if(cliente.tipo === 'mayorista' && p.precio_mayorista) precio = p.precio_mayorista;
      return { ...p, cantidad, precio_unitario: precio };
    }).filter(p => p.cantidad > 0);

    if(items.length === 0) return res.send("<script>alert('Debe seleccionar al menos un producto');window.history.back();</script>");

    const total = items.reduce((sum,p)=>sum+p.precio_unitario*p.cantidad,0);
    const ventaRes = await pool.query(
      "INSERT INTO ventas(cliente_id,total,tipo) VALUES($1,$2,$3) RETURNING id",
      [cliente_id,total,tipo]
    );
    const venta_id = ventaRes.rows[0].id;

    for(const p of items){
      await pool.query(
        "INSERT INTO detalle_ventas(venta_id,producto_id,cantidad,precio_unitario) VALUES($1,$2,$3,$4)",
        [venta_id,p.id,p.cantidad,p.precio_unitario]
      );
      await pool.query("UPDATE productos SET stock=stock-$1 WHERE id=$2",[p.cantidad,p.id]);
    }

    if(tipo==='contado'){
      await pool.query("INSERT INTO caja(tipo,monto,descripcion) VALUES($1,$2,$3)",
        ["ingreso",total,`Venta ID ${venta_id} - Cliente ID ${cliente_id}`]
      );
    }

    if(tipo==='credito'){
      const fecha = new Date();
      for(let i=1;i<=3;i++){
        const fecha_vencimiento = new Date(fecha.getTime()+i*7*24*60*60*1000);
        await pool.query(
          "INSERT INTO cuotas_ventas(venta_id,numero,monto,fecha_vencimiento) VALUES($1,$2,$3,$4)",
          [venta_id,i,total/3,fecha_vencimiento.toISOString().split('T')[0]]
        );
      }
    }

    res.send("<script>alert('Venta registrada correctamente');window.location='/admin';</script>");
  } catch(err){
    res.send(`<h2>Error registrando venta:</h2><pre>${err.message}</pre>`);
  }
});

// ====================== RUTAS VENTAS ======================
app.get("/admin/ventas", async (req, res)=>{
  if(!req.session.admin) return res.redirect("/login");
  const ventas = (await pool.query(`
    SELECT v.*, c.nombre AS cliente
    FROM ventas v
    LEFT JOIN clientes c ON c.id=v.cliente_id
    ORDER BY v.id DESC
  `)).rows;
  res.send(`
    <h2>Ventas</h2>
    <a href="/admin">⬅ Volver</a>
    <ul>
      ${ventas.map(v=>`<li>Venta #${v.id} - ${v.cliente || "Mostrador"} - ${formatGs(v.total)} - ${v.tipo} <a href="/admin/ventas/${v.id}">🔍 Ver</a></li>`).join("")}
    </ul>
  `);
});

app.get("/admin/ventas/:id", async (req,res)=>{
  if(!req.session.admin) return res.redirect("/login");
  const {id} = req.params;
  const venta = (await pool.query(`
    SELECT v.*, c.nombre AS cliente
    FROM ventas v
    LEFT JOIN clientes c ON c.id=v.cliente_id
    WHERE v.id=$1
  `,[id])).rows[0];
  const detalle = (await pool.query(`
    SELECT d.*, p.nombre
    FROM detalle_ventas d
    JOIN productos p ON p.id=d.producto_id
    WHERE d.venta_id=$1
  `,[id])).rows;
  res.send(`
    <h2>Detalle Venta #${venta.id}</h2>
    <p>Cliente: ${venta.cliente || "Mostrador"}</p>
    <p>Total: ${formatGs(venta.total)}</p>
    <p>Tipo: ${venta.tipo}</p>
    <h3>Productos</h3>
    <ul>${detalle.map(d=>`<li>${d.nombre} - ${d.cantidad} x ${formatGs(d.precio_unitario)}</li>`).join("")}</ul>
    <a href="/admin/ventas">⬅ Volver</a>
  `);
});

// ====================== RUTAS CAJA MEJORADA ======================
app.get("/admin/caja", async (req,res)=>{
  if(!req.session.admin) return res.redirect("/login");

  try {
    const caja = (await pool.query(`SELECT * FROM caja ORDER BY id DESC`)).rows;

    // Calcular saldo actual
    let saldo = 0;
    caja.forEach(c => {
      if(c.tipo === 'ingreso') saldo += Number(c.monto);
      if(c.tipo === 'egreso') saldo -= Number(c.monto);
    });

    res.send(`
      <html>
        <body>
          <h2>Caja</h2>
          <a href="/admin">⬅ Volver</a>
          <h3>Saldo actual: ${formatGs(saldo)}</h3>
          
          <h3>Agregar Movimiento</h3>
          <form method="POST" action="/admin/caja">
            <select name="tipo" required>
              <option value="ingreso">Ingreso</option>
              <option value="egreso">Egreso</option>
            </select>
            <input type="number" step="0.01" name="monto" placeholder="Monto" required>
            <input type="text" name="descripcion" placeholder="Descripción" required>
            <button>Agregar</button>
          </form>
          
          <h3>Movimientos</h3>
          <ul>
            ${caja.map(c => `
              <li>
                ${c.fecha} - ${c.tipo === 'ingreso' ? '💰' : '📤'} ${formatGs(c.monto)} - ${c.descripcion || ''}
                <a href="/admin/caja/${c.id}">🔍 Detalle</a>
              </li>
            `).join("")}
          </ul>
        </body>
      </html>
    `);
  } catch(err){
    res.send(`<h2>Error cargando caja:</h2><pre>${err.message}</pre>`);
  }
});

// Ruta POST para agregar ingresos/egresos manuales
app.post("/admin/caja", async (req,res)=>{
  if(!req.session.admin) return res.redirect("/login");
  try {
    const { tipo, monto, descripcion } = req.body;
    await pool.query(
      "INSERT INTO caja(tipo, monto, descripcion) VALUES($1,$2,$3)",
      [tipo, monto, descripcion]
    );
    res.redirect("/admin/caja");
  } catch(err){
    res.send(`<h2>Error agregando movimiento:</h2><pre>${err.message}</pre>`);
  }
});

// Ruta para ver detalle de un movimiento específico
app.get("/admin/caja/:id", async (req,res)=>{
  if(!req.session.admin) return res.redirect("/login");
  try {
    const { id } = req.params;
    const movimiento = (await pool.query("SELECT * FROM caja WHERE id=$1",[id])).rows[0];
    if(!movimiento) return res.send("<h2>Movimiento no encontrado</h2>");
    
    res.send(`
      <h2>Detalle Movimiento</h2>
      <p>ID: ${movimiento.id}</p>
      <p>Fecha: ${movimiento.fecha}</p>
      <p>Tipo: ${movimiento.tipo}</p>
      <p>Monto: ${formatGs(movimiento.monto)}</p>
      <p>Descripción: ${movimiento.descripcion || '-'}</p>
      <a href="/admin/caja">⬅ Volver a Caja</a>
    `);
  } catch(err){
    res.send(`<h2>Error mostrando detalle:</h2><pre>${err.message}</pre>`);
  }
});

// ====================== CRÉDITOS PENDIENTES ======================
app.get("/admin/creditos", async (req, res) => {
  if (!req.session.admin) return res.redirect("/login");

  try {
    // Traer créditos (una sola cuota por venta)
    const creditos = (await pool.query(`
      SELECT q.id AS cuota_id, q.venta_id, v.cliente_id, c.nombre AS cliente,
             q.monto, q.pagada,
             COALESCE(SUM(pago.monto),0) AS pagado,
             (q.monto - COALESCE(SUM(pago.monto),0)) AS saldo
      FROM cuotas_ventas q
      JOIN ventas v ON v.id = q.venta_id
      LEFT JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN pagos_credito pago ON pago.cuota_id = q.id
      GROUP BY q.id, v.cliente_id, c.nombre
      ORDER BY q.id ASC
    `)).rows;

    res.send(`
      <h2>Créditos Pendientes</h2>
      <a href="/admin">⬅ Volver</a>
      <ul>
        ${creditos.map(c => `
          <li>
            Venta #${c.venta_id} - Cliente: ${c.cliente || 'Mostrador'}<br/>
            Monto crédito: ${formatGs(c.monto)} - Pagado: ${formatGs(c.pagado)} - Saldo: ${formatGs(c.saldo)}<br/>
            ${c.saldo > 0 ? `<form method="POST" action="/admin/creditos/pagar">
              <input type="hidden" name="cuota_id" value="${c.cuota_id}">
              <input type="number" step="0.01" name="monto" max="${c.saldo}" placeholder="Monto a pagar" required>
              <input type="text" name="descripcion" placeholder="Descripción" required>
              <button>Pagar parcial</button>
            </form>` : '✅ Crédito cancelado'}
          </li>
        `).join("")}
      </ul>
    `);

  } catch(err){
    res.send(`<h2>Error cargando créditos:</h2><pre>${err.message}</pre>`);
  }
});

// ====================== REGISTRAR PAGO PARCIAL ======================
app.post("/admin/creditos/pagar", async (req, res) => {
  if (!req.session.admin) return res.redirect("/login");

  try {
    const { cuota_id, monto, descripcion } = req.body;
    const pagoMonto = Number(monto);

    if(pagoMonto <= 0) return res.send("<script>alert('Monto inválido');window.history.back();</script>");

    // Insertar registro de pago parcial
    await pool.query(`
      INSERT INTO pagos_credito(cuota_id, monto, descripcion)
      VALUES($1,$2,$3)
    `,[cuota_id,pagoMonto,descripcion]);

    // Registrar ingreso en caja
    await pool.query(`
      INSERT INTO caja(tipo,monto,descripcion)
      VALUES('ingreso',$1,$2)
    `,[pagoMonto, `Pago parcial cuota ID ${cuota_id}: ${descripcion}`]);

    // Revisar si se canceló totalmente
    const saldoRes = await pool.query(`
      SELECT monto - COALESCE(SUM(pago.monto),0) AS saldo
      FROM cuotas_ventas q
      LEFT JOIN pagos_credito pago ON pago.cuota_id = q.id
      WHERE q.id = $1
      GROUP BY q.monto
    `,[cuota_id]);

    if(saldoRes.rows[0].saldo <= 0){
      await pool.query(`UPDATE cuotas_ventas SET pagada = true WHERE id=$1`,[cuota_id]);
    }

    res.redirect("/admin/creditos");

  } catch(err){
    res.send(`<h2>Error registrando pago parcial:</h2><pre>${err.message}</pre>`);
  }
});

// ====================== START SERVER ======================
(async function startServer(){
  await initDB();
  const server = app.listen(PORT,"0.0.0.0",()=>console.log("Servidor Ventaselias activo en puerto",PORT));
  server.keepAliveTimeout = 120000;
  server.headersTimeout = 120000;
})();