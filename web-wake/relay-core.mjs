import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const VALID_ROLE = /^web-[a-z0-9][a-z0-9_.-]{0,58}$/;
// Durable handoffs must survive an overnight/offline browser. Expired Web
// identity leases are filtered separately; an ACK is still authoritative.
export const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const tokenHash = value => createHash('sha256').update(value).digest('hex');
const tokenPath = stateDir => join(stateDir, 'tips', 'web-wake-token.json');

export function createWakeToken(stateDir) {
  const file = tokenPath(stateDir);
  mkdirSync(join(stateDir, 'tips'), {recursive:true,mode:0o700});
  if (existsSync(file)) throw Error('Wake token already exists. Refusing to overwrite it.');
  const token = randomBytes(32).toString('base64url');
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({sha256:tokenHash(token)},null,2)+'\n', {mode:0o600,flag:'wx'});
  renameSync(tmp,file);
  return token;
}

export function verifyWakeToken(stateDir, input, {configDir}={}) {
  if (typeof input !== 'string' || input.length===0) return false;
  // New installations keep the plaintext token next to Tips/admin credentials.
  // If explicitly configured, it is authoritative: changing it immediately
  // revokes the old hashed token rather than secretly leaving two valid keys.
  if (configDir) {
    const file=join(configDir,'security.json');
    if (existsSync(file)) {
      const security=JSON.parse(readFileSync(file,'utf8'));
      if (Object.hasOwn(security,'webWakeToken')) {
        const expected=security.webWakeToken;
        if (typeof expected!=='string'||!expected.length)return false;
        const a=Buffer.from(tokenHash(input),'hex');
        const b=Buffer.from(tokenHash(expected),'hex');
        return timingSafeEqual(a,b);
      }
    }
  }
  // Legacy read-only fallback for upgrades that have not configured the new
  // field yet. Never attempt to recover plaintext from a SHA256 hash.
  if (!existsSync(tokenPath(stateDir))) return false;
  const expected = JSON.parse(readFileSync(tokenPath(stateDir),'utf8')).sha256;
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) return false;
  const got = Buffer.from(tokenHash(input),'hex');
  return timingSafeEqual(got,Buffer.from(expected,'hex'));
}

// All events are routing metadata only: NEVER expose message bodies or bearer tokens.
export function collectWakeEvents({roles,messages,now=Date.now(),maxAgeMs=DEFAULT_MAX_AGE_MS}) {
  const valid = new Set(roles.filter(role => role.status === 'claimed' &&
    VALID_ROLE.test(role.id) && Date.parse(role.leaseExpiresAt) > now).map(role => role.id));
  const unique = new Set();
  return messages.filter(msg => {
    if (!msg || !valid.has(msg.to) || !['unread','delivered'].includes(msg.status) || unique.has(msg.id)) return false;
    if (typeof msg.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(msg.id)) return false;
    const when = Date.parse(msg.at);
    if (!Number.isFinite(when) || when > now + 60_000 || now-when > maxAgeMs) return false;
    unique.add(msg.id);
    return true;
  }).map(({id,to}) => ({id,to}));
}

/** Explicit MCP ACK routing metadata; disappearance from the pending snapshot
 * alone must NEVER be interpreted as ACK (lease expiry/retention can also
 * remove a message from the snapshot). No message body is transmitted. */
export function collectWakeAcknowledgements({roles,messages,now=Date.now(),maxAgeMs=DEFAULT_MAX_AGE_MS}) {
  const valid=new Set(roles.filter(role=>role.status==='claimed'&&
    VALID_ROLE.test(role.id)&&Date.parse(role.leaseExpiresAt)>now).map(role=>role.id));
  const unique=new Set();
  return messages.filter(msg=>{
    if(!msg||!valid.has(msg.to)||!msg.ackBy||unique.has(msg.id))return false;
    if(typeof msg.id!=='string'||!/^[a-f0-9-]{36}$/i.test(msg.id))return false;
    const when=Date.parse(msg.at);
    if(!Number.isFinite(when)||when>now+60_000||now-when>maxAgeMs)return false;
    unique.add(msg.id);return true;
  }).map(({id,to})=>({id,to}));
}

export function allowSocketOrigin(origin) {
  // Only our local Chrome/Edge extension can open a browser-origin connection.
  // This is defense in depth; the random pairing token is still mandatory.
  return typeof origin === 'string' && /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
}
