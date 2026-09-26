#!/usr/bin/env node
// dsh-ssh-remote — SSH_ASKPASS 助手。
// ssh 在需要密码时以提示词为唯一参数调用本程序；本程序从提示词解析连接身份
// （形如 `user@host's password:`），在加密凭据库里解出密码并写到 stdout（仅一行，
// 不带任何其它输出）。任何失败都静默退出非 0 —— 配合 SSH_ASKPASS_REQUIRE=force，
// ssh 不会退化成挂死的终端提示，而是直接认证失败。
//
// 用法：askpass.js --file <credentials.enc> --key <credentials.key> <提示词>
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CredentialStore, identityOf } from './credentials.js'

function fail() { process.exit(1) }

const argv = process.argv.slice(2)
let file = null
let key = null
let prompt = null
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--file') file = argv[++i]
  else if (argv[i] === '--key') key = argv[++i]
  else prompt = argv[i]
}
if (!file || !key || !prompt) fail()

// 提示词形态：`user@host's password:`（键盘交互等其它形态不支持，按失败处理）。
const m = /([^\s'@]+@[^\s':]+)'s password/.exec(String(prompt))
if (!m) fail()

try {
  const store = new CredentialStore({ file, keyFile: key })
  const password = store.get(m[1])
  if (password === null || password === undefined) fail()
  process.stdout.write(String(password))
} catch {
  fail()
}
