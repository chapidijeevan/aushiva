import { createClient } from "@supabase/supabase-js";

let supabase;

export async function initDb() {
  if (supabase) return;
  
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    console.warn("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set. The database connection will fail if queried.");
    return;
  }
  
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log("Supabase HTTPS Client initialized.");
}

function normalizeMedicine(row) {
  if (!row) return null;
  // Supabase returns fields in the exact casing they are in the table.
  // We handle both just in case a manual migration changed casing.
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
    reorderLevel: row.reorderLevel !== undefined && row.reorderLevel !== null 
                  ? row.reorderLevel 
                  : (row.reorderlevel === null ? undefined : row.reorderlevel)
  };
}

function serializeMedicine(medicine) {
  return {
    barcode: medicine.barcode,
    name: medicine.name,
    batch: medicine.batch,
    manufacturer: medicine.manufacturer,
    category: medicine.category,
    quantity: medicine.quantity,
    unit: medicine.unit,
    expiry: medicine.expiry,
    manufacturingdate: medicine.manufacturingDate || medicine.manufacturingdate,
    hospital: medicine.hospital,
    price: medicine.price,
    status: medicine.status,
    excess: Boolean(medicine.excess),
    reorderlevel: Number.isFinite(medicine.reorderLevel) ? medicine.reorderLevel : (Number.isFinite(medicine.reorderlevel) ? medicine.reorderlevel : null)
  };
}

function normalizeRequest(row) {
  if (!row) return null;
  let declinedBy = [];
  try {
    const raw = row.declinedBy || row.declinedby;
    declinedBy = raw ? (Array.isArray(raw) ? raw : JSON.parse(raw)) : [];
  } catch {
    declinedBy = [];
  }
  return {
    id: row.id,
    barcode: row.barcode,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    fromHospital: row.fromHospital || row.fromhospital,
    targetHospital: row.targetHospital || row.targethospital,
    status: row.status,
    direction: row.direction,
    requestedAt: row.requestedAt || row.requestedat,
    declineReason: row.declineReason || row.declinereason,
    declinedBy
  };
}

export async function listMedicines() {
  const { data, error } = await supabase.from("medicines").select("*").order("name", { ascending: true });
  if (error) throw error;
  return data.map(normalizeMedicine);
}

export async function getMedicineByBarcode(barcode) {
  const { data, error } = await supabase.from("medicines").select("*").eq("barcode", barcode).single();
  if (error && error.code !== "PGRST116") throw error; // PGRST116 is no rows found
  return data ? normalizeMedicine(data) : null;
}

export async function getMedicineByBarcodeAndHospital(barcode, hospital) {
  const { data, error } = await supabase.from("medicines").select("*").eq("barcode", barcode).eq("hospital", hospital).single();
  if (error && error.code !== "PGRST116") throw error;
  return data ? normalizeMedicine(data) : null;
}

export async function createMedicine(medicine) {
  const payload = serializeMedicine(medicine);
  const { data, error } = await supabase.from("medicines").insert(payload).select().single();
  if (error) throw error;
  return normalizeMedicine(data);
}

export async function updateMedicine(barcode, medicine, originalHospital) {
  const payload = serializeMedicine({ ...medicine, barcode });
  const lookupHospital = originalHospital || payload.hospital;
  const { data, error } = await supabase
    .from("medicines")
    .update(payload)
    .eq("barcode", barcode)
    .eq("hospital", lookupHospital)
    .select()
    .single();
  if (error) throw error;
  return normalizeMedicine(data);
}

export async function updateMedicineForHospital(barcode, hospital, updates) {
  const { data, error } = await supabase
    .from("medicines")
    .update(serializeMedicine(updates))
    .eq("barcode", barcode)
    .eq("hospital", hospital)
    .select()
    .single();
  if (error) throw error;
  return normalizeMedicine(data);
}

export async function deleteMedicine(barcode) {
  const { error } = await supabase.from("medicines").delete().eq("barcode", barcode);
  if (error) throw error;
}

export async function deleteMedicineForHospital(barcode, hospital) {
  const { error } = await supabase.from("medicines").delete().eq("barcode", barcode).eq("hospital", hospital);
  if (error) throw error;
}

export async function replaceMedicines(medicines) {
  // Supabase doesn't support easy TRUNCATE via REST, but we can delete all.
  const { error: deleteError } = await supabase.from("medicines").delete().neq("barcode", "placeholder_impossible");
  if (deleteError) throw deleteError;
  
  if (medicines.length > 0) {
    const payloads = medicines.map(serializeMedicine);
    const { error: insertError } = await supabase.from("medicines").insert(payloads);
    if (insertError) throw insertError;
  }
}

export async function listExchangeRequests() {
  const { data, error } = await supabase.from("exchange_requests").select("*").order("requestedAt", { ascending: false });
  if (error) throw error;
  return data.map(normalizeRequest);
}

export async function getExchangeRequest(id) {
  const { data, error } = await supabase.from("exchange_requests").select("*").eq("id", id).single();
  if (error && error.code !== "PGRST116") throw error;
  return data ? normalizeRequest(data) : null;
}

export async function createExchangeRequest(request) {
  const payload = {
    id: request.id,
    barcode: request.barcode,
    name: request.name,
    quantity: request.quantity,
    unit: request.unit,
    fromhospital: request.fromHospital || request.fromhospital,
    targethospital: request.targetHospital || request.targethospital,
    status: request.status,
    direction: request.direction,
    requestedat: request.requestedAt || request.requestedat,
    declinereason: request.declineReason || request.declinereason || "",
    declinedby: request.declinedBy || request.declinedby || []
  };
  const { data, error } = await supabase.from("exchange_requests").insert(payload).select().single();
  if (error) throw error;
  return normalizeRequest(data);
}

export async function fulfillExchangeRequest(id, decision, actorHospital) {
  const current = await getExchangeRequest(id);
  if (!current) return { ok: false, error: "Exchange request not found." };
  if (current.status !== "Pending") {
    return { ok: false, error: "Request already processed." };
  }

  if (decision.status === "Declined") {
    const declinedBy = new Set(current.declinedBy || []);
    if (actorHospital) declinedBy.add(actorHospital);
    
    const shouldFinalize = current.targetHospital !== "Any" && current.targetHospital === actorHospital;
    const updated = await updateExchangeRequest(id, {
      status: shouldFinalize ? "Declined" : "Pending",
      declineReason: shouldFinalize ? decision.declineReason || "" : current.declineReason || "",
      declinedBy: Array.from(declinedBy)
    });
    return { ok: true, request: updated };
  }

  if (decision.status !== "Accepted") return { ok: false, error: "Invalid decision." };

  const offerHospital = actorHospital || current.targetHospital;
  if (!offerHospital) return { ok: false, error: "No hospital selected to fulfill the request." };
  
  const updated = await updateExchangeRequest(id, {
    status: "Accepted",
    declineReason: "",
    targetHospital: offerHospital,
    declinedBy: []
  });
  return { ok: true, request: updated };
}

export async function updateExchangeRequest(id, updates) {
  const payload = {};
  if (updates.status !== undefined) payload.status = updates.status;
  if (updates.declineReason !== undefined) payload.declinereason = updates.declineReason;
  if (updates.declinedBy !== undefined) payload.declinedby = updates.declinedBy;
  if (updates.targetHospital !== undefined) payload.targethospital = updates.targetHospital;

  const { data, error } = await supabase
    .from("exchange_requests")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return normalizeRequest(data);
}

export async function replaceExchangeRequests(requests) {
  const { error: deleteError } = await supabase.from("exchange_requests").delete().neq("id", "placeholder_impossible");
  if (deleteError) throw deleteError;
  
  if (requests.length > 0) {
    const payloads = requests.map(req => ({
      id: req.id,
      barcode: req.barcode,
      name: req.name,
      quantity: req.quantity,
      unit: req.unit,
      fromhospital: req.fromHospital || req.fromhospital,
      targethospital: req.targetHospital || req.targethospital,
      status: req.status,
      direction: req.direction,
      requestedat: req.requestedAt || req.requestedat,
      declinereason: req.declineReason || req.declinereason || "",
      declinedby: req.declinedBy || req.declinedby || []
    }));
    const { error: insertError } = await supabase.from("exchange_requests").insert(payloads);
    if (insertError) throw insertError;
  }
}

export async function countMedicines() {
  const { count, error } = await supabase.from("medicines").select("*", { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}

export async function countExchangeRequests() {
  const { count, error } = await supabase.from("exchange_requests").select("*", { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}

export async function getUserByEmail(email) {
  const { data, error } = await supabase.from("users").select("*").eq("email", email).single();
  if (error && error.code !== "PGRST116") throw error;
  return data || null;
}

export async function ensureUser(user) {
  const existing = await getUserByEmail(user.email);
  if (!existing) {
    const { data, error } = await supabase.from("users").insert(user).select().single();
    if (error) throw error;
    return data;
  }
  if (!existing.hospital && user.hospital) {
    const { data, error } = await supabase.from("users").update({ hospital: user.hospital }).eq("email", user.email).select().single();
    if (error) throw error;
    return data;
  }
  return existing;
}

export async function createSession(session) {
  const { data, error } = await supabase.from("sessions").insert(session).select().single();
  if (error) throw error;
  return data;
}

export async function getSession(sessionId) {
  const { data, error } = await supabase.from("sessions").select("*").eq("id", sessionId).single();
  if (error && error.code !== "PGRST116") throw error;
  return data || null;
}

export async function deleteSession(sessionId) {
  const { error } = await supabase.from("sessions").delete().eq("id", sessionId);
  if (error) throw error;
}

export async function clearSessions() {
  const { error } = await supabase.from("sessions").delete().neq("id", "placeholder_impossible");
  if (error) throw error;
}
