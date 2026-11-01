/** Credentials use only Web Crypto, available in Workers and current Node runtimes. */
export class ApiError extends Error {
  status:number;
  constructor(status:number, message:string) { super(message); this.name = 'ApiError'; this.status = status; }
}

const ITERATIONS = 100_000;
const encoder = new TextEncoder();
export const SESSION_SECONDS = 60 * 60 * 24 * 30;
export const SESSION_COOKIE = 'kittakat_session';

function hex(bytes:Uint8Array):string { return Array.from(bytes, n => n.toString(16).padStart(2, '0')).join(''); }
function unhex(value:string):Uint8Array<ArrayBuffer> { return Uint8Array.from(value.match(/.{2}/g) ?? [], x => parseInt(x, 16)); }

export function randomToken(bytes = 32):string {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = '';
  for (const value of values) binary += String.fromCharCode(value);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export async function hashToken(value:string):Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

export function normalizeUsername(input:unknown):string {
  if (typeof input !== 'string') throw new ApiError(400, 'Enter a username.');
  const value = input.normalize('NFKC').trim().toLowerCase();
  const length = Array.from(value).length;
  if (length < 3 || length > 32 || !/^[\p{L}\p{M}\p{N}_.-]+$/u.test(value) || !/[\p{L}\p{N}]/u.test(value)) {
    throw new ApiError(400, 'Username must contain 3–32 letters, numbers, dots, underscores or hyphens.');
  }
  return value;
}

export function validatePassword(password:unknown):asserts password is string {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw new ApiError(400, 'Password must contain 8–128 characters.');
}

export async function hashPassword(password:string):Promise<string> {
  validatePassword(password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits({ name:'PBKDF2', hash:'SHA-256', salt, iterations:ITERATIONS }, key, 256);
  return `pbkdf2-sha256$${ITERATIONS}$${hex(salt)}$${hex(new Uint8Array(derived))}`;
}

export async function verifyPassword(password:string, stored:string):Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256' || parts[1] !== String(ITERATIONS) || !/^[a-f0-9]{32}$/.test(parts[2]) || !/^[a-f0-9]{64}$/.test(parts[3])) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name:'PBKDF2', hash:'SHA-256', salt:unhex(parts[2]), iterations:ITERATIONS }, key, 256);
  const expected = unhex(parts[3]);
  const actual = new Uint8Array(bits);
  let difference = expected.length ^ actual.length;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ expected[i];
  return difference === 0;
}

export function sessionCookie(token:string, secure:boolean, clear=false):string {
  return `${SESSION_COOKIE}=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : SESSION_SECONDS}${secure ? '; Secure' : ''}`;
}

export function readSessionToken(request:Request):string|null {
  const cookie = request.headers.get('cookie') ?? '';
  const value = cookie.split(';').map(x => x.trim()).find(x => x.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

export function assertSameOrigin(request:Request):void {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new ApiError(403, 'This request must come from the same site.');
  }
}

/** The selected header must be overwritten by the trusted hosting proxy. */
export function readClientIp(request:Request, headerName='cf-connecting-ip'):string {
  const value=request.headers.get(headerName)?.trim();
  return value && value.length<=45 && /^[0-9a-fA-F:.]+$/.test(value) ? value : 'local';
}
