# 远端 `._`（AppleDouble）污染

## Goal

远端 runtime 里不得出现 macOS 的 `._` 伴生文件。它们在 Linux 上毫无意义，却会**毒化按目录
内容判定的代码**——远端插件管理页因此对 4 个实验性插件报「包元信息错误」。

**状态：远端已清理（74推理 27,560 → 0；26训练 无 `~/.kcoder-remote`，无需清理）；接收端守卫
已实施、通过验证并进入构建产物（2026-10-01）。产出者未能确证，见 Findings F4。**

> 守卫要真正生效，需要**重新打包安装**或跑 `pnpm dev`/`pnpm start`：当前在跑的是已安装的
> `/Applications/KCoder.app` 0.6.20（`app.asar` 时间 Sep 30 23:55），它不读仓库的 `out/`。

## Findings

### F1 症状与影响面

远端（74推理）插件管理页对 `@deepseek-ai/dsh-experimental-*` 报：

```
包元信息错误: Plugin metadata for …: Error:
  @deepseek-ai/dsh-experimental-auto-review/locale/._en.json must use a language id as its filename
```

实测该远端 `~/.kcoder-remote` 下有 **27,560 个 `._*` 文件**（含 `._` 目录，如 `._bin`），
占约 **107 MB**。不止 locale：`runtime/node_modules/**`、`home/profiles/kcoder/node_modules/**`、
根目录下的 `._addon-specs.txt` / `._install-addons.sh` 全都有伴生文件。

### F2 机制：按目录内容判定，一个杂文件就把整包判死

`@deepseek-ai/dsh-app-boot` 的 `dictionariesOf()`（`lib/index.js:1925-1931`）：

```js
for (const entry of readdirSync(dirname(englishPath), { withFileTypes: true })) {
  if (!entry.name.endsWith(".json")) continue
  const language = entry.name.slice(0, -5)
  if (!LANGUAGE_ID.test(language)) throw new Error(`${resource} must use a language id as its filename`)
}
```

**没有缓存**：`dsh-plugin-manager` 的 `listBundles()`（`lib/index.js:1493`）每次构建列表都调
`readPluginMeta` → `dictionariesOf`。所以文件一删、页面一刷新即恢复，**不需要重启远端服务**。

### F3 它们确实是 AppleDouble

`file` 判定 `AppleDouble encoded Macintosh file`；头字节
`00 05 16 07 | 00 02 00 00 | "Mac OS X        " | 00 02 00 00`（2 个条目），
首条目 id 为 `00 09` = **FinderInfo**。即：是 macOS 工具为「扩展属性/ACL」写的旁挂表示，
不是随便生成的垃圾文件。

### F4 产出者**未能确证**（诚实记录）

逐条排除/证实的实验（本机 bsdtar 3.5.3 / libarchive 3.7.4；远端 GNU tar 1.35）：

| 假设 | 实验 | 结论 |
|---|---|---|
| App 的 tar 合成 AppleDouble | `man tar` 称 `--mac-metadata` 是 c 模式默认；但用 ACL、`com.apple.provenance`、手工写入的 **FinderInfo**（`TEXTttxt`）逐项构造触发条件后打包，**均未产生 `._` 条目** | ❌ 未复现 |
| App 的 tar 把磁盘上的 `._` 传过去 | 显式点名 `._a.json` 打包 → **产出空归档**（exit 0） | ❌ bsdtar 会跳过磁盘 `._` |
| GNU tar 会传输磁盘上的 `._` | 远端实测：`tar -czf` **确实归档** `./._a.json`、`./sub/._c.json` | ✅（但本机 `which -a tar` 只有 `/usr/bin/tar`） |
| 源目录里本来就有 `._` | 三个候选源（repo `bundle/`、`staging/kcoder-runtime`、`<userData>/kcoder-runtime`、`/Applications/KCoder.app`）**全部 0 个** | ❌ |
| 发行归档里带 `._` | `/Applications/KCoder.app/Contents/Resources/kcoder-runtime.tar.gz`（149 MB，App 就是用它携带 runtime 的）：**22,084 个条目、0 个 `._`** | ❌ |

传输源文件的元数据在此期间被替换过（`<userData>/kcoder-runtime` 目录 mtime `10:06`，
晚于传输出错的 `08:22`；现在 200/200 个文件只剩 `com.apple.provenance`，**已无 FinderInfo**），
**因此无法从现状反推产出者**。

⇒ 结论：**守卫不能押在产出侧**（既定位不到，也无法对用户环境中的所有产出路径设防）。
**接收端兜底才是确定性保证。**

### F5 教训与本次架构缺陷同源

这与 `remote-arch-adaptation.md` 的 F2/F3 是同一类错误：**交付通道对自己的输入过于信任，
且失败/污染不产生任何信号**。27,560 个杂文件躺在远端，只有「恰好按目录内容判定的那处代码」
把它变成了可见错误。

## 处置

### 代码（已实施）

`desktop/main/remote-server.ts` 的 `sshTarOnce()`：

1. **打包侧**：`COPYFILE_DISABLE=1`（Apple 关掉 bsdtar 写 AppleDouble 的开关）+
   `--exclude=._* --exclude=*/._*`（兜住 PATH 上是 GNU tar 的环境——已实测 GNU tar 会归档
   这两个位置的 `._`，且这两个模式能挡住）。
2. **解包侧（保证）**：
   ```sh
   mkdir -p DIR && tar -xzf - -C DIR && { find DIR -name '._*' -delete 2>/dev/null || true; }
   ```
   `{ …; }` 的分组是必要的：`|| true` 只吞清理那一步的失败，**解包失败必须原样上报**
   （那是真实传输失败，调用方要重试）。

> 为什么解包侧是「保证」：它不依赖产出者是谁、也不依赖本机 tar 的版本行为差异；
> 无论 `._` 是传过来的还是就地生成的，落地即删。

### 已有远端（一次性）

指纹跳过意味着**不会再重传**，所以已被污染的远端不会自愈。对每台已连过的远端执行：

```sh
find ~/.kcoder-remote -depth -name '._*' -delete
```

| 主机 | 结果 |
|---|---|
| 74推理（111.19.156.74） | 已执行：27,560 → 0，真实文件 md5 未变，释放 107 MB |
| 26训练（111.19.156.26） | **无 `~/.kcoder-remote`**（尚未被「远端连接」连过）⇒ 无需清理 |

## 验证

| 项 | 命令 / 结果 |
|---|---|
| 类型门 | `npx tsc --noEmit -p tsconfig.node.json` ✅ |
| 解包守卫·正向 | 造含 `._` 的归档 → 新命令解包 → `dst/sub/real.json` 保留、`._*` 全消失，exit 0 ✅ |
| 解包守卫·反向 | 喂垃圾流 → exit **2**（未被 `|| true` 吞掉）✅ |
| `--exclude` 有效性 | 远端 GNU tar：默认归档 `._a.json`/`sub/._c.json`；加模式后两者都消失 ✅ |
| 远端清理 | `find … -name '._*' \| wc -l` → 0；`en.json` md5 前后一致（`4b9aef46…`）✅ |

## 关联缺陷

本缺陷与 [remote-arch-adaptation.md](remote-arch-adaptation.md)（原生包按目标平台供给）**同源**，
是「远端供给通道」的两类缺陷，故两份计划互相独立、互为参照：

| | 本缺陷 | 架构缺陷 |
|---|---|---|
| 通道信任了什么 | 信任「本地树里没有的东西就不会到远端」 | 信任「本地是 x64，所以远端也要 x64 包」 |
| 失败如何表现 | 27,560 个杂文件静默落地，只有恰好按目录判定的代码把它变成错误 | npm 整单 `EBADPLATFORM`，被哨兵字符串判成功 |
| 是否自愈 | 否（指纹跳过 ⇒ 不重传） | 否（指纹一致 ⇒ 永久跳过） |
| 修法 | 接收端解包后 `find -delete`（不依赖产出者） | 判据按目标三元组派生 + 指纹含平台 + 结果校验 |

两条共同教训：**交付通道不能信任自己的输入；污染与失败必须产生信号。**

## 未解之谜（后续若要追）

`._` 究竟由哪条通道产生。若要继续追，成本最低的下一步是**在污染源头加观测**：
在远端解包命令里加一行「发现 `._` 就打印其原始 tar 条目名与时间戳」（本次为了保持改动最小
而没有留痕）。另一个方向是查证其它 macOS 侧写入 `~/.kcoder-remote` 的通道
（`dsh-ssh-remote` 的 `ssh_push`、用户手工 `scp`/SFTP 客户端），但它们都晚于本次取证窗口。
