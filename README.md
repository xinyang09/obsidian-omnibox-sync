# Omnibox 同步插件使用说明

## 概览
- 将 Obsidian 中的 Markdown 文件同步到 Omnibox 指定命名空间与目标父节点下。
- 支持按本地目录层级在远端自动创建缺失的目录，并将文件挂载到正确的父目录 ID。
- 支持通过 API Key 或用户登录获取 Token 完成 PATCH 认证。

## 安装
- 将本插件拷贝到 Obsidian 插件目录后启用。
- 插件文件入口：`omnibox-sync/main.js`

## 基本配置
- `API URL`：你的服务地址，例如 `https://xh.ak8s.cn:16666`
- `API Key`：开放 API 的访问令牌（用于创建/列出等接口）。
- `命名空间`：通过 `GET /api/v1/namespaces` 动态获取并以下拉框显示名称，选择后保存使用其 `id`。
- `同步目录`：仅同步该本地目录下的 `.md` 文件，例如 `docs`。作为远端挂载的层级基准。
- `保留文件夹层级`：开启后会保留 `同步目录` 内的相对层级（如 `docs/a/b.md` → 相对路径 `a/b.md`）。
- `远端目标节点`：仅显示根空间下的目录（folder），选择作为所有同步的初始父级 ID。

## 同步行为说明
- 路径裁剪：
  - 当开启保留层级时，远端使用 `同步目录` 内的相对路径作为层级，例如：
    - 本地 `docs/a/b.md` → 相对路径 `a/b.md`
  - 当关闭保留层级时，使用文件名作为路径，例如：`b.md`
- 目录创建：
  - 在保留层级下，同步前会递归调用远端创建缺失目录（`resourceType: 'folder'`），并缓存每一层目录的 ID。
  - 完成后将文件的父级 ID设置为最后一层目录的 ID。
- 文件创建：
  - 创建请求体（POST `/api/v1/namespaces/{ns}/resources`）仅包含：`{ name, resourceType: 'doc', parentId }`
  - 若需要更新内容或改名，使用 PATCH（见后文）。

## 认证设置（PATCH 更新）
- `PATCH 认证 Token`：用于 PATCH 请求的 Bearer 认证，优先于 API Key。
- 从剪贴板填充 Token：在浏览器复制 `TOKEN` 后，点击设置中的“粘贴 TOKEN”快速填充。
- 用户名/密码登录获取 Token：
  - 登录 URL：支持相对路径（自动拼接 `API URL`）或绝对路径。
  - 输入用户名或邮箱与密码，点击“登录并获取”，插件会调用登录接口并从响应中提取 `token/access_token/jwt` 写入 `authToken`。
  - 开启后每次启动 Obsidian 会自动尝试登录并刷新 Token。

## 接口契约
- 创建目录（POST）：`{ name, resourceType: 'folder', parentId }`
- 创建文件（POST）：`{ name, resourceType: 'doc', parentId }`
- 更新内容/文件名（PATCH）：`{ namespaceId, name, content }`（针对已有资源 ID）

## 手动操作
- 测试 API 连接：用于验证 `API URL` 是否可访问。
- 测试文件上传：构造简单测试文档并发起创建。
- 手动同步：立即同步当前过滤条件下的所有 Markdown 文件。

## 故障排查
- 400 错误（资源类型/父级 ID/命名空间）：
  - 创建体是否仅包含 `{ name, resourceType, parentId }`，且 `resourceType` 为 `doc` 或 `folder`。
  - `parentId` 是否为字符串且为目标目录的 ID（例如选择 `docs` 的 ID）。
  - PATCH 体是否为 `{ namespaceId, name, content }`。
- 401/403 认证失败：
  - 检查 `PATCH 认证 Token` 是否有效或重新登录刷新。
  - 如使用 Cookie 认证，确认设置中启用了相关选项。
- Invalid URL：
  - 登录 URL 为相对路径时会自动拼接 `API URL`，请确认 `API URL` 有效并以 `http/https` 开头。
- 文件未挂到目标目录：
  - 确认选择的“远端目标节点”为根层的目录（folder）。
  - 开启保留层级时，确保 `同步目录` 与本地路径一致，避免裁剪错误。

## 日志与调试
- 插件在关键步骤打印日志：创建体、PATCH 请求体、登录过程与错误信息。
- 可在控制台查看：
  - `📤 JSON 创建请求体`、`📤 PATCH 请求体`、`🔐 尝试登录获取 Token` 等。

## 限制与建议
- 设置中的“远端目标节点”仅显示根层目录，避免误选文件节点。
- 如需选择更深层级目录，可使用弹窗浏览（若启用）或后续扩展为树形选择器。
- 建议始终设置 `同步目录`，以获得稳定的层级映射与性能。

