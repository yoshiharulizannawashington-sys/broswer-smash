// Shared HTTP helper for the model providers.
export const UA = 'BrowserBros/1.0 (character import; +https://github.com/yoshiharulizannawashington-sys/broswer-smash)';

export async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers } });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`${response.status} ${text.slice(0, 180)}`);
    error.status = response.status;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new Error(`expected JSON from ${url}, got ${text.slice(0, 120)}`);
  }
}

export async function getBuffer(url, headers = {}) {
  const response = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, redirect: 'follow' });
  if (!response.ok) throw new Error(`download refused by ${new URL(url).host} (HTTP ${response.status})`);
  return { buffer: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') || '' };
}

export const clean = value => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value);
