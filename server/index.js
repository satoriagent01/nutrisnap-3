const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const Tesseract = require('tesseract.js');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Ensure uploads directory exists
if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
}

// Database Setup
const db = new Database('nutrisnap.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    calories REAL,
    protein REAL,
    carbs REAL,
    fat REAL,
    sodium REAL,
    saturated_fat REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS meals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS meal_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meal_id INTEGER,
    product_id INTEGER,
    serving_grams REAL,
    FOREIGN KEY (meal_id) REFERENCES meals(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );
`);

// Multer Config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage: storage });

// OCR Endpoint
app.post('/api/scan', upload.single('image'), async (req, res) => {
  try {
    const result = await Tesseract.recognize(req.file.path, 'eng');
    const text = result.data.text;
    
    // Simple heuristic parsing for nutrition labels
    // This is a basic implementation. Real-world would need more robust regex or AI.
    const parsed = parseNutritionLabel(text);
    
    res.json({ text, parsed });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'OCR failed' });
  }
});

// Helper: Basic Regex Parser for Nutrition Facts
function parseNutritionLabel(text) {
  const lines = text.split('\n');
  const data = {
    name: '',
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    sodium: 0,
    saturated_fat: 0
  };

  // Try to find product name (usually at the top, non-numeric)
  // This is a guess. In a real app, user edits this.
  const firstLine = lines.find(l => l.trim().length > 0);
  if (firstLine) data.name = firstLine.trim();

  // Regex patterns for common nutrition label formats
  const patterns = [
    { key: 'calories', regex: /(?:Calories|Cal|Energía)\s*[:\-]?\s*(\d+)/i },
    { key: 'fat', regex: /(?:Total Fat|Grasa Total)\s*[:\-]?\s*(\d+\.?\d*)/i },
    { key: 'saturated_fat', regex: /(?:Saturated Fat|Grasa Saturada)\s*[:\-]?\s*(\d+\.?\d*)/i },
    { key: 'carbs', regex: /(?:Total Carbohydrate|Carbohidratos Totales)\s*[:\-]?\s*(\d+\.?\d*)/i },
    { key: 'protein', regex: /(?:Protein|Proteína)\s*[:\-]?\s*(\d+\.?\d*)/i },
    { key: 'sodium', regex: /(?:Sodium|Sodio)\s*[:\-]?\s*(\d+\.?\d*)/i }
  ];

  const fullText = lines.join(' ');
  
  patterns.forEach(p => {
    const match = fullText.match(p.regex);
    if (match) {
      data[p.key] = parseFloat(match[1]);
    }
  });

  return data;
}

// Products Endpoints
app.get('/api/products', (req, res) => {
  const stmt = db.prepare('SELECT * FROM products ORDER BY created_at DESC');
  res.json(stmt.all());
});

app.post('/api/products', (req, res) => {
  const { name, calories, protein, carbs, fat, sodium, saturated_fat } = req.body;
  const stmt = db.prepare(`
    INSERT INTO products (name, calories, protein, carbs, fat, sodium, saturated_fat)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(name, calories, protein, carbs, fat, sodium, saturated_fat);
  res.json({ id: info.lastInsertRowid, ...req.body });
});

// Meals Endpoints
app.get('/api/meals', (req, res) => {
  const stmt = db.prepare('SELECT * FROM meals ORDER BY created_at DESC');
  res.json(stmt.all());
});

app.post('/api/meals', (req, res) => {
  const { name } = req.body;
  const stmt = db.prepare('INSERT INTO meals (name) VALUES (?)');
  const info = stmt.run(name);
  res.json({ id: info.lastInsertRowid, name });
});

app.post('/api/meals/:id/items', (req, res) => {
  const { meal_id } = req.params;
  const { product_id, serving_grams } = req.body;
  const stmt = db.prepare('INSERT INTO meal_items (meal_id, product_id, serving_grams) VALUES (?, ?, ?)');
  const info = stmt.run(meal_id, product_id, serving_grams);
  res.json({ id: info.lastInsertRowid, meal_id, product_id, serving_grams });
});

app.get('/api/meals/:id', (req, res) => {
  const { id } = req.params;
  const stmt = db.prepare(`
    SELECT 
      m.name as meal_name,
      p.name as product_name,
      mi.serving_grams,
      p.calories,
      p.protein,
      p.carbs,
      p.fat,
      p.sodium,
      p.saturated_fat
    FROM meal_items mi
    JOIN products p ON mi.product_id = p.id
    JOIN meals m ON mi.meal_id = m.id
    WHERE mi.meal_id = ?
  `);
  res.json(stmt.all(id));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
