import crypto from "crypto";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import express from "express";
import {
  clearSessions,
  createExchangeRequest,
  createMedicine,
  createSession,
  deleteMedicineForHospital,
  deleteSession,
  getExchangeRequest,
  getMedicineByBarcodeAndHospital,
  getSession,
  getUserByEmail,
  fulfillExchangeRequest,
  ensureUser,
  initDb,
  listExchangeRequests,
  listMedicines,
  replaceExchangeRequests,
  replaceMedicines,
  updateExchangeRequest,
  updateMedicine
} from "./db.js";
import { seedIfEmpty } from "./seed.js";

dotenv.config();

const app = express();

app.use(cors({ origin: "http://localhost:5173", credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.post("/api/bootstrap", async (req, res) => {
  await seedIfEmpty();
  res.status(200).json({ ok: true });
});

app.get("/api/medicines", async (req, res) => {
  await seedIfEmpty();
  res.status(200).json(await listMedicines());
});

app.post("/api/medicines", async (req, res) => {
  const medicine = req.body?.medicine || req.body;
  if (!medicine || !medicine.barcode || !medicine.hospital) {
    res.status(400).json({ error: "Medicine payload with barcode and hospital is required." });
    return;
  }
  const existing = await getMedicineByBarcodeAndHospital(medicine.barcode, medicine.hospital);
  if (existing) {
    res.status(409).json({ error: "Medicine with this barcode already exists." });
    return;
  }
  const created = await createMedicine(medicine);
  res.status(201).json(created);
});

app.put("/api/medicines", async (req, res) => {
  const medicines = req.body?.medicines;
  if (!Array.isArray(medicines)) {
    res.status(400).json({ error: "Medicines array is required." });
    return;
  }
  await replaceMedicines(medicines);
  res.status(200).json(await listMedicines());
});

app.put("/api/medicines/:barcode", async (req, res) => {
  const { barcode } = req.params;
  const medicine = req.body?.medicine || req.body;
  const hospital = medicine?.hospital;
  const originalHospital = medicine?.originalHospital || hospital;
  if (!hospital || !originalHospital) {
    res.status(400).json({ error: "Hospital is required to update a medicine." });
    return;
  }
  const existing = await getMedicineByBarcodeAndHospital(barcode, originalHospital);
  if (!existing) {
    res.status(404).json({ error: "Medicine not found." });
    return;
  }
  if (medicine.hospital !== originalHospital) {
    const conflict = await getMedicineByBarcodeAndHospital(barcode, medicine.hospital);
    if (conflict) {
      res.status(409).json({ error: "Medicine with this barcode already exists for the selected hospital." });
      return;
    }
  }
  const updated = await updateMedicine(barcode, medicine, originalHospital);
  res.status(200).json(updated);
});

app.delete("/api/medicines/:barcode", async (req, res) => {
  const { barcode } = req.params;
  const hospital = req.query?.hospital;
  if (!hospital) {
    res.status(400).json({ error: "Hospital is required to delete a medicine." });
    return;
  }
  const existing = await getMedicineByBarcodeAndHospital(barcode, hospital);
  if (!existing) {
    res.status(404).json({ error: "Medicine not found." });
    return;
  }
  await deleteMedicineForHospital(barcode, hospital);
  res.status(204).end();
});

app.get("/api/exchange-requests", async (req, res) => {
  await seedIfEmpty();
  res.status(200).json(await listExchangeRequests());
});

app.post("/api/exchange-requests", async (req, res) => {
  const request = req.body?.request || req.body;
  if (!request) {
    res.status(400).json({ error: "Exchange request payload is required." });
    return;
  }
  const id = request.id || `req-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const created = await createExchangeRequest({ ...request, id });
  res.status(201).json(created);
});

app.put("/api/exchange-requests", async (req, res) => {
  const requests = req.body?.requests;
  if (!Array.isArray(requests)) {
    res.status(400).json({ error: "Exchange requests array is required." });
    return;
  }
  await replaceExchangeRequests(requests);
  res.status(200).json(await listExchangeRequests());
});

app.put("/api/exchange-requests/:id", async (req, res) => {
  const { id } = req.params;
  if (!(await getExchangeRequest(id))) {
    res.status(404).json({ error: "Exchange request not found." });
    return;
  }
  const updated = await updateExchangeRequest(id, req.body || {});
  res.status(200).json(updated);
});

app.post("/api/exchange-requests/:id/decision", async (req, res) => {
  const { id } = req.params;
  const { status, declineReason, hospital } = req.body || {};
  const result = await fulfillExchangeRequest(id, { status, declineReason }, hospital);
  if (!result.ok) {
    res.status(400).json({ ok: false, message: result.error });
    return;
  }
  res.status(200).json({
    ok: true,
    request: result.request,
    medicines: await listMedicines(),
    requests: await listExchangeRequests()
  });
});

app.post("/api/login", async (req, res) => {
  await seedIfEmpty();
  const { email, password } = req.body || {};
  const user = email ? await getUserByEmail(email) : null;
  if (!user || user.password !== password) {
    res.status(401).json({ ok: false, message: "Invalid email or password" });
    return;
  }

  const session = {
    id: crypto.randomUUID(),
    email: user.email,
    name: user.name,
    role: user.role,
    hospital: user.hospital || "",
    createdAt: new Date().toISOString()
  };
  await createSession(session);
  res.cookie("aushiva_session", session.id, { httpOnly: true, sameSite: "lax" });
  res.status(200).json({ ok: true, session: { email: user.email, name: user.name, role: user.role, hospital: user.hospital || "" } });
});

app.post("/api/signup", async (req, res) => {
  await seedIfEmpty();
  const { name, email, password, hospital } = req.body || {};
  if (!name || !email || !password || !hospital) {
    res.status(400).json({ ok: false, message: "Name, email, password, and hospital are required." });
    return;
  }
  const existing = await getUserByEmail(email);
  if (existing) {
    res.status(409).json({ ok: false, message: "An account with this email already exists." });
    return;
  }
  const user = await ensureUser({ name, email, password, role: "Inventory Manager", hospital });
  const session = {
    id: crypto.randomUUID(),
    email: user.email,
    name: user.name,
    role: user.role,
    hospital: user.hospital || hospital,
    createdAt: new Date().toISOString()
  };
  await createSession(session);
  res.cookie("aushiva_session", session.id, { httpOnly: true, sameSite: "lax" });
  res.status(201).json({ ok: true, session: { email: user.email, name: user.name, role: user.role, hospital: user.hospital || hospital } });
});

app.post("/api/logout", async (req, res) => {
  const sessionId = req.cookies?.aushiva_session;
  if (sessionId) {
    await deleteSession(sessionId);
  }
  res.clearCookie("aushiva_session");
  res.status(200).json({ ok: true });
});

app.get("/api/session", async (req, res) => {
  const sessionId = req.cookies?.aushiva_session;
  if (!sessionId) {
    res.status(200).json(null);
    return;
  }
  const session = await getSession(sessionId);
  if (!session) {
    res.clearCookie("aushiva_session");
    res.status(200).json(null);
    return;
  }
  res.status(200).json({ email: session.email, name: session.name, role: session.role, hospital: session.hospital || "" });
});

import path from "path";

app.use(express.static(path.join(process.cwd(), "../dist")));

app.get("*", (req, res) => {
  res.sendFile(path.join(process.cwd(), "../dist", "index.html"));
});

const PORT = process.env.PORT || 5050;

await initDb();

app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});