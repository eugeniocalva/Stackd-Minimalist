/* Transcription jobs in KV (architecture §20): the app gets a job id back
   from /v1/transcribe and polls /v1/transcribe/:id; the row remembers who
   owns the job, what was reserved from their pool and the provider's own
   id. Rows expire after a day. */

const TTL = 86400;
export const jobKey = (id) => `job:${id}`;

export const newJobId = () => `job_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export async function createJob(kv, { subscriberId, tier, periodKey, reservedSeconds, providerName, providerId }) {
  const id = newJobId();
  const row = { id, subscriberId, tier, periodKey, reservedSeconds, providerName, providerId, state: 'queued', createdAt: Date.now(), result: null, code: null };
  await kv.put(jobKey(id), JSON.stringify(row), { expirationTtl: TTL });
  return row;
}

export async function getJob(kv, id) {
  const raw = await kv.get(jobKey(id));
  return raw ? JSON.parse(raw) : null;
}

export async function updateJob(kv, row) {
  await kv.put(jobKey(row.id), JSON.stringify(row), { expirationTtl: TTL });
  return row;
}
