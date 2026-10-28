// Gera o valor de "admin_hash" (senha do painel) para salvar na tabela tombo_seguranca.
// Uso: node scripts/gerar-senha-painel.mjs "SuaSenhaForte123"
import { pbkdf2Sync, randomBytes } from "node:crypto";
const senha = process.argv[2];
if (!senha || senha.length < 10) { console.error("Informe uma senha com 10+ caracteres."); process.exit(1); }
const salt = randomBytes(16);
const h = pbkdf2Sync(senha, salt, 100000, 32, "sha256").toString("hex");
const valor = `pbkdf2$100000$${salt.toString("hex")}$${h}`;
console.log(valor);
console.log(`\nSQL:\ninsert into public.tombo_seguranca (chave, valor) values ('admin_hash', '${valor}')\n  on conflict (chave) do update set valor = excluded.valor;`);
