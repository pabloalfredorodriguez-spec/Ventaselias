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
app.use(
  session({
    secret: "ventas-secret",
    resave: false,
    saveUninitialized: false,
  })
);

// ====================== DB ======================
// URL de la base de datos, con fallback seguro
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://postgres:1234@localhost:5432/ventas"; // Ajusta a tu base local si quieres probar

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
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
    console.log("DB inicializada correctamente");
  } catch (err) {
    console.error("Error inicializando DB:", err.message);
  }
}
initDB();

// ====================== HELPERS ======================
const formatGs = (n) => "Gs. " + Number(n).toLocaleString("es-PY");
const formatDate = (d) => (d ? new Date(d).toISOString().split("T")[0] : "");
const today = () => new Date().toISOString().split("T")[0];

// ====================== LOGIN ======================
const ADMIN = { user: "admin", pass: "1234" };

app.get("/login", (req, res) => {