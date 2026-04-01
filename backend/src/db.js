import pg from "pg";

const { Pool } = pg;
let pool;

export async function initDb() {
  if (pool) return;
  
  // The Nuclear Option: Disables all certificate validation for the database connection.
  // This is required on some Free tiers where Supabase's cert isn't recognized by Render.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.warn("DATABASE_URL is not set. The database connection will fail if queried.");
    return;
  }
  
  // Explicitly constructing the pool options to force SSL ignore
  pool = new Pool({
    connectionString,
    ssl: {
      rejectUnauthorized: false
    }
  });
  
  // Test the connection immediately to catch errors early
  try {
    const client = await pool.connect();
    client.release();
    console.log("Database connection successful.");
  } catch (err) {
    console.error("Failed to connect to database:", err.message);
    // Don't throw here, let individual queries show/handle the error
  }
}

function processSql(sqliteQuery) {
  let query = sqliteQuery;
  let paramCount = 1;
  while (query.includes('?')) {
    query = query.replace('?', `$${paramCount++}`);
  }
  return query;
}

function normalizeMedicine(row) {
  if (!row) return null;
  return {
    id: row.id,
    barcode: row.barcode,
    name: row.name,
    batch: row.batch,
    manufacturer: row.manufacturer,
    category: row.category,
    quantity: row.quantity,
    unit: row.unit,
    expiry: row.expiry,
    manufacturingDate: row.manufacturingdate || row.manufacturingDate,
    hospital: row.hospital,
    price: row.price,
    status: row.status,
    excess: Boolean(row.excess),
    reorderLevel: row.reorderlevel !== undefined && row.reorderlevel !== null 
                  ? row.reorderlevel 
                  : (row.reorderLevel === null ? undefined : row.reorderLevel)
  };
}

function serializeMedicine(medicine) {
  return {
    ...medicine,
    excess: medicine.excess ? 1 : 0,
    reorderLevel: Number.isFinite(medicine.reorderLevel) ? medicine.reorderLevel : null
  };
}

function normalizeRequest(row) {
  if (!row) return null;
  let declinedBy = [];
  try {
    const raw = row.declinedby || row.declinedBy;
    declinedBy = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : [];
  } catch {
    declinedBy = [];
  }
  return {
    id: row.id,
    barcode: row.barcode,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    fromHospital: row.fromhospital || row.fromHospital,
    targetHospital: row.targethospital || row.targetHospital,
    status: row.status,
    direction: row.direction,
    requestedAt: row.requestedat || row.requestedAt,
    declineReason: row.declinereason || row.declineReason,
    declinedBy
  };
}

async function selectAll(sql, params = []) {
  const result = await pool.query(processSql(sql), params);
  return result.rows;
}

async function selectOne(sql, params = []) {
  const result = await pool.query(processSql(sql), params);
  return result.rows.length ? result.rows[0] : null;
}

async function run(sql, params = []) {
  await pool.query(processSql(sql), params);
}

export async function listMedicines() {
  const rows = await selectAll("SELECT * FROM medicines ORDER BY name ASC");
  return rows.map(normalizeMedicine);
}

export async function getMedicineByBarcode(barcode) {
  const row = await selectOne("SELECT * FROM medicines WHERE barcode = ?", [barcode]);
  return row ? normalizeMedicine(row) : null;
}

export async function getMedicineByBarcodeAndHospital(barcode, hospital) {
  const row = await selectOne("SELECT * FROM medicines WHERE barcode = ? AND hospital = ?", [barcode, hospital]);
  return row ? normalizeMedicine(row) : null;
}

export async function createMedicine(medicine) {
  const payload = serializeMedicine(medicine);
  await run(
    `INSERT INTO medicines (
      barcode, name, batch, manufacturer, category, quantity, unit, expiry, manufacturingDate,
      hospital, price, status, excess, reorderLevel
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.barcode,
      payload.name,
      payload.batch,
      payload.manufacturer,
      payload.category,
      payload.quantity,
      payload.unit,
      payload.expiry,
      payload.manufacturingDate,
      payload.hospital,
      payload.price,
      payload.status,
      payload.excess,
      payload.reorderLevel
    ]
  );
  return getMedicineByBarcodeAndHospital(medicine.barcode, medicine.hospital);
}

export async function updateMedicine(barcode, medicine, originalHospital) {
  const payload = serializeMedicine({ ...medicine, barcode });
  const lookupHospital = originalHospital || payload.hospital;
  await run(
    `UPDATE medicines SET
      name = ?,
      batch = ?,
      manufacturer = ?,
      category = ?,
      quantity = ?,
      unit = ?,
      expiry = ?,
      manufacturingDate = ?,
      hospital = ?,
      price = ?,
      status = ?,
      excess = ?,
      reorderLevel = ?
    WHERE barcode = ? AND hospital = ?`,
    [
      payload.name,
      payload.batch,
      payload.manufacturer,
      payload.category,
      payload.quantity,
      payload.unit,
      payload.expiry,
      payload.manufacturingDate,
      payload.hospital,
      payload.price,
      payload.status,
      payload.excess,
      payload.reorderLevel,
      payload.barcode,
      lookupHospital
    ]
  );
  return getMedicineByBarcodeAndHospital(payload.barcode, payload.hospital);
}

export async function updateMedicineForHospital(barcode, hospital, updates) {
  const current = await getMedicineByBarcodeAndHospital(barcode, hospital);
  if (!current) return null;
  const next = { ...current, ...updates, barcode, hospital };
  const payload = serializeMedicine(next);
  await run(
    `UPDATE medicines SET
      name = ?,
      batch = ?,
      manufacturer = ?,
      category = ?,
      quantity = ?,
      unit = ?,
      expiry = ?,
      manufacturingDate = ?,
      hospital = ?,
      price = ?,
      status = ?,
      excess = ?,
      reorderLevel = ?
    WHERE barcode = ? AND hospital = ?`,
    [
      payload.name,
      payload.batch,
      payload.manufacturer,
      payload.category,
      payload.quantity,
      payload.unit,
      payload.expiry,
      payload.manufacturingDate,
      payload.hospital,
      payload.price,
      payload.status,
      payload.excess,
      payload.reorderLevel,
      payload.barcode,
      payload.hospital
    ]
  );
  return getMedicineByBarcodeAndHospital(barcode, hospital);
}

export async function deleteMedicine(barcode) {
  await run("DELETE FROM medicines WHERE barcode = ?", [barcode]);
}

export async function deleteMedicineForHospital(barcode, hospital) {
  await run("DELETE FROM medicines WHERE barcode = ? AND hospital = ?", [barcode, hospital]);
}

export async function replaceMedicines(medicines) {
  await run("BEGIN");
  try {
    await run("DELETE FROM medicines");
    for (const medicine of medicines) {
      const payload = serializeMedicine(medicine);
      await run(
        `INSERT INTO medicines (
          barcode, name, batch, manufacturer, category, quantity, unit, expiry, manufacturingDate,
          hospital, price, status, excess, reorderLevel
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          payload.barcode,
          payload.name,
          payload.batch,
          payload.manufacturer,
          payload.category,
          payload.quantity,
          payload.unit,
          payload.expiry,
          payload.manufacturingDate,
          payload.hospital,
          payload.price,
          payload.status,
          payload.excess,
          payload.reorderLevel
        ]
      );
    }
    await run("COMMIT");
  } catch (error) {
    await run("ROLLBACK");
    throw error;
  }
}

export async function listExchangeRequests() {
  const rows = await selectAll("SELECT * FROM exchange_requests ORDER BY requestedAt DESC");
  return rows.map(normalizeRequest);
}

export async function getExchangeRequest(id) {
  const row = await selectOne("SELECT * FROM exchange_requests WHERE id = ?", [id]);
  return row ? normalizeRequest(row) : null;
}

export async function createExchangeRequest(request) {
  await run(
    `INSERT INTO exchange_requests (
      id, barcode, name, quantity, unit, fromHospital, targetHospital, status,
      direction, requestedAt, declineReason, declinedBy
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      request.id,
      request.barcode,
      request.name,
      request.quantity,
      request.unit,
      request.fromHospital,
      request.targetHospital,
      request.status,
      request.direction,
      request.requestedAt,
      request.declineReason || "",
      JSON.stringify(request.declinedBy || [])
    ]
  );
  return getExchangeRequest(request.id);
}

export async function fulfillExchangeRequest(id, decision, actorHospital) {
  const current = await getExchangeRequest(id);
  if (!current) return { ok: false, error: "Exchange request not found." };
  if (current.status !== "Pending") {
    return { ok: false, error: "Request already processed." };
  }

  if (decision.status === "Declined") {
    const declinedBy = new Set(current.declinedBy || []);
    if (actorHospital) {
      declinedBy.add(actorHospital);
    }
    const shouldFinalize = current.targetHospital !== "Any" && current.targetHospital === actorHospital;
    const updated = await updateExchangeRequest(id, {
      status: shouldFinalize ? "Declined" : "Pending",
      declineReason: shouldFinalize ? decision.declineReason || "" : current.declineReason || "",
      declinedBy: Array.from(declinedBy)
    });
    return { ok: true, request: updated };
  }

  if (decision.status !== "Accepted") {
    return { ok: false, error: "Invalid decision." };
  }

  const offerHospital = actorHospital || current.targetHospital;
  if (!offerHospital) {
    return { ok: false, error: "No hospital selected to fulfill the request." };
  }
  const updated = await updateExchangeRequest(id, {
    status: "Accepted",
    declineReason: "",
    targetHospital: offerHospital,
    declinedBy: []
  });
  return { ok: true, request: updated };
}

export async function updateExchangeRequest(id, updates) {
  const current = await getExchangeRequest(id);
  if (!current) return null;
  await run(
    "UPDATE exchange_requests SET status = ?, declineReason = ?, declinedBy = ?, targetHospital = ? WHERE id = ?",
    [
      updates.status ?? current.status,
      updates.declineReason ?? current.declineReason ?? "",
      JSON.stringify(updates.declinedBy ?? current.declinedBy ?? []),
      updates.targetHospital ?? current.targetHospital,
      id
    ]
  );
  return getExchangeRequest(id);
}

export async function replaceExchangeRequests(requests) {
  await run("BEGIN");
  try {
    await run("DELETE FROM exchange_requests");
    for (const request of requests) {
      await run(
        `INSERT INTO exchange_requests (
          id, barcode, name, quantity, unit, fromHospital, targetHospital, status,
          direction, requestedAt, declineReason, declinedBy
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          request.id,
          request.barcode,
          request.name,
          request.quantity,
          request.unit,
          request.fromHospital,
          request.targetHospital,
          request.status,
          request.direction,
          request.requestedAt,
          request.declineReason || "",
          JSON.stringify(request.declinedBy || [])
        ]
      );
    }
    await run("COMMIT");
  } catch (error) {
    await run("ROLLBACK");
    throw error;
  }
}

export async function countMedicines() {
  const row = await selectOne("SELECT COUNT(1) as count FROM medicines");
  return row ? parseInt(row.count, 10) : 0;
}

export async function countExchangeRequests() {
  const row = await selectOne("SELECT COUNT(1) as count FROM exchange_requests");
  return row ? parseInt(row.count, 10) : 0;
}

export async function getUserByEmail(email) {
  return selectOne("SELECT * FROM users WHERE email = ?", [email]);
}

export async function ensureUser(user) {
  const existing = await getUserByEmail(user.email);
  if (!existing) {
    await run("INSERT INTO users (name, email, password, role, hospital) VALUES (?, ?, ?, ?, ?)", [
      user.name,
      user.email,
      user.password,
      user.role,
      user.hospital || ""
    ]);
    return getUserByEmail(user.email);
  }
  if (!existing.hospital && user.hospital) {
    await run("UPDATE users SET hospital = ? WHERE email = ?", [user.hospital, user.email]);
    return getUserByEmail(user.email);
  }
  return existing;
}

export async function createSession(session) {
  await run("INSERT INTO sessions (id, email, name, role, hospital, createdAt) VALUES (?, ?, ?, ?, ?, ?)", [
    session.id,
    session.email,
    session.name,
    session.role,
    session.hospital,
    session.createdAt
  ]);
  return session;
}

export async function getSession(sessionId) {
  return selectOne("SELECT * FROM sessions WHERE id = ?", [sessionId]);
}

export async function deleteSession(sessionId) {
  await run("DELETE FROM sessions WHERE id = ?", [sessionId]);
}

export async function clearSessions() {
  await run("DELETE FROM sessions");
}
