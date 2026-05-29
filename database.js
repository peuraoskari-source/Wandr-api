const Database = require('better-sqlite3')

const dbPath = process.env.RAILWAY_VOLUME_MOUNT_PATH 
  ? `${process.env.RAILWAY_VOLUME_MOUNT_PATH}/wandr.db`
  : 'wandr.db'
const db = new Database(dbPath)

db.exec(`
  CREATE TABLE IF NOT EXISTS routes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    from_city   TEXT NOT NULL,
    airport     TEXT NOT NULL,
    dest_city   TEXT NOT NULL,
    type        TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS price_snapshots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id   INTEGER NOT NULL,
    price      REAL NOT NULL,
    stops      INTEGER DEFAULT 0,
    dep        TEXT,
    dur        TEXT,
    seats      TEXT,
    seen_at    TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (route_id) REFERENCES routes(id)
  );
`)

function savePrice({ from, airport, dest, type, price, stops, dep, dur, seats }) {
  let route = db.prepare(`
    SELECT id FROM routes WHERE from_city = ? AND dest_city = ? AND type = ?
  `).get(from, dest, type)

  if (!route) {
    const result = db.prepare(`
      INSERT INTO routes (from_city, airport, dest_city, type) VALUES (?, ?, ?, ?)
    `).run(from, airport, dest, type)
    route = { id: result.lastInsertRowid }
  }

  db.prepare(`
    INSERT INTO price_snapshots (route_id, price, stops, dep, dur, seats)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(route.id, price, stops, dep, dur, seats)

  return route.id
}

function getMedian(from, dest, type) {
  const row = db.prepare(`
    SELECT AVG(price) as median, MIN(price) as min, MAX(price) as max, COUNT(*) as snapshots
    FROM price_snapshots ps
    JOIN routes r ON ps.route_id = r.id
    WHERE r.from_city = ? AND r.dest_city = ? AND r.type = ?
  `).get(from, dest, type)

  return {
    median:    Math.round(row.median || 0),
    min:       Math.round(row.min    || 0),
    max:       Math.round(row.max    || 0),
    snapshots: row.snapshots
  }
}

function getAllDeals() {
  return db.prepare(`
    SELECT
      r.id,
      r.from_city  as "from",
      r.airport,
      r.dest_city  as dest,
      r.type,
      latest.price,
      latest.stops,
      latest.dep,
      latest.dur,
      latest.seats,
      latest.seen_at,
      stats.median,
      stats.min,
      stats.max,
      stats.snapshots
    FROM routes r
    JOIN price_snapshots latest ON latest.id = (
      SELECT MAX(id) FROM price_snapshots WHERE route_id = r.id
    )
    JOIN (
      SELECT
        route_id,
        ROUND(AVG(price)) as median,
        MIN(price)        as min,
        MAX(price)        as max,
        COUNT(*)          as snapshots
      FROM price_snapshots
      GROUP BY route_id
    ) stats ON stats.route_id = r.id
    ORDER BY (1.0 - latest.price / stats.median) DESC
  `).all()
}

module.exports = { savePrice, getMedian, getAllDeals, db }