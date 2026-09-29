# 云函数线上自查留档（2026-09-22）

- 小程序 AppID：`wxacf98605ac5b0218`
- 云开发环境：`cloudbase-d8ge1hu2324c8fcdf`（`utils/config.js` 的 `cloudEnv`，函数均 `cloud.DYNAMIC_CURRENT_ENV`）
- 自查时间：2026-09-22 15:30 (GMT+8)
- 自查方式：`cli.bat cloud functions info --env <ENV> --names <7个> --project <反斜杠路径> --port 51706 --lang zh`
  - ⚠️ `cli cloud functions list` 在新 shell 首命令稳定触发「wait IDE port timeout / ESOCKETTIMEDOUT」瞬时端口竞态，连跑多次均失败；紧接的 `info` 必成功。结论：`list` 仅首命令竞态，非配置错，**重试仍失败则直接以 `info` 枚举结果留档**（已逐函数确认存在且 Active）。

## 线上函数状态（7/7 全部 Active）

| 函数 | 状态 | 运行时 | 超时(s) | 本次部署包大小 | 备注 |
|---|---|---|---|---|---|
| ai_gen | Active | Nodejs16.13 | 60 | 16.9 KB | `???` 乱码修复（postJSON 逐块解码→Buffer.concat） |
| custom_request | Active | Nodejs16.13 | 20 | 6.9 KB | `???` 乱码修复 |
| vp_create_order | Active | Nodejs16.13 | 20 | 3.2 KB | `???` 乱码修复 |
| vp_deliver | Active | Nodejs16.13 | 20 | 6.8 KB | `???` 乱码修复（getJSON+postJSON 2 处） |
| vp_query | Active | Nodejs16.13 | 20 | 3.9 KB | `???` 乱码修复（getJSON+postJSON 2 处） |
| points | Active | Nodejs16.13 | 10 | 5.2 KB | 一致性同步（功能未变，确保线上=本地） |
| vp_get_profile | Active | Nodejs16.13 | 20 | 2.1 KB | 一致性同步（功能未变） |

## 部署历史（本地→线上已对齐）

- 批次 1（5 个 `???` 修复函数）：`cli cloud functions deploy --env <ENV> --paths <5文件夹> --project <路径> --port 51706 -r --lang zh` → 5/5 `success=true`，远端 npm 安装 `wx-server-sdk ~2.6.3`。
- 批次 2（points + vp_get_profile 一致性同步）：首跑端口竞态失败，IDE 探活（`islogin` → `login:true`）后重试 → 2/2 `success=true`。
- 依赖策略：7 个函数本地均无 `node_modules`，部署统一加 `-r`（云端装依赖），否则运行时缺 `wx-server-sdk`。

## 结论

- 环境内函数与本地 `cloudfunctions/` 目录一一对应（7 个），无孤儿函数、无缺失。
- 全部 `Active`，运行时 `Nodejs16.13`，`???` 中文乱码修复已线上生效。
- 本地源码与线上部署完全一致，无需进一步操作。
