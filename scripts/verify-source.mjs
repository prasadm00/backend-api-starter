// No-runtime-dependency source smoke check. NOT a substitute for npm test/typecheck.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
const root = process.cwd();
function files(folder) {
  return readdirSync(folder).flatMap(name => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
const source = files(join(root, 'src')).filter(p => /\.ts$/.test(p));
let errors = 0;
for (const path of source) {
  const text = readFileSync(path, 'utf8');
  const imports = text.matchAll(/(?:from\s*|import\s*\(\s*)['"](\.{1,2}\/[^'"\s]+)['"]/g);
  for (const match of imports) {
    const specifier = match[1];
    const target = resolve(dirname(path), specifier.replace(/\.js$/, '.ts'));
    if (!existsSync(target)) { console.error('Missing relative import:', path, specifier); errors++; }
  }
}
function mustContain(path, needle) {
  const full = join(root, path);
  if (!existsSync(full) || !readFileSync(full, 'utf8').includes(needle)) {
    console.error('Missing invariant:', path, needle); errors++;
  }
}
mustContain('src/modules/payments/stripe.service.ts', 'constructEvent(rawBody, signature');
mustContain('src/modules/payments/payment.repository.ts', 'stripeSessionId: params.stripeSessionId');
mustContain('src/modules/auth/auth.repository.ts', 'revokedAt: null, expiresAt: { gt: now }');
mustContain('src/modules/auth/google.service.ts', 'jwt.verify(idToken, publicKey');
mustContain('src/modules/orders/order.repository.ts', 'availableQuantity: { gte: item.quantity }');
mustContain('src/common/queue/outbox.service.ts', 'flushOutboxBatch');
mustContain('Dockerfile', 'npm run build');
mustContain('.github/workflows/ci.yml', 'npm run typecheck');
if (errors) process.exit(1);
console.log(`Source smoke checks passed (${source.length} TypeScript files, imports and high-risk invariants).`);
