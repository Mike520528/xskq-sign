# 晚寝签到助手

用 **playwright-core** 驱动 Microsoft Edge 打开学校考勤系统 `https://xskq.ahut.edu.cn/`，自动提交晚寝签到。每天 21:30 之后定时跑，不用自己动手点。

## 它解决什么问题

晚寝签到要求你在规定时间、在宿舍围栏范围内手动打卡。但签到请求里的坐标（`latitude` / `longitude`）只是两个数字字符串，服务端只校验**上报距离是否小于围栏半径**，没法验证你真实在哪。所以只要把坐标填成围栏中心点的值，就能在电脑上替你完成签到。

不需要 root、不需要模拟定位、不需要改手机设置。

## 原理

`sign-auto.mjs` 的完整流程（174 行）：

1. 用 playwright-core 启动 Edge（默认无头），打开 `xskq.ahut.edu.cn`
2. 填学号密码登录，从 `localStorage` 拿 `access-token`
3. 调 `getStudentTaskPage` 取今日签到任务
4. 调 `getOne` 查今天是否已签到——已签则直接退出（不重复提交）
5. 调 `getTaskByIdForApp` 取任务详情，**从接口返回值里拿到宿舍围栏中心坐标（`locationLat`/`locationLng`）和半径**——坐标不硬编码，用接口给你的围栏中心
6. 构造提交 payload，坐标填围栏中心值、`locationAccuracy` 填配置里的精度（默认 10 米），调 `stuSign` 提交
7. 返回 `code === 200` 即签到成功

所有 API 调用在页面上下文里执行，复用页面已加载的 `js-md5` 模块计算请求签名（`flysource-sign`），并携带 `flysource-auth: bearer <token>`。

## 目录结构

| 文件 | 字节数 | 作用 |
| --- | ---: | --- |
| `sign-auto.mjs` | 6,511 | 主程序，174 行，登录→查任务→取围栏→提交 |
| `setup.ps1` | 3,358 | 首次配置：校验运行时、找 Edge、填学号密码、注册计划任务 |
| `run-sign.ps1` | 144 | 计划任务调用的入口，用目录内 `node.exe` 跑 `sign-auto.mjs` |
| `安装.cmd` | 98 | 双击入口，调 `setup.ps1` |
| `使用说明.txt` | 3,242 | 面向用户的中文说明，93 行 |
| `config.json` | 84 | 配置模板（`username`/`password` 均为空字符串，可安全提交） |

**不进仓库（已写入 `.gitignore`）：**

| 排除项 | 大小 | 说明 |
| --- | --- | --- |
| `node.exe` | ~93 MB | 便携版 Node 运行时，二进制依赖不进 git |
| `node_modules/` | ~14 MB | `playwright-core`，依赖目录不进 git |
| `logs/` | — | 运行日志，运行时自动生成 |

## 前置条件

- **Windows** + **Microsoft Edge**（Win10/11 基本自带）
- 电脑要**开机或睡眠**（设了自动唤醒），Windows 处于登录状态（锁屏没关系，注销不行；关机不会执行）
- 两个运行时需要**自己补齐**（本仓库不含 `node.exe` 和 `node_modules`）：
  1. **Node 运行时**：`run-sign.ps1` 硬编码用同目录下的 `node.exe`，所以需要把一个 `node.exe`（建议 Node 18+）放进本目录。可以从 [nodejs.org](https://nodejs.org) 下载便携版，或把系统已装的 `node.exe` 复制一份过来。
  2. **playwright-core**：在本目录执行 `npm install playwright-core`（会用第 1 步的 node）。注意：playwright-core 不含浏览器二进制，本程序用的是系统已装的 Edge（`channel: 'msedge'`），所以**不需要** `npx playwright install` 下载 Chromium。

## 首次使用

1. 把本仓库 clone / 解压到一个**固定位置**（别放桌面，别乱删），建议 `C:\XSKQ-Sign`
2. 补齐 `node.exe` 和 `node_modules\playwright-core`（见上一节）
3. 双击 **`安装.cmd`**
4. 按提示输入**学号**和**密码**（明文存入 `config.json`）
5. 询问是否测试登录——选 **Y**
   - 看到「未到签到时间！」是正常的，说明账号密码和请求都对，只是还没到 21:30 窗口
6. 询问是否注册计划任务——选 **Y**
   - 注册后每天 **21:32 / 21:45 / 22:00** 各跑一次；前一次成功，后两次登录后会查到「今天已签到」自动跳过，不会重复提交

## 手动跑一次

```powershell
.\run-sign.ps1
```

或直接用 node：

```powershell
.\node.exe sign-auto.mjs
```

## 计划任务说明

`setup.ps1` 注册名为 `XSKQ-AutoSign` 的计划任务：

- 触发：每天 21:32 / 21:45 / 22:00（三次兜底）
- 动作：`powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File run-sign.ps1`
- 设置：`-StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`，单次执行时限 10 分钟

### 卸载

删除计划任务：

```powershell
Unregister-ScheduledTask -TaskName "XSKQ-AutoSign" -Confirm:$false
```

然后整个文件夹删掉即可。

## 配置项（`config.json`）

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `username` | `""` | 学号 |
| `password` | `""` | 教务系统密码（**明文**） |
| `accuracy` | `10` | 上报精度（米），提交时的 `locationAccuracy` |
| `headless` | `true` | Edge 是否无头模式；设 `false` 可看到浏览器操作过程 |

## 排错

看 `logs\sign.log` 最后几行：

| 日志 | 含义 |
| --- | --- |
| `签到成功` | 正常 |
| `未到签到时间！` | 时间没到，脚本跑早了 |
| `今天已签到` | 已经签过了 |
| `签到失败: xxx` | 看 `xxx` 具体内容 |
| `取任务失败` | token 或登录态有问题 |
| `异常: xxx` | 浏览器启动失败等 |

常见原因：密码改了→重跑 `安装.cmd`；学校改了接口→要更新脚本；Edge 被卸载→装回来。

## 注意

- 密码是**明文**存在 `config.json` 里的。这台电脑上任何能打开该文件的人都能看到你的密码——不要把含密码的 `config.json` 分享给别人（本仓库提交的是空模板，安全）。
- 仅用于个人合理使用，使用者自行承担相关风险。
